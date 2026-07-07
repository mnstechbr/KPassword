import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createEmptyVault,
  decryptVault,
  encryptVault,
  needsCryptoMigration,
  parseEncryptedVault,
  validateEncryptedVaultBackup,
  validateMasterPassword,
  verifyEncryptedVaultBackup,
} from "./crypto";
import { generatePassword, getPasswordLabel, getPasswordScore, type PasswordGeneratorMode } from "./password";
import { decodeQrFromImageFile } from "./totp-qr-reader";
import {
  createPreArgon2Backup,
  getStorageInfo,
  disableWindowsHello,
  enableWindowsHello,
  getWindowsHelloStatus,
  listBackupFiles,
  listVaultFiles,
  loadVaultFile,
  openBackupFolder,
  openVaultFolder,
  saveVaultFile,
  unlockWithWindowsHello,
} from "./vault-storage";
import type {
  BackupFile,
  BackupVerificationReport,
  CredentialCategory,
  CredentialRecord,
  PasswordHistoryEntry,
  VaultAttachment,
  VaultFileInfo,
  VaultItemType,
  WindowsHelloStatus,
  EncryptedVaultFile,
  PlainVault,
  StorageInfo,
} from "./types";
import {
  LANGUAGES,
  getCategoryLabel,
  getDateLocale,
  getInitialLanguage,
  translate,
  translatePasswordLabel,
  translateValidationIssue,
  type AppLanguage,
} from "./i18n";

const EMPTY_FORM: Omit<CredentialRecord, "id" | "createdAt" | "updatedAt"> = {
  itemType: "credential",
  title: "",
  username: "",
  password: "",
  url: "",
  category: "Trabalho",
  tags: [],
  notes: "",
  favorite: false,
  passwordChangedAt: "",
  passwordExpiresInDays: 90,
  passwordExpiryNoticeDays: 15,
  passwordHistory: [],
  attachments: [],
  totpSecret: "",
  totpIssuer: "",
  cardholderName: "",
  cardNumber: "",
  cardExpiry: "",
  cardCvv: "",
  cardIssuer: "",
  identityFullName: "",
  identityDocument: "",
  identityEmail: "",
  identityPhone: "",
  identityAddress: "",
  licenseProduct: "",
  licenseKey: "",
  licenseOwner: "",
  licenseExpiresAt: "",
};

const CATEGORIES: CredentialCategory[] = [
  "Trabalho",
  "Pessoal",
  "Banco",
  "E-mail",
  "Sistema",
  "Outro",
];

const CLIPBOARD_CLEAR_SECONDS = 60;
const DEFAULT_VAULT_NAME = "vault";
const TOTP_PERIOD_SECONDS = 30;
const MAX_TOTP_QR_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTP_QR_IMAGE_PIXELS = 25_000_000;
const MAX_TOTP_QR_IMAGE_SIDE = 10_000;
const APP_VERSION = "1.2.0";
const UPDATE_GITHUB_OWNER = "mnstechbr";
const UPDATE_GITHUB_REPO = "KPassword";
const PASSWORD_ROTATION_DAYS = 30;
const DEFAULT_WINDOWS_HELLO_STATUS: WindowsHelloStatus = {
  available: false,
  enabled: false,
  reason: "",
  vault_name: DEFAULT_VAULT_NAME,
};

type Screen = "credentials" | "dashboard" | "trash" | "settings" | "preferences";

const ITEM_TYPES: VaultItemType[] = ["credential", "secure_note", "card", "identity", "license"];

type AppTheme = "dark" | "light" | "mixed";
type FontScale = "normal" | "large";

const PASSWORD_EXPIRY_OPTIONS = [0, 30, 60, 90, 180, 365];
const PASSWORD_NOTICE_OPTIONS = [7, 15, 30, 60];

type PasswordExpiryStatus = "never" | "valid" | "soon" | "expired";

type DiagnosticFilter =
  | "all"
  | "weak"
  | "reused"
  | "old"
  | "expired"
  | "expiring"
  | "missingTotp"
  | "incomplete";

type DiagnosticIssue = Exclude<DiagnosticFilter, "all">;

type QuickVaultFilter =
  | "all"
  | "favorites"
  | "weak"
  | "reused"
  | "old"
  | "expired"
  | "expiring"
  | "missingTotp"
  | "incomplete"
  | "withTags";


type TotpSetupMode = "choice" | "manual" | "preview" | "screenIntro" | "screenCrop";
type TotpSetupSource = "image" | "manual" | "screen";

type TotpScreenSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TotpPreview = {
  secret: string;
  issuer: string;
  account: string;
  label: string;
  digits: number;
  period: number;
  algorithm: string;
  source: TotpSetupSource;
  currentCode: string;
};

const DIAGNOSTIC_QUICK_FILTERS: DiagnosticIssue[] = [
  "weak",
  "reused",
  "old",
  "expired",
  "expiring",
  "missingTotp",
  "incomplete",
];

function isDiagnosticQuickFilter(filter: QuickVaultFilter): filter is DiagnosticIssue {
  return DIAGNOSTIC_QUICK_FILTERS.includes(filter as DiagnosticIssue);
}

type AssistantActionKind = "addTotp" | "changePassword" | "reviewPassword" | "completeCredential";

type AssistantAction = {
  id: string;
  credential: CredentialRecord;
  issue: DiagnosticIssue;
  priority: number;
  tone: "danger" | "warning" | "neutral";
  kind: AssistantActionKind;
};

type AssistantTagSuggestion = {
  id: string;
  credential: CredentialRecord;
  tag: string;
  priority: number;
};

const ASSISTANT_ISSUE_PRIORITY: Record<DiagnosticIssue, number> = {
  reused: 120,
  expired: 112,
  weak: 104,
  missingTotp: 92,
  expiring: 76,
  old: 68,
  incomplete: 54,
};

function getAssistantIssueTone(issue: DiagnosticIssue): "danger" | "warning" | "neutral" {
  if (issue === "reused" || issue === "expired") return "danger";
  if (issue === "weak" || issue === "missingTotp" || issue === "expiring") return "warning";
  return "neutral";
}

function getAssistantActionKind(issue: DiagnosticIssue): AssistantActionKind {
  if (issue === "missingTotp") return "addTotp";
  if (issue === "incomplete") return "completeCredential";
  if (issue === "weak" || issue === "reused" || issue === "expired") return "changePassword";
  return "reviewPassword";
}

function getCredentialImportanceScore(credential: CredentialRecord) {
  const haystack = `${credential.title} ${credential.url} ${credential.category}`.toLowerCase();
  let score = 0;

  if (credential.favorite) score += 22;
  if (["Banco", "E-mail", "Sistema"].includes(credential.category)) score += 16;
  if (/bank|banco|nubank|itau|itaú|bradesco|santander|caixa|inter|finance|pay|paypal|wise|binance|mercado\s*pago/.test(haystack)) score += 18;
  if (/mail|gmail|outlook|hotmail|proton|icloud|email|e-mail/.test(haystack)) score += 15;
  if (/github|gitlab|vercel|cloudflare|aws|azure|google|microsoft|admin|root|sistema/.test(haystack)) score += 14;

  return score;
}

function inferCredentialTag(credential: CredentialRecord) {
  const haystack = `${credential.title} ${credential.url} ${credential.category}`.toLowerCase();

  if (/bank|banco|nubank|itau|itaú|bradesco|santander|caixa|inter|finance|pay|paypal|wise|binance|mercado\s*pago/.test(haystack)) return "banco";
  if (/mail|gmail|outlook|hotmail|proton|icloud|email|e-mail/.test(haystack)) return "email";
  if (/github|gitlab|vercel|cloudflare|aws|azure|docker|npm|dev|deploy|código|codigo|code/.test(haystack)) return "desenvolvimento";
  if (/amazon|mercado\s*livre|shop|loja|compra|compras|aliexpress|shopee|magazine|magalu/.test(haystack)) return "compras";
  if (/netflix|spotify|disney|prime|hbo|max|stream|youtube|twitch/.test(haystack)) return "streaming";
  if (/instagram|facebook|linkedin|twitter|x\.com|tiktok|social/.test(haystack)) return "social";
  if (/slack|teams|zoom|work|trabalho|empresa|corp/.test(haystack)) return "trabalho";
  if (credential.favorite) return "importante";

  return "revisar";
}

const OLD_PASSWORD_DAYS = 180;

type DiagnosticGuidance = {
  explanation: string;
  action: string;
};

const DIAGNOSTIC_GUIDANCE_KEYS: Partial<Record<DiagnosticIssue, DiagnosticGuidance>> = {
  weak: {
    explanation: "diagnostic.guidance.weak.explanation",
    action: "diagnostic.guidance.weak.action",
  },
  reused: {
    explanation: "diagnostic.guidance.reused.explanation",
    action: "diagnostic.guidance.reused.action",
  },
  old: {
    explanation: "diagnostic.guidance.old.explanation",
    action: "diagnostic.guidance.old.action",
  },
  expired: {
    explanation: "diagnostic.guidance.expired.explanation",
    action: "diagnostic.guidance.expired.action",
  },
  expiring: {
    explanation: "diagnostic.guidance.expiring.explanation",
    action: "diagnostic.guidance.expiring.action",
  },
  missingTotp: {
    explanation: "diagnostic.guidance.missingTotp.explanation",
    action: "diagnostic.guidance.missingTotp.action",
  },
  incomplete: {
    explanation: "diagnostic.guidance.incomplete.explanation",
    action: "diagnostic.guidance.incomplete.action",
  },
};

function getVaultIssueGuidance(
  issue: DiagnosticIssue,
  translateText: (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => string,
) {
  const guidance = DIAGNOSTIC_GUIDANCE_KEYS[issue] ?? {
    explanation: "diagnostic.guidance.generic.explanation",
    action: "diagnostic.guidance.generic.action",
  };
  const values = issue === "old" ? { days: OLD_PASSWORD_DAYS } : undefined;

  return {
    explanation: translateText(guidance.explanation, values),
    action: translateText(guidance.action, values),
  };
}

type ConfirmDialog = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
  resolve: (confirmed: boolean) => void;
};

function createId() {
  return crypto.randomUUID();
}

function formatDate(value?: string | number, language: AppLanguage = "pt") {
  if (!value) return "—";

  return new Intl.DateTimeFormat(getDateLocale(language), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function getEmptyCredential(): Omit<CredentialRecord, "id" | "createdAt" | "updatedAt"> {
  return { ...EMPTY_FORM, tags: [] };
}

function normalizeCredentialTags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return Array.from(new Set(
      input
        .map((tag) => String(tag ?? "").trim())
        .filter(Boolean),
    )).slice(0, 12);
  }

  return Array.from(new Set(
    String(input ?? "")
      .split(/[;,\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  )).slice(0, 12);
}

function formatTagsForInput(tags: unknown) {
  return normalizeCredentialTags(tags).join(", ");
}

function getCredentialTags(credential: CredentialRecord) {
  return normalizeCredentialTags(credential.tags);
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();

  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

async function openExternalUrl(url: string) {
  const normalized = normalizeUrl(url);

  if (!normalized) {
    return false;
  }

  await invoke("open_external_url", { url: normalized });
  return true;
}

function maskPassword(password: string) {
  if (!password) return "—";
  return "••••••••••••";
}

function getOrderedCredentials(credentials: CredentialRecord[]) {
  return [...credentials].sort(
    (first, second) => Number(second.favorite) - Number(first.favorite),
  );
}

function getStoredValue<T extends string>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);

    if (!value) return fallback;

    return value as T;
  } catch {
    return fallback;
  }
}

function createVaultSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function getVaultDisplayName(vaultName: string, vaultFiles: VaultFileInfo[]) {
  const found = vaultFiles.find((item) => item.name === vaultName);

  if (found) return found.display_name;
  if (vaultName === DEFAULT_VAULT_NAME) return "Principal";

  return vaultName.replace(/[-_]+/g, " ");
}

function parseTotpCandidate(value: string, fallbackIssuer = "", source: TotpSetupSource = "manual"): Omit<TotpPreview, "currentCode"> {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("totp.error.empty");
  }

  if (/^otpauth:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const secret = normalizeTotpSecret(url.searchParams.get("secret") ?? "");
      const rawLabel = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const [labelIssuer, ...accountParts] = rawLabel.split(":");
      const account = accountParts.join(":").trim();
      const issuer = (url.searchParams.get("issuer") ?? labelIssuer ?? fallbackIssuer).trim();
      const digits = Number(url.searchParams.get("digits") ?? 6);
      const period = Number(url.searchParams.get("period") ?? TOTP_PERIOD_SECONDS);
      const algorithm = (url.searchParams.get("algorithm") ?? "SHA1").replace(/[-_]/g, "").toUpperCase();

      if (!secret) {
        throw new Error("totp.error.noSecret");
      }

      return {
        secret,
        issuer,
        account,
        label: rawLabel,
        digits,
        period,
        algorithm,
        source,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("totp.error.")) {
        throw error;
      }
      throw new Error("totp.error.invalidUrl");
    }
  }

  const secret = normalizeTotpSecret(trimmed);

  if (!secret) {
    throw new Error("totp.error.noSecret");
  }

  return {
    secret,
    issuer: fallbackIssuer.trim(),
    account: "",
    label: fallbackIssuer.trim(),
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    algorithm: "SHA1",
    source,
  };
}

function parseTotpInput(value: string, fallbackIssuer = "") {
  const trimmed = value.trim();

  if (!trimmed) {
    return { secret: "", issuer: fallbackIssuer };
  }

  try {
    const parsed = parseTotpCandidate(trimmed, fallbackIssuer, "manual");
    return { secret: parsed.secret, issuer: parsed.issuer };
  } catch {
    return { secret: normalizeTotpSecret(trimmed), issuer: fallbackIssuer };
  }
}

function normalizeTotpSecret(secret: string) {
  return secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function isStandardTotp(candidate: Pick<TotpPreview, "digits" | "period" | "algorithm">) {
  return candidate.digits === 6 && candidate.period === TOTP_PERIOD_SECONDS && candidate.algorithm === "SHA1";
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = normalizeTotpSecret(value);
  let bits = "";

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];

  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return new Uint8Array(bytes);
}

function counterToBytes(counter: number) {
  const bytes = new Uint8Array(8);
  let value = BigInt(counter);

  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }

  return bytes;
}

async function generateTotp(secret: string, timestamp = Date.now()) {
  const keyBytes = decodeBase32(secret);

  if (keyBytes.length === 0) {
    throw new Error("Invalid TOTP secret.");
  }

  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterToBytes(counter)));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

function getTotpRemainingSeconds(timestamp = Date.now()) {
  const elapsed = Math.floor(timestamp / 1000) % TOTP_PERIOD_SECONDS;
  return TOTP_PERIOD_SECONDS - elapsed;
}

function AppLogo({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const logoClasses = ["appLogo", size, className].filter(Boolean).join(" ");

  return (
    <span className={logoClasses} aria-hidden="true">
      <img
        src="/app-icon.png"
        alt=""
        draggable={false}
        onError={(event) => {
          event.currentTarget.style.display = "none";
          event.currentTarget.nextElementSibling?.removeAttribute("hidden");
        }}
      />
      <span hidden>KP</span>
    </span>
  );
}

const localizedLanguageNames: Record<AppLanguage, Record<AppLanguage, string>> = {
  pt: {
    pt: "Português",
    en: "Inglês",
    es: "Espanhol",
    tr: "Turco",
  },
  en: {
    pt: "Portuguese",
    en: "English",
    es: "Spanish",
    tr: "Turkish",
  },
  es: {
    pt: "Portugués",
    en: "Inglés",
    es: "Español",
    tr: "Turco",
  },
  tr: {
    pt: "Portekizce",
    en: "İngilizce",
    es: "İspanyolca",
    tr: "Türkçe",
  },
};

function getLanguageOptionLabel(code: AppLanguage, currentLanguage: AppLanguage) {
  return localizedLanguageNames[currentLanguage]?.[code] ?? localizedLanguageNames.pt[code];
}

function LanguageSelector({
  language,
  onChange,
  label,
  compact = false,
}: {
  language: AppLanguage;
  onChange: (language: AppLanguage) => void;
  label: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (compact) {
    const selectedLanguage = LANGUAGES.find((item) => item.code === language) ?? LANGUAGES[0];

    return (
      <div
        className="languageSelect compact customLanguageSelect"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
      >
        <span className="srOnly">{label}</span>
        <button
          type="button"
          className={open ? "languageSelectButton open" : "languageSelectButton"}
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {selectedLanguage.shortLabel}
        </button>

        {open && (
          <div className="languageOptions" role="listbox" aria-label={label}>
            {LANGUAGES.map((item) => (
              <button
                key={item.code}
                type="button"
                role="option"
                aria-selected={item.code === language}
                className={item.code === language ? "languageOption active" : "languageOption"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(item.code);
                  setOpen(false);
                }}
              >
                {item.shortLabel}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <label className="languageSelect">
      <span>{label}</span>
      <select
        value={language}
        aria-label={label}
        onChange={(event) => onChange(event.target.value as AppLanguage)}
      >
        {LANGUAGES.map((item) => (
          <option key={item.code} value={item.code}>
            {getLanguageOptionLabel(item.code, language)}
          </option>
        ))}
      </select>
    </label>
  );
}


function getPinUnlockLabel(language: AppLanguage) {
  const labels: Record<AppLanguage, string> = {
    pt: "Acessar com Windows Hello",
    en: "Unlock with Windows Hello",
    es: "Acceder con Windows Hello",
    tr: "Windows Hello ile ac",
  };

  return labels[language];
}

function stopAction(event: MouseEvent) {
  event.stopPropagation();
}

function getItemType(credential: CredentialRecord): VaultItemType {
  return credential.itemType ?? "credential";
}

function isCredentialItem(credential: CredentialRecord) {
  return getItemType(credential) === "credential";
}

function getItemTypeIcon(itemType: VaultItemType) {
  const icons: Record<VaultItemType, string> = {
    credential: "🔑",
    secure_note: "📝",
    card: "💳",
    identity: "🪪",
    license: "📜",
  };

  return icons[itemType];
}

function getItemTypeLabel(itemType: VaultItemType, language: AppLanguage) {
  return translate(language, `itemType.${itemType}`);
}

function getItemSubtitle(item: CredentialRecord, language: AppLanguage) {
  const itemType = getItemType(item);

  if (itemType === "credential") {
    return item.username || translate(language, "credential.noUser");
  }

  if (itemType === "secure_note") {
    return item.notes ? translate(language, "item.secureNoteWithContent") : translate(language, "item.secureNoteEmpty");
  }

  if (itemType === "card") {
    const lastDigits = (item.cardNumber ?? "").replace(/\D/g, "").slice(-4);
    return lastDigits ? translate(language, "item.cardEnding", { digits: lastDigits }) : item.cardIssuer || translate(language, "item.card");
  }

  if (itemType === "identity") {
    return item.identityEmail || item.identityPhone || item.identityDocument || translate(language, "item.identity");
  }

  return item.licenseProduct || item.licenseOwner || translate(language, "item.license");
}

function getItemPrimarySecret(item: CredentialRecord) {
  const itemType = getItemType(item);

  if (itemType === "credential") return item.password;
  if (itemType === "card") return item.cardNumber ?? "";
  if (itemType === "license") return item.licenseKey ?? "";

  return "";
}

function maskGenericSecret(value?: string) {
  if (!value) return "—";
  const normalized = value.replace(/\s+/g, "");

  if (normalized.length <= 4) return "••••";
  return `•••• ${normalized.slice(-4)}`;
}

function getAttachments(credential?: Partial<CredentialRecord> | null): VaultAttachment[] {
  return Array.isArray(credential?.attachments) ? credential.attachments : [];
}

function formatBytes(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 KB";

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Erro ao ler arquivo."));
    reader.readAsText(file, "utf-8");
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Erro ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}

function downloadTextFile(filename: string, content: string, mimeType = "application/json;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadDataUrl(filename: string, dataUrl: string) {
  const anchor = document.createElement("a");

  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function safeExportFilename(value: string) {
  const clean = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return clean || "kpassword";
}

function escapeCsvValue(value: unknown) {
  const text = String(value ?? "");

  if (/[",\r\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildCsv(items: CredentialRecord[]) {
  const headers = [
    "type",
    "title",
    "category",
    "tags",
    "favorite",
    "username",
    "password",
    "url",
    "notes",
    "totpIssuer",
    "totpSecret",
    "cardholderName",
    "cardNumber",
    "cardExpiry",
    "cardCvv",
    "cardIssuer",
    "identityFullName",
    "identityDocument",
    "identityEmail",
    "identityPhone",
    "identityAddress",
    "licenseProduct",
    "licenseKey",
    "licenseOwner",
    "licenseExpiresAt",
    "passwordChangedAt",
    "passwordExpiresInDays",
    "passwordExpiryNoticeDays",
    "createdAt",
    "updatedAt",
  ];

  const rows = items.map((item) =>
    headers.map((header) => escapeCsvValue(header === "tags" ? getCredentialTags(item).join("; ") : (item as unknown as Record<string, unknown>)[header])).join(","),
  );

  return [headers.join(","), ...rows].join("\r\n");
}

function normalizeCsvHeader(header: string) {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

type ParsedCsvRow = {
  lineNumber: number;
  values: Record<string, string>;
};

type ParsedCsvDocument = {
  headers: string[];
  rows: ParsedCsvRow[];
};

type CsvImportFieldKey =
  | "type"
  | "title"
  | "category"
  | "tags"
  | "favorite"
  | "username"
  | "password"
  | "url"
  | "notes"
  | "totpIssuer"
  | "totpSecret";

type CsvImportMapping = Record<CsvImportFieldKey, string>;

type CsvImportPreview = ParsedCsvDocument & {
  filename: string;
  mapping: CsvImportMapping;
};

type CsvImportPreviewItem = {
  id: string;
  lineNumber: number;
  credential: CredentialRecord;
  errors: string[];
  warnings: string[];
  duplicateTitle?: string;
};

type CsvImportAnalysis = {
  items: CsvImportPreviewItem[];
  validItems: CsvImportPreviewItem[];
  importableItems: CsvImportPreviewItem[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
};

const CSV_IMPORT_FIELD_ALIASES: Record<CsvImportFieldKey, string[]> = {
  type: ["type", "tipo", "itemtype", "item_type", "kind"],
  title: ["title", "name", "nome", "titulo", "título", "site", "servico", "serviço"],
  category: ["category", "categoria", "folder", "pasta", "grupo"],
  tags: ["tags", "tag", "etiquetas", "marcadores", "labels", "rotulos", "rótulos"],
  favorite: ["favorite", "favorito", "starred", "favorita"],
  username: ["username", "user", "login", "email", "e-mail", "usuario", "usuário"],
  password: ["password", "senha", "pass", "secret"],
  url: ["url", "site", "website", "link", "uri"],
  notes: ["notes", "nota", "notas", "observacoes", "observações", "content", "conteudo", "conteúdo", "comments"],
  totpIssuer: ["totpissuer", "totp_issuer", "issuer", "emissor"],
  totpSecret: ["totpsecret", "totp_secret", "otp", "2fa", "mfa", "segredo_totp", "otpauth"],
};

const CSV_IMPORT_FIELDS: Array<{ key: CsvImportFieldKey; labelKey: string }> = [
  { key: "title", labelKey: "import.field.title" },
  { key: "username", labelKey: "import.field.username" },
  { key: "password", labelKey: "import.field.password" },
  { key: "url", labelKey: "import.field.url" },
  { key: "notes", labelKey: "import.field.notes" },
  { key: "category", labelKey: "import.field.category" },
  { key: "tags", labelKey: "import.field.tags" },
  { key: "type", labelKey: "import.field.type" },
  { key: "favorite", labelKey: "import.field.favorite" },
  { key: "totpIssuer", labelKey: "import.field.totpIssuer" },
  { key: "totpSecret", labelKey: "import.field.totpSecret" },
];

function getEmptyCsvImportMapping(): CsvImportMapping {
  return {
    type: "",
    title: "",
    category: "",
    tags: "",
    favorite: "",
    username: "",
    password: "",
    url: "",
    notes: "",
    totpIssuer: "",
    totpSecret: "",
  };
}

function parseCsvRecords(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: Array<{ lineNumber: number; values: string[] }> = [];
  let values: string[] = [];
  let current = "";
  let quoted = false;
  let lineNumber = 1;
  let recordLineNumber = 1;
  let hasContent = false;

  function pushRecord() {
    const nextValues = [...values, current.trim()];
    const isBlank = nextValues.every((value) => value.trim().length === 0);

    if (!isBlank || hasContent) {
      records.push({ lineNumber: recordLineNumber, values: nextValues });
    }

    values = [];
    current = "";
    hasContent = false;
    recordLineNumber = lineNumber + 1;
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === '"') {
      if (quoted && normalized[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      hasContent = true;
      continue;
    }

    if ((character === "," || character === ";") && !quoted) {
      values.push(current.trim());
      current = "";
      hasContent = true;
      continue;
    }

    if (character === "\n" && !quoted) {
      pushRecord();
      lineNumber += 1;
      continue;
    }

    if (character === "\n") {
      lineNumber += 1;
    }

    current += character;
    if (character.trim().length > 0) {
      hasContent = true;
    }
  }

  if (quoted) {
    values.push(current.trim());
    records.push({ lineNumber: recordLineNumber, values });
    return records;
  }

  if (current.length > 0 || values.length > 0 || hasContent) {
    pushRecord();
  }

  return records;
}

function parseCsvDocument(text: string): ParsedCsvDocument {
  const records = parseCsvRecords(text);

  if (records.length < 2) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].values
    .map((header) => normalizeCsvHeader(header))
    .filter(Boolean);

  if (headers.length === 0) {
    return { headers: [], rows: [] };
  }

  const rows = records.slice(1).map(({ values, lineNumber }) => {
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return { lineNumber, values: row };
  });

  return { headers, rows };
}


function detectCsvImportMapping(headers: string[]): CsvImportMapping {
  const mapping = getEmptyCsvImportMapping();

  for (const field of CSV_IMPORT_FIELDS) {
    const aliases = CSV_IMPORT_FIELD_ALIASES[field.key].map(normalizeCsvHeader);
    mapping[field.key] = headers.find((header) => aliases.includes(header)) ?? "";
  }

  return mapping;
}

function getCsvValue(row: Record<string, string>, aliases: string[], mappingHeader = "") {
  if (mappingHeader) {
    const mappedValue = row[normalizeCsvHeader(mappingHeader)];
    if (mappedValue) return mappedValue;
  }

  for (const alias of aliases) {
    const value = row[normalizeCsvHeader(alias)];

    if (value) return value;
  }

  return "";
}

function getMappedCsvValue(row: Record<string, string>, field: CsvImportFieldKey, mapping: CsvImportMapping) {
  return getCsvValue(row, CSV_IMPORT_FIELD_ALIASES[field], mapping[field]);
}

function normalizeImportedItemType(value: string): VaultItemType {
  const normalized = value.trim().toLowerCase();

  if (["secure_note", "secure note", "note", "nota", "nota segura"].includes(normalized)) return "secure_note";
  if (["card", "cartao", "cartão", "tarjeta"].includes(normalized)) return "card";
  if (["identity", "identidade", "identidad", "kimlik"].includes(normalized)) return "identity";
  if (["license", "licenca", "licença", "licencia", "lisans"].includes(normalized)) return "license";

  return "credential";
}

function normalizeImportedCategory(value: string): CredentialCategory {
  const normalized = value.trim().toLowerCase();

  if (["pessoal", "personal"].includes(normalized)) return "Pessoal";
  if (["banco", "bank", "banco/bank"].includes(normalized)) return "Banco";
  if (["e-mail", "email", "mail"].includes(normalized)) return "E-mail";
  if (["sistema", "system", "sistema/system"].includes(normalized)) return "Sistema";
  if (["outro", "other", "otro", "diğer"].includes(normalized)) return "Outro";

  return "Trabalho";
}

function parseImportedTotpFields(row: Record<string, string>, mapping: CsvImportMapping, fallbackIssuer: string) {
  const rawSecret = getMappedCsvValue(row, "totpSecret", mapping);
  const rawIssuer = getMappedCsvValue(row, "totpIssuer", mapping) || fallbackIssuer;

  if (!rawSecret.trim()) {
    return { secret: "", issuer: rawIssuer };
  }

  try {
    const parsed = parseTotpCandidate(rawSecret, rawIssuer, "manual");

    if (!isStandardTotp(parsed)) {
      return { secret: "", issuer: parsed.issuer || rawIssuer };
    }

    return { secret: parsed.secret, issuer: parsed.issuer || rawIssuer };
  } catch {
    if (/^otpauth:\/\//i.test(rawSecret.trim())) {
      return { secret: "", issuer: rawIssuer };
    }

    return { secret: normalizeTotpSecret(rawSecret), issuer: rawIssuer };
  }
}

function importedTotpLooksUnsupported(row: Record<string, string>, mapping: CsvImportMapping) {
  const rawSecret = getMappedCsvValue(row, "totpSecret", mapping);

  if (!/^otpauth:\/\//i.test(rawSecret.trim())) return false;

  try {
    const parsed = parseTotpCandidate(rawSecret, getMappedCsvValue(row, "totpIssuer", mapping), "manual");
    return !isStandardTotp(parsed);
  } catch {
    return true;
  }
}

function rowToImportedCredential(row: Record<string, string>, now: string, mapping = getEmptyCsvImportMapping()): CredentialRecord {
  const itemType = normalizeImportedItemType(getMappedCsvValue(row, "type", mapping));
  const title =
    getMappedCsvValue(row, "title", mapping) ||
    getMappedCsvValue(row, "url", mapping) ||
    getMappedCsvValue(row, "username", mapping) ||
    "Item importado";
  const importedTotp = itemType === "credential"
    ? parseImportedTotpFields(row, mapping, title)
    : { secret: "", issuer: "" };

  return {
    id: createId(),
    itemType,
    title: title.trim(),
    category: normalizeImportedCategory(getMappedCsvValue(row, "category", mapping)),
    tags: normalizeCredentialTags(getMappedCsvValue(row, "tags", mapping)),
    favorite: ["true", "1", "sim", "yes"].includes(getMappedCsvValue(row, "favorite", mapping).toLowerCase()),
    username: itemType === "credential" ? getMappedCsvValue(row, "username", mapping) : "",
    password: itemType === "credential" ? getMappedCsvValue(row, "password", mapping) : "",
    url: itemType === "credential" ? normalizeUrl(getMappedCsvValue(row, "url", mapping)) : "",
    notes: getMappedCsvValue(row, "notes", mapping),
    passwordChangedAt: getCsvValue(row, ["passwordchangedat", "password_changed_at", "alterada_em"]) || now,
    passwordExpiresInDays: Number(getCsvValue(row, ["passwordexpiresindays", "password_expires_in_days", "validade_dias"])) || 0,
    passwordExpiryNoticeDays: Number(getCsvValue(row, ["passwordexpirynoticedays", "password_expiry_notice_days", "aviso_dias"])) || 15,
    passwordHistory: [],
    attachments: [],
    totpIssuer: importedTotp.issuer,
    totpSecret: importedTotp.secret,
    cardholderName: itemType === "card" ? getCsvValue(row, ["cardholdername", "card_holder", "nome_cartao"]) : "",
    cardNumber: itemType === "card" ? getCsvValue(row, ["cardnumber", "card_number", "numero_cartao", "número_cartão"]) : "",
    cardExpiry: itemType === "card" ? getCsvValue(row, ["cardexpiry", "card_expiry", "validade_cartao"]) : "",
    cardCvv: itemType === "card" ? getCsvValue(row, ["cardcvv", "card_cvv", "cvv"]) : "",
    cardIssuer: itemType === "card" ? getCsvValue(row, ["cardissuer", "card_issuer", "banco_cartao", "emissor"]) : "",
    identityFullName: itemType === "identity" ? getCsvValue(row, ["identityfullname", "identity_full_name", "nome_completo"]) : "",
    identityDocument: itemType === "identity" ? getCsvValue(row, ["identitydocument", "identity_document", "documento"]) : "",
    identityEmail: itemType === "identity" ? getCsvValue(row, ["identityemail", "identity_email"]) : "",
    identityPhone: itemType === "identity" ? getCsvValue(row, ["identityphone", "identity_phone", "telefone"]) : "",
    identityAddress: itemType === "identity" ? getCsvValue(row, ["identityaddress", "identity_address", "endereco", "endereço"]) : "",
    licenseProduct: itemType === "license" ? getCsvValue(row, ["licenseproduct", "license_product", "produto"]) : "",
    licenseKey: itemType === "license" ? getCsvValue(row, ["licensekey", "license_key", "chave", "serial"]) : "",
    licenseOwner: itemType === "license" ? getCsvValue(row, ["licenseowner", "license_owner", "proprietario", "proprietário"]) : "",
    licenseExpiresAt: itemType === "license" ? getCsvValue(row, ["licenseexpiresat", "license_expires_at", "expira_em"]) : "",
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeDuplicateValue(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function hasImportableCredentialContent(credential: CredentialRecord) {
  return Boolean(
    credential.title.trim() !== "Item importado" ||
      credential.username.trim() ||
      credential.password.trim() ||
      credential.url.trim() ||
      credential.notes.trim() ||
      credential.totpSecret?.trim(),
  );
}

function findDuplicateCredential(candidate: CredentialRecord, existingCredentials: CredentialRecord[]) {
  const candidateUrl = normalizeDuplicateValue(candidate.url);
  const candidateUser = normalizeDuplicateValue(candidate.username);
  const candidateTitle = normalizeDuplicateValue(candidate.title);

  return existingCredentials.find((existing) => {
    const existingUrl = normalizeDuplicateValue(existing.url);
    const existingUser = normalizeDuplicateValue(existing.username);
    const existingTitle = normalizeDuplicateValue(existing.title);

    if (candidate.itemType !== (existing.itemType ?? "credential")) return false;
    if (candidateUrl && existingUrl && candidateUser && existingUser) {
      return candidateUrl === existingUrl && candidateUser === existingUser;
    }
    if (candidateTitle && existingTitle && candidateUser && existingUser) {
      return candidateTitle === existingTitle && candidateUser === existingUser;
    }
    if (candidateUrl && existingUrl && candidateTitle && existingTitle) {
      return candidateUrl === existingUrl && candidateTitle === existingTitle;
    }

    return false;
  });
}

function analyzeCsvImport(preview: CsvImportPreview | null, vault: PlainVault | null, includeDuplicates: boolean): CsvImportAnalysis {
  if (!preview || !vault) {
    return {
      items: [],
      validItems: [],
      importableItems: [],
      totalRows: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
    };
  }

  const now = new Date().toISOString();
  const activeCredentials = getActiveCredentials(vault.credentials);
  const items = preview.rows.map((row) => {
    const credential = rowToImportedCredential(row.values, now, preview.mapping);
    const errors: string[] = [];
    const warnings: string[] = [];
    const duplicate = findDuplicateCredential(credential, activeCredentials);

    if (!hasImportableCredentialContent(credential)) {
      errors.push("import.validation.emptyRow");
    }

    if (credential.itemType === "credential" && !credential.password.trim()) {
      warnings.push("import.validation.missingPassword");
    }

    if (credential.itemType === "credential" && importedTotpLooksUnsupported(row.values, preview.mapping)) {
      warnings.push("import.validation.totpSkipped");
    }

    if (duplicate) {
      warnings.push("import.validation.duplicate");
    }

    return {
      id: `${row.lineNumber}-${credential.id}`,
      lineNumber: row.lineNumber,
      credential,
      errors,
      warnings,
      duplicateTitle: duplicate?.title,
    };
  });
  const validItems = items.filter((item) => item.errors.length === 0);
  const importableItems = validItems.filter((item) => includeDuplicates || !item.duplicateTitle);

  return {
    items,
    validItems,
    importableItems,
    totalRows: items.length,
    validCount: validItems.length,
    invalidCount: items.length - validItems.length,
    duplicateCount: items.filter((item) => Boolean(item.duplicateTitle)).length,
  };
}

function getPasswordHistory(credential: CredentialRecord): PasswordHistoryEntry[] {
  return credential.passwordHistory ?? [];
}

function daysBetween(startIso: string | undefined, end = new Date()) {
  if (!startIso) return 0;

  const start = new Date(startIso).getTime();

  if (Number.isNaN(start)) return 0;

  return Math.floor((end.getTime() - start) / (24 * 60 * 60 * 1000));
}

function getActiveCredentials(credentials: CredentialRecord[]) {
  return credentials.filter((credential) => !credential.deletedAt);
}

function getDeletedCredentials(credentials: CredentialRecord[]) {
  return credentials.filter((credential) => Boolean(credential.deletedAt));
}

function getCredentialPasswordChangedAt(credential: CredentialRecord) {
  return credential.passwordChangedAt ?? credential.updatedAt ?? credential.createdAt;
}

function getPasswordExpiryInfo(credential: CredentialRecord) {
  if (!isCredentialItem(credential)) {
    return {
      status: "never" as PasswordExpiryStatus,
      daysLeft: null as number | null,
    };
  }

  const expiresInDays = Number(credential.passwordExpiresInDays ?? 0);
  const noticeDays = Number(credential.passwordExpiryNoticeDays ?? 15);

  if (!expiresInDays || expiresInDays <= 0) {
    return {
      status: "never" as PasswordExpiryStatus,
      daysLeft: null as number | null,
    };
  }

  const changedAt = new Date(getCredentialPasswordChangedAt(credential)).getTime();

  if (Number.isNaN(changedAt)) {
    return {
      status: "never" as PasswordExpiryStatus,
      daysLeft: null as number | null,
    };
  }

  const expiresAt = changedAt + expiresInDays * 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));

  if (daysLeft < 0) {
    return {
      status: "expired" as PasswordExpiryStatus,
      daysLeft,
    };
  }

  if (daysLeft <= noticeDays) {
    return {
      status: "soon" as PasswordExpiryStatus,
      daysLeft,
    };
  }

  return {
    status: "valid" as PasswordExpiryStatus,
    daysLeft,
  };
}

function getExpiryBadgeClass(status: PasswordExpiryStatus) {
  if (status === "expired") return "expiryBadge expired";
  if (status === "soon") return "expiryBadge soon";
  if (status === "valid") return "expiryBadge valid";
  return "expiryBadge never";
}

function getCredentialDiagnosticIssues(
  credential: CredentialRecord,
  passwordCounts: Map<string, number>,
): DiagnosticIssue[] {
  if (!isCredentialItem(credential)) return [];

  const issues: DiagnosticIssue[] = [];
  const normalizedPassword = credential.password.trim();
  const expiryInfo = getPasswordExpiryInfo(credential);

  if (!normalizedPassword || getPasswordScore(normalizedPassword) < 60) {
    issues.push("weak");
  }

  if (normalizedPassword && (passwordCounts.get(normalizedPassword) ?? 0) > 1) {
    issues.push("reused");
  }

  if (expiryInfo.status === "expired") {
    issues.push("expired");
  } else if (expiryInfo.status === "soon") {
    issues.push("expiring");
  }

  if (daysBetween(getCredentialPasswordChangedAt(credential)) >= OLD_PASSWORD_DAYS) {
    issues.push("old");
  }

  if (!credential.totpSecret?.trim()) {
    issues.push("missingTotp");
  }

  if (!credential.url.trim() || !credential.username.trim()) {
    issues.push("incomplete");
  }

  return issues;
}

function getVaultHealthTone(score: number) {
  if (score >= 85) return "safe";
  if (score >= 70) return "good";
  if (score >= 50) return "warning";
  return "danger";
}

function getVaultHealthScore(issueCounts: Record<DiagnosticIssue, number>) {
  const penalties =
    issueCounts.expired * 12 +
    issueCounts.reused * 10 +
    issueCounts.weak * 8 +
    issueCounts.expiring * 5 +
    issueCounts.old * 4 +
    issueCounts.missingTotp * 3 +
    issueCounts.incomplete * 2;

  return Math.max(0, Math.min(100, 100 - penalties));
}

function normalizeVault(vault: PlainVault): PlainVault {
  const now = new Date().toISOString();

  return {
    ...vault,
    credentials: (vault.credentials ?? []).map((credential) => {
      const itemType = credential.itemType ?? "credential";

      return {
        ...credential,
        itemType,
        username: credential.username ?? "",
        password: credential.password ?? "",
        url: credential.url ?? "",
        notes: credential.notes ?? "",
        favorite: credential.favorite ?? false,
        passwordChangedAt:
          itemType === "credential"
            ? credential.passwordChangedAt ?? credential.updatedAt ?? credential.createdAt ?? now
            : credential.passwordChangedAt,
        passwordExpiresInDays: itemType === "credential" ? credential.passwordExpiresInDays ?? 0 : credential.passwordExpiresInDays ?? 0,
        passwordExpiryNoticeDays: itemType === "credential" ? credential.passwordExpiryNoticeDays ?? 15 : credential.passwordExpiryNoticeDays ?? 15,
        passwordHistory: Array.isArray(credential.passwordHistory) ? credential.passwordHistory : [],
        attachments: Array.isArray(credential.attachments) ? credential.attachments : [],
        totpSecret: credential.totpSecret ?? "",
        totpIssuer: credential.totpIssuer ?? "",
        cardholderName: credential.cardholderName ?? "",
        cardNumber: credential.cardNumber ?? "",
        cardExpiry: credential.cardExpiry ?? "",
        cardCvv: credential.cardCvv ?? "",
        cardIssuer: credential.cardIssuer ?? "",
        identityFullName: credential.identityFullName ?? "",
        identityDocument: credential.identityDocument ?? "",
        identityEmail: credential.identityEmail ?? "",
        identityPhone: credential.identityPhone ?? "",
        identityAddress: credential.identityAddress ?? "",
        licenseProduct: credential.licenseProduct ?? "",
        licenseKey: credential.licenseKey ?? "",
        licenseOwner: credential.licenseOwner ?? "",
        licenseExpiresAt: credential.licenseExpiresAt ?? "",
      };
    }),
    settings: {
      autoLockMinutes: vault.settings?.autoLockMinutes ?? 10,
      backupIntervalHours: vault.settings?.backupIntervalHours ?? 4,
      clipboardClearSeconds: vault.settings?.clipboardClearSeconds ?? CLIPBOARD_CLEAR_SECONDS,
      masterPasswordChangedAt:
        vault.settings?.masterPasswordChangedAt ?? vault.createdAt ?? now,
      lastPasswordRotationReminderAt: vault.settings?.lastPasswordRotationReminderAt,
      lockOnMinimize: vault.settings?.lockOnMinimize ?? true,
      lockOnClose: vault.settings?.lockOnClose ?? true,
      lockOnInactive: vault.settings?.lockOnInactive ?? true,
      notifyOnTray: vault.settings?.notifyOnTray ?? true,
      soundOnTray: vault.settings?.soundOnTray ?? true,
    },
  };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("credentials");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarHorizontal, setSidebarHorizontal] = useState(false);
  const [appTheme, setAppTheme] = useState<AppTheme>(() =>
    getStoredValue<AppTheme>("kpassword:theme", "dark"),
  );
  const [fontScale, setFontScale] = useState<FontScale>(() =>
    getStoredValue<FontScale>("kpassword:font-scale", "normal"),
  );
  const [reduceMotion, setReduceMotion] = useState(() =>
    getStoredValue<string>("kpassword:reduce-motion", "false") === "true",
  );
  const [compactMode, setCompactMode] = useState(() =>
    getStoredValue<string>("kpassword:compact-mode", "false") === "true",
  );
  const [vault, setVault] = useState<PlainVault | null>(null);
  const [encryptedVault, setEncryptedVault] = useState<EncryptedVaultFile | null>(null);
  const [masterPassword, setMasterPassword] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [mode, setMode] = useState<"loading" | "setup" | "locked" | "unlocked">("loading");
  const [busy, setBusy] = useState(false);
  const [unlockGateOpen, setUnlockGateOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [activeDiagnosticFilter, setActiveDiagnosticFilter] = useState<DiagnosticFilter>("all");
  const [activeQuickFilter, setActiveQuickFilter] = useState<QuickVaultFilter>("all");
  const [quickFilterMenuOpen, setQuickFilterMenuOpen] = useState(false);
  const [activeTagFilter, setActiveTagFilter] = useState("");
  const [assistantFocusId, setAssistantFocusId] = useState("");
  const [assistantSkippedIds, setAssistantSkippedIds] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailCredentialId, setDetailCredentialId] = useState<string | null>(null);
  const [credentialForm, setCredentialForm] = useState(getEmptyCredential);
  const [credentialTagsInput, setCredentialTagsInput] = useState("");
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [showStoragePaths, setShowStoragePaths] = useState(false);
  const [securityAdvancedOpen, setSecurityAdvancedOpen] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [visibleHistoryPasswords, setVisibleHistoryPasswords] = useState<Record<string, boolean>>({});
  const [copiedField, setCopiedField] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [currentMasterPassword, setCurrentMasterPassword] = useState("");
  const [newMasterPassword, setNewMasterPassword] = useState("");
  const [newMasterConfirm, setNewMasterConfirm] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [backupVerifyPassword, setBackupVerifyPassword] = useState("");
  const [backupVerifyResult, setBackupVerifyResult] = useState<BackupVerificationReport | null>(null);
  const [exportPassword, setExportPassword] = useState("");
  const [csvExportDialogOpen, setCsvExportDialogOpen] = useState(false);
  const [csvExportAcknowledged, setCsvExportAcknowledged] = useState(false);
  const [csvImportPreview, setCsvImportPreview] = useState<CsvImportPreview | null>(null);
  const [csvImportIncludeDuplicates, setCsvImportIncludeDuplicates] = useState(false);
  const [restorePopupOpen, setRestorePopupOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");
  const [activeVaultName, setActiveVaultName] = useState(() =>
    getStoredValue<string>("kpassword:active-vault", DEFAULT_VAULT_NAME),
  );
  const [windowsHelloStatus, setWindowsHelloStatus] = useState<WindowsHelloStatus>(DEFAULT_WINDOWS_HELLO_STATUS);
  const [windowsHelloBusy, setWindowsHelloBusy] = useState(false);
  const [vaultFiles, setVaultFiles] = useState<VaultFileInfo[]>([]);
  const [newVaultName, setNewVaultName] = useState("");
  const [totpTick, setTotpTick] = useState(Date.now());
  const [detailTotpCode, setDetailTotpCode] = useState("");
  const [totpSetupOpen, setTotpSetupOpen] = useState(false);
  const [totpSetupMode, setTotpSetupMode] = useState<TotpSetupMode>("choice");
  const [totpManualValue, setTotpManualValue] = useState("");
  const [totpManualIssuer, setTotpManualIssuer] = useState("");
  const [totpPreview, setTotpPreview] = useState<TotpPreview | null>(null);
  const [totpSetupError, setTotpSetupError] = useState("");
  const [totpQrBusy, setTotpQrBusy] = useState(false);
  const [totpScreenImage, setTotpScreenImage] = useState("");
  const [totpScreenSelection, setTotpScreenSelection] = useState<TotpScreenSelection | null>(null);
  const [totpScreenDragStart, setTotpScreenDragStart] = useState<{ x: number; y: number } | null>(null);
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(getInitialLanguage);
  const [generatorMode, setGeneratorMode] = useState<PasswordGeneratorMode>("random");
  const [generatorLength, setGeneratorLength] = useState(24);
  const [generatorLowercase, setGeneratorLowercase] = useState(true);
  const [generatorUppercase, setGeneratorUppercase] = useState(true);
  const [generatorNumbers, setGeneratorNumbers] = useState(true);
  const [generatorSymbols, setGeneratorSymbols] = useState(true);
  const [generatorAvoidAmbiguous, setGeneratorAvoidAmbiguous] = useState(true);
  const lastActivityRef = useRef(Date.now());
  const clipboardCleanupRef = useRef<number | null>(null);
  const quickFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const totpImageInputRef = useRef<HTMLInputElement | null>(null);
  const totpScreenImageRef = useRef<HTMLImageElement | null>(null);

  const t = useCallback(
    (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
      translate(appLanguage, key, values),
    [appLanguage],
  );

  const csvImportAnalysis = useMemo(
    () => analyzeCsvImport(csvImportPreview, vault, csvImportIncludeDuplicates),
    [csvImportPreview, csvImportIncludeDuplicates, vault],
  );

  const requestTrayProtection = useCallback((reason: "inactive" | "minimize" | "close") => {
    window.dispatchEvent(new CustomEvent("kpassword:protect-to-tray", { detail: { reason } }));
  }, []);


  const askConfirmation = useCallback(
    (options: Omit<ConfirmDialog, "resolve">) =>
      new Promise<boolean>((resolve) => {
        setConfirmDialog({
          ...options,
          resolve,
        });
      }),
    [],
  );

  function closeConfirmDialog(confirmed: boolean) {
    confirmDialog?.resolve(confirmed);
    setConfirmDialog(null);
  }

  useEffect(() => {
    document.documentElement.lang = appLanguage;
    localStorage.setItem("kpassword:language", appLanguage);
  }, [appLanguage]);

  useEffect(() => {
    localStorage.setItem("kpassword:active-vault", activeVaultName);
  }, [activeVaultName]);

  useEffect(() => {
    const interval = window.setInterval(() => setTotpTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!totpPreview) return;

    let cancelled = false;

    void generateTotp(totpPreview.secret, totpTick)
      .then((code) => {
        if (cancelled) return;
        setTotpPreview((current) => (
          current && current.secret === totpPreview.secret && current.currentCode !== code
            ? { ...current, currentCode: code }
            : current
        ));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [totpPreview?.secret, totpTick]);
  useEffect(() => {
    if (!quickFilterMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && quickFilterMenuRef.current?.contains(target)) {
        return;
      }
      setQuickFilterMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuickFilterMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [quickFilterMenuOpen]);


  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 980px)");

    const syncSidebarMode = () => {
      setSidebarHorizontal(mediaQuery.matches);
    };

    syncSidebarMode();
    mediaQuery.addEventListener("change", syncSidebarMode);

    return () => mediaQuery.removeEventListener("change", syncSidebarMode);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = appTheme;
    document.documentElement.dataset.fontScale = fontScale;
    document.documentElement.dataset.motion = reduceMotion ? "reduced" : "normal";
    document.documentElement.dataset.density = compactMode ? "compact" : "normal";

    localStorage.setItem("kpassword:theme", appTheme);
    localStorage.setItem("kpassword:font-scale", fontScale);
    localStorage.setItem("kpassword:reduce-motion", String(reduceMotion));
    localStorage.setItem("kpassword:compact-mode", String(compactMode));
  }, [appTheme, fontScale, reduceMotion, compactMode]);

  useEffect(() => {
    const secret = detailCredentialId && vault
      ? vault.credentials.find((credential) => credential.id === detailCredentialId)?.totpSecret
      : "";

    if (!secret) {
      setDetailTotpCode("");
      return;
    }

    let cancelled = false;

    void generateTotp(secret, totpTick)
      .then((code) => {
        if (!cancelled) setDetailTotpCode(code);
      })
      .catch(() => {
        if (!cancelled) setDetailTotpCode("");
      });

    return () => {
      cancelled = true;
    };
  }, [detailCredentialId, totpTick, vault]);

  useEffect(() => {
    if (!vault) return;

    localStorage.setItem("kpassword:auto-lock-minutes", String(vault.settings.autoLockMinutes ?? 10));
    localStorage.setItem("kpassword:lock-on-minimize", String(vault.settings.lockOnMinimize ?? true));
    localStorage.setItem("kpassword:lock-on-close", String(vault.settings.lockOnClose ?? true));
    localStorage.setItem("kpassword:lock-on-inactive", String(vault.settings.lockOnInactive ?? true));
    localStorage.setItem("kpassword:tray-notifications", String(vault.settings.notifyOnTray ?? true));
    localStorage.setItem("kpassword:tray-sound", String(vault.settings.soundOnTray ?? true));
    localStorage.setItem("kpassword:clipboard-clear-seconds", String(vault.settings.clipboardClearSeconds ?? CLIPBOARD_CLEAR_SECONDS));
  }, [vault]);

  const refreshVaultFiles = useCallback(async () => {
    try {
      const files = await listVaultFiles();
      setVaultFiles(files);
      return files;
    } catch (error) {
      console.error("Erro ao listar cofres:", error);
      return [];
    }
  }, []);

  const refreshStorageInfo = useCallback(async (vaultName = activeVaultName) => {
    try {
      const [info, backupFiles] = await Promise.all([
        getStorageInfo(vaultName),
        listBackupFiles(vaultName),
      ]);
      setStorageInfo(info);
      setBackups(backupFiles);
    } catch (error) {
      console.error("Erro ao carregar informações de armazenamento:", error);
    }
  }, [activeVaultName]);

  const refreshWindowsHelloStatus = useCallback(async (vaultName = activeVaultName) => {
    try {
      const status = await getWindowsHelloStatus(vaultName);
      setWindowsHelloStatus(status);
      return status;
    } catch (error) {
      console.error("Erro ao consultar Windows Hello:", error);
      const fallback = {
        ...DEFAULT_WINDOWS_HELLO_STATUS,
        vault_name: vaultName,
        reason: "",
      };
      setWindowsHelloStatus(fallback);
      return fallback;
    }
  }, [activeVaultName]);

  useEffect(() => {
    void (async () => {
      try {
        setMessage("");
        setUnlockGateOpen(false);
        setMode("loading");
        await refreshVaultFiles();
        await refreshWindowsHelloStatus(activeVaultName);
        const raw = await loadVaultFile(activeVaultName);

        if (!raw) {
          setEncryptedVault(null);
          setVault(null);
          setMode("setup");
          await refreshStorageInfo(activeVaultName);
          return;
        }

        setEncryptedVault(parseEncryptedVault(raw));
        setVault(null);
        setMasterPassword("");
        setUnlockPassword("");
        setMode("locked");
        await refreshStorageInfo(activeVaultName);
      } catch {
        setEncryptedVault(null);
        setVault(null);
        setMasterPassword("");
        setUnlockPassword("");
        setMessage(t("errors.loadVault"));
        setMode("locked");
      }
    })();
  }, [activeVaultName, refreshStorageInfo, refreshVaultFiles, refreshWindowsHelloStatus]);

  const lockVault = useCallback(() => {
    setVault(null);
    setMasterPassword("");
    setUnlockPassword("");
    setSetupPassword("");
    setConfirmPassword("");
    setVisiblePasswords({});
    setVisibleHistoryPasswords({});
    setDetailCredentialId(null);
    setUnlockGateOpen(false);
    setMessage("");
    setMode((current) => (current === "setup" ? "setup" : "locked"));
  }, []);

  useEffect(() => {
    const handler = () => lockVault();

    window.addEventListener("kpassword:lock", handler);

    return () => window.removeEventListener("kpassword:lock", handler);
  }, [lockVault]);

  useEffect(() => {
    if (mode !== "locked") {
      setUnlockGateOpen(false);
    }
  }, [mode]);

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (mode !== "unlocked") return;

    const events = ["pointerdown", "keydown", "mousemove", "touchstart", "focus"] as const;
    const activityHandler = () => markActivity();

    events.forEach((eventName) => window.addEventListener(eventName, activityHandler, { passive: true }));
    markActivity();

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, activityHandler));
    };
  }, [markActivity, mode]);

  useEffect(() => {
    if (mode !== "unlocked" || !vault?.settings.lockOnInactive) return;

    const interval = window.setInterval(() => {
      const autoLockMinutes = Math.max(1, vault.settings.autoLockMinutes ?? 10);
      const idleMs = Date.now() - lastActivityRef.current;

      if (!busy && !windowsHelloBusy && idleMs >= autoLockMinutes * 60_000) {
        requestTrayProtection("inactive");
        lockVault();
        setMessage(t("security.autoLocked"));
      }
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [busy, lockVault, mode, requestTrayProtection, t, vault?.settings.autoLockMinutes, vault?.settings.lockOnInactive, windowsHelloBusy]);

  useEffect(() => {
    if (mode !== "unlocked" || !vault?.settings.lockOnMinimize) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && !busy && !windowsHelloBusy) {
        requestTrayProtection("minimize");
        lockVault();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [busy, lockVault, mode, requestTrayProtection, vault?.settings.lockOnMinimize, windowsHelloBusy]);

  const persistVault = useCallback(
    async (nextVault: PlainVault, passwordOverride?: string, forceBackup = false) => {
      const password = passwordOverride ?? masterPassword;

      if (!password) {
        throw new Error(t("errors.masterPasswordUnavailable"));
      }

      const file = await encryptVault(nextVault, password, encryptedVault);
      const info = await saveVaultFile(JSON.stringify(file, null, 2), activeVaultName, forceBackup);

      setEncryptedVault(file);
      setVault({
        ...nextVault,
        updatedAt: file.updatedAt,
      });
      setStorageInfo(info);
      setBackups(info.backups);

      return file;
    },
    [activeVaultName, encryptedVault, masterPassword],
  );

  async function migrateLegacyVaultIfNeeded(
    file: EncryptedVaultFile,
    plainVault: PlainVault,
    password: string,
  ) {
    if (!needsCryptoMigration(file)) return;

    await createPreArgon2Backup(JSON.stringify(file, null, 2), activeVaultName);
    const migratedFile = await encryptVault(plainVault, password, null);
    const info = await saveVaultFile(JSON.stringify(migratedFile, null, 2), activeVaultName, false);

    setEncryptedVault(migratedFile);
    setStorageInfo(info);
    setBackups(info.backups);
  }
  useEffect(() => {
    if (!vault || mode !== "unlocked") {
      return;
    }

    const interval = window.setInterval(() => {
      void persistVault(vault).catch((error) => {
        console.error("Erro ao criar backup automático:", error);
      });
    }, vault.settings.backupIntervalHours * 60 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [mode, persistVault, vault]);

  async function handleCreateVault(event: FormEvent) {
    event.preventDefault();
    setMessage("");

    const issues = validateMasterPassword(setupPassword);

    if (issues.length > 0) {
      setMessage(issues.join(" "));
      return;
    }

    if (setupPassword !== confirmPassword) {
      setMessage(t("errors.confirmPasswordMismatch"));
      return;
    }

    const confirmed = await askConfirmation({
      title: t("dialog.createVaultTitle"),
      message:
        t("dialog.createVaultMessage"),
      confirmText: t("dialog.createVaultConfirm"),
      cancelText: t("dialog.cancel"),
    });

    if (!confirmed) {
      return;
    }

    setBusy(true);

    try {
      const newVault = normalizeVault(createEmptyVault());
      const file = await encryptVault(newVault, setupPassword);
      const info = await saveVaultFile(JSON.stringify(file, null, 2), activeVaultName, false);

      setEncryptedVault(file);
      setVault(newVault);
      setMasterPassword(setupPassword);
      setSetupPassword("");
      setConfirmPassword("");
      setStorageInfo(info);
      setBackups(info.backups);
      await refreshVaultFiles();
      await refreshWindowsHelloStatus(activeVaultName);
      setScreen("credentials");
      setMode("unlocked");
      setMessage("");
    } catch (error) {
      console.error(error);
      setMessage(t("errors.createVault"));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setUnlockGateOpen(false);

    if (!encryptedVault) {
      setMessage(t("errors.loadVault"));
      return;
    }

    setBusy(true);

    try {
      const plainVault = normalizeVault(await decryptVault(encryptedVault, unlockPassword));
      await migrateLegacyVaultIfNeeded(encryptedVault, plainVault, unlockPassword);

      setVault(plainVault);
      setMasterPassword(unlockPassword);
      setUnlockGateOpen(true);
      await new Promise((resolve) => window.setTimeout(resolve, 340));
      setUnlockGateOpen(false);
      await new Promise((resolve) => window.setTimeout(resolve, 70));
      setUnlockPassword("");
      setScreen("credentials");
      setMode("unlocked");
      setMessage("");
      await refreshStorageInfo();
      await refreshWindowsHelloStatus(activeVaultName);
      void maybeShowPasswordRotationReminder(plainVault);
      void maybeShowPasswordExpiryReminder(plainVault);
    } catch {
      setUnlockGateOpen(false);
      setMessage(t("errors.unlock"));
    } finally {
      setBusy(false);
    }
  }

  async function prepareWindowsHelloPrompt() {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.unminimize();
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setFocus();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      await appWindow.setFocus();
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    } catch (error) {
      console.error("Erro ao focar janela antes do Windows Hello:", error);
    }
  }

  async function releaseWindowsHelloPromptFocus() {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.setAlwaysOnTop(false);
      await appWindow.setFocus();
    } catch (error) {
      console.error("Erro ao normalizar janela depois do Windows Hello:", error);
    }
  }

  async function handleUnlockWithWindowsHello() {
    setMessage("");
    setUnlockGateOpen(false);

    if (!encryptedVault) {
      setMessage(t("errors.loadVault"));
      return;
    }

    setBusy(true);
    setWindowsHelloBusy(true);

    try {
      await prepareWindowsHelloPrompt();
      const password = await unlockWithWindowsHello(activeVaultName, t("windowsHello.promptUnlock"));
      const plainVault = normalizeVault(await decryptVault(encryptedVault, password));
      await migrateLegacyVaultIfNeeded(encryptedVault, plainVault, password);

      setVault(plainVault);
      setMasterPassword(password);
      setUnlockGateOpen(true);
      await new Promise((resolve) => window.setTimeout(resolve, 340));
      setUnlockGateOpen(false);
      await new Promise((resolve) => window.setTimeout(resolve, 70));
      setUnlockPassword("");
      setScreen("credentials");
      setMode("unlocked");
      setMessage("");
      await refreshStorageInfo();
      await refreshWindowsHelloStatus(activeVaultName);
      void maybeShowPasswordRotationReminder(plainVault);
      void maybeShowPasswordExpiryReminder(plainVault);
    } catch (error) {
      console.error(error);
      setUnlockGateOpen(false);
      setMessage(t("windowsHello.unlockError"));
      await refreshWindowsHelloStatus(activeVaultName);
    } finally {
      await releaseWindowsHelloPromptFocus();
      setWindowsHelloBusy(false);
      setBusy(false);
    }
  }

  async function handleEnableWindowsHello() {
    setMessage("");

    if (!masterPassword) {
      setMessage(t("errors.masterPasswordUnavailable"));
      return;
    }

    if (!windowsHelloStatus.available) {
      setMessage(t("windowsHello.unavailable"));
      await refreshWindowsHelloStatus(activeVaultName);
      return;
    }

    const confirmed = await askConfirmation({
      title: t("windowsHello.enableTitle"),
      message: t("windowsHello.enableMessage"),
      confirmText: t("windowsHello.enable"),
      cancelText: t("dialog.cancel"),
    });

    if (!confirmed) return;

    setBusy(true);
    setWindowsHelloBusy(true);

    try {
      await prepareWindowsHelloPrompt();
      const status = await enableWindowsHello(activeVaultName, masterPassword, t("windowsHello.promptEnable"));
      setWindowsHelloStatus(status);
      setMessage(t("windowsHello.enabledSuccess"));
    } catch (error) {
      console.error(error);
      setMessage(t("windowsHello.enableError"));
      await refreshWindowsHelloStatus(activeVaultName);
    } finally {
      await releaseWindowsHelloPromptFocus();
      setWindowsHelloBusy(false);
      setBusy(false);
    }
  }

  async function handleDisableWindowsHello() {
    setMessage("");

    const confirmed = await askConfirmation({
      title: t("windowsHello.disableTitle"),
      message: t("windowsHello.disableMessage"),
      confirmText: t("windowsHello.disable"),
      cancelText: t("dialog.cancel"),
      tone: "danger",
    });

    if (!confirmed) return;

    setBusy(true);
    setWindowsHelloBusy(true);

    try {
      const status = await disableWindowsHello(activeVaultName);
      setWindowsHelloStatus(status);
      setMessage(t("windowsHello.disabledSuccess"));
    } catch (error) {
      console.error(error);
      setMessage(t("windowsHello.disableError"));
      await refreshWindowsHelloStatus(activeVaultName);
    } finally {
      setWindowsHelloBusy(false);
      setBusy(false);
    }
  }

  async function handleSwitchVault(nextVaultName: string) {
    if (!nextVaultName || nextVaultName === activeVaultName) return;

    const confirmed = mode === "unlocked"
      ? await askConfirmation({
          title: t("vault.switchTitle"),
          message: t("vault.switchMessage"),
          confirmText: t("vault.switchConfirm"),
          cancelText: t("dialog.cancel"),
        })
      : true;

    if (!confirmed) return;

    setVault(null);
    setEncryptedVault(null);
    setMasterPassword("");
    setUnlockPassword("");
    setSetupPassword("");
    setConfirmPassword("");
    setDetailCredentialId(null);
    setFormOpen(false);
    setSearch("");
    setActiveDiagnosticFilter("all");
    setWindowsHelloStatus({ ...DEFAULT_WINDOWS_HELLO_STATUS, vault_name: nextVaultName });
    setActiveVaultName(nextVaultName);
  }

  async function handleCreateNewVault(nameOverride?: string) {
    const sourceName = typeof nameOverride === "string" ? nameOverride : newVaultName;
    const slug = createVaultSlug(sourceName);

    if (!slug) {
      setMessage(t("vault.invalidName"));
      return;
    }

    if (vaultFiles.some((item) => item.name === slug)) {
      setMessage(t("vault.alreadyExists"));
      return;
    }

    const confirmed = mode === "unlocked"
      ? await askConfirmation({
          title: t("vault.createTitle"),
          message: t("vault.createMessage"),
          confirmText: t("vault.createConfirm"),
          cancelText: t("dialog.cancel"),
        })
      : true;

    if (!confirmed) return;

    setNewVaultName("");
    setVault(null);
    setEncryptedVault(null);
    setMasterPassword("");
    setUnlockPassword("");
    setSetupPassword("");
    setConfirmPassword("");
    setDetailCredentialId(null);
    setFormOpen(false);
    setSearch("");
    setActiveDiagnosticFilter("all");
    setWindowsHelloStatus({ ...DEFAULT_WINDOWS_HELLO_STATUS, vault_name: slug });
    setActiveVaultName(slug);
    setMessage(t("vault.newVaultReady"));
  }

  async function maybeShowPasswordRotationReminder(currentVault: PlainVault) {
    const changedAt = currentVault.settings.masterPasswordChangedAt ?? currentVault.createdAt;
    const lastReminder = localStorage.getItem("kpassword:last-password-rotation-reminder");

    if (daysBetween(changedAt) < PASSWORD_ROTATION_DAYS) return;
    if (lastReminder && daysBetween(lastReminder) < PASSWORD_ROTATION_DAYS) return;

    localStorage.setItem("kpassword:last-password-rotation-reminder", new Date().toISOString());

    const confirmed = await askConfirmation({
      title: t("dialog.reviewMasterTitle"),
      message:
        t("dialog.reviewMasterMessage"),
      confirmText: t("dialog.openSecurity"),
      cancelText: t("dialog.remindLater"),
    });

    if (confirmed) {
      setScreen("settings");
    }
  }

  async function maybeShowPasswordExpiryReminder(currentVault: PlainVault) {
    const activeCredentials = getActiveCredentials(currentVault.credentials);
    const expired = activeCredentials.filter(
      (credential) => getPasswordExpiryInfo(credential).status === "expired",
    );
    const soon = activeCredentials.filter(
      (credential) => getPasswordExpiryInfo(credential).status === "soon",
    );

    if (expired.length === 0 && soon.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);
    const lastReminder = localStorage.getItem("kpassword:last-expiry-reminder");

    if (lastReminder === today) return;

    localStorage.setItem("kpassword:last-expiry-reminder", today);

    const confirmed = await askConfirmation({
      title: t("expiry.reminderTitle"),
      message: t("expiry.reminderMessage", { expired: expired.length, soon: soon.length }),
      confirmText: t("expiry.openDashboard"),
      cancelText: t("dialog.remindLater"),
    });

    if (confirmed) {
      setScreen("dashboard");
    }
  }

  async function handleChangeMasterPassword(event: FormEvent) {
    event.preventDefault();
    setMessage("");

    if (!vault || !encryptedVault) return;

    if (!currentMasterPassword) {
      setMessage(t("errors.currentPasswordRequired"));
      return;
    }

    const issues = validateMasterPassword(newMasterPassword);

    if (issues.length > 0) {
      setMessage(issues.join(" "));
      return;
    }

    if (newMasterPassword !== newMasterConfirm) {
      setMessage(t("errors.newPasswordMismatch"));
      return;
    }

    const confirmed = await askConfirmation({
      title: t("dialog.changeMasterTitle"),
      message:
        t("dialog.changeMasterMessage"),
      confirmText: t("dialog.changeMasterConfirm"),
      cancelText: t("dialog.cancel"),
    });

    if (!confirmed) return;

    setBusy(true);

    try {
      await decryptVault(encryptedVault, currentMasterPassword);

      const now = new Date().toISOString();
      const nextVault = normalizeVault({
        ...vault,
        updatedAt: now,
        settings: {
          ...vault.settings,
          masterPasswordChangedAt: now,
          lastPasswordRotationReminderAt: now,
        },
      });
      const file = await encryptVault(nextVault, newMasterPassword, null);
      const info = await saveVaultFile(JSON.stringify(file, null, 2), activeVaultName);

      setEncryptedVault(file);
      setVault({ ...nextVault, updatedAt: file.updatedAt });
      setMasterPassword(newMasterPassword);
      setCurrentMasterPassword("");
      setNewMasterPassword("");
      setNewMasterConfirm("");
      setStorageInfo(info);
      setBackups(info.backups);

      if (windowsHelloStatus.enabled) {
        try {
          const status = await enableWindowsHello(activeVaultName, newMasterPassword, t("windowsHello.promptEnable"));
          setWindowsHelloStatus(status);
        } catch (helloError) {
          console.error(helloError);
          const status = await disableWindowsHello(activeVaultName);
          setWindowsHelloStatus(status);
          setMessage(t("windowsHello.reenableNeeded"));
          return;
        }
      }

      setMessage(t("success.masterPasswordChanged"));
    } catch {
      setMessage(t("errors.changeMaster"));
    } finally {
      setBusy(false);
    }
  }

  async function restoreBackupFromText(raw: string, password: string) {
    if (!password) {
      setMessage(t("errors.backupPasswordRequired"));
      return;
    }

    setMessage("");

    try {
      const { file: parsed, plainVault } = await validateEncryptedVaultBackup(raw, password);
      const restoredVault = normalizeVault(plainVault);

      const confirmed = await askConfirmation({
        title: t("dialog.restoreBackupTitle"),
        message:
          t("dialog.restoreBackupMessage"),
        confirmText: t("dialog.restoreBackupTitle"),
        cancelText: t("dialog.cancel"),
        tone: "danger",
      });

      if (!confirmed) return;

      if (vault && masterPassword) {
        await persistVault(vault, undefined, true);
      }

      const info = await saveVaultFile(raw, activeVaultName, false);

      setEncryptedVault(parsed);
      setVault(restoredVault);
      setMasterPassword(password);
      setRestorePassword("");
      setRestorePopupOpen(false);
      setStorageInfo(info);
      setBackups(info.backups);
      setScreen("credentials");
      setMode("unlocked");
      setMessage(t("success.backupRestored"));
    } catch {
      setMessage(t("errors.restoreBackup"));
    }
  }

  async function handleBackupFileInput(file: File | undefined | null, password: string) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".kpvault")) {
      setMessage(t("errors.restoreBackup"));
      return;
    }

    try {
      const raw = await file.text();
      await restoreBackupFromText(raw, password);
    } catch {
      setMessage(t("errors.restoreBackup"));
    }
  }

  function showBackupVerifyFailure(messageKey = "backupVerify.failureToast") {
    setBackupVerifyResult({
      ok: false,
      message: "backup_verification_failed",
    });
    setMessage(t(messageKey));
  }

  async function handleVerifyBackupFile(file: File | undefined | null, password: string) {
    if (!file) return;

    setBackupVerifyResult(null);

    if (!password.trim()) {
      showBackupVerifyFailure("backupVerify.passwordRequired");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".kpvault")) {
      showBackupVerifyFailure("backupVerify.failureToast");
      setBackupVerifyPassword("");
      return;
    }

    try {
      setMessage(t("backupVerify.checking"));
      const raw = await readFileAsText(file);
      const report = await verifyEncryptedVaultBackup(raw, password);

      setBackupVerifyResult(report);
      setMessage(report.ok ? t("backupVerify.successToast") : t("backupVerify.failureToast"));
    } catch {
      showBackupVerifyFailure("backupVerify.failureToast");
    } finally {
      setBackupVerifyPassword("");
    }
  }

  async function handleCheckUpdates() {
    setUpdateStatus(t("updates.checking"));

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");

      const update = await check();

      if (!update) {
        setUpdateStatus(t("updates.none", { version: APP_VERSION }));
        return;
      }

      setUpdateStatus(t("updates.found", { version: update.version }));

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setUpdateStatus(t("updates.started"));
          return;
        }

        if (event.event === "Progress") {
          const loaded = "data" in event && typeof event.data === "object" && event.data && "chunkLength" in event.data
            ? Number(event.data.chunkLength)
            : 0;

          if (loaded > 0) {
            setUpdateStatus(t("updates.progress"));
          }
          return;
        }

        if (event.event === "Finished") {
          setUpdateStatus(t("updates.finished"));
        }
      });

      setUpdateStatus(t("updates.restarting"));
      await relaunch();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setUpdateStatus(t("updates.error", { detail }));
    }
  }

  function clampVaultInteger(value: unknown, fallback: number, min: number, max: number) {
    const numericValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numericValue)));
  }

  function getBoundedVaultInputValue(value: string, fallback: number, min: number, max: number) {
    if (!value.trim()) return fallback;
    return clampVaultInteger(Number(value), fallback, min, max);
  }

  async function updateVaultSettings(nextSettings: Partial<PlainVault["settings"]>) {
    if (!vault) return;

    const mergedSettings = {
      ...vault.settings,
      ...nextSettings,
    };

    const safeSettings = {
      ...mergedSettings,
      autoLockMinutes: clampVaultInteger(mergedSettings.autoLockMinutes, 10, 1, 120),
      clipboardClearSeconds: clampVaultInteger(mergedSettings.clipboardClearSeconds, CLIPBOARD_CLEAR_SECONDS, 10, 300),
      backupIntervalHours: clampVaultInteger(mergedSettings.backupIntervalHours, 4, 1, 24),
    };

    const nextVault = normalizeVault({
      ...vault,
      settings: safeSettings,
      updatedAt: new Date().toISOString(),
    });

    try {
      await persistVault(nextVault);
      setMessage(t("success.settingsUpdated"));
    } catch {
      setMessage(t("errors.saveSettings"));
    }
  }

  function getExpiryLabel(credential: CredentialRecord) {
    const info = getPasswordExpiryInfo(credential);

    if (info.status === "never") return t("expiry.never");
    if (info.status === "expired") return t("expiry.expired");
    if (info.status === "soon") return t("expiry.soon", { days: Math.max(info.daysLeft ?? 0, 0) });
    return t("expiry.valid", { days: info.daysLeft ?? 0 });
  }

  function generateCredentialPassword() {
    const nextPassword = generatePassword({
      mode: generatorMode,
      length: generatorLength,
      includeLowercase: generatorLowercase,
      includeUppercase: generatorUppercase,
      includeNumbers: generatorNumbers,
      includeSymbols: generatorSymbols,
      avoidAmbiguous: generatorAvoidAmbiguous,
    });

    setCredentialForm((current) => ({
      ...current,
      password: nextPassword,
    }));
  }

  function openNewCredentialForm() {
    setEditingId(null);
    setCredentialForm(getEmptyCredential());
    setCredentialTagsInput("");
    setFormOpen(true);
  }

  function openEditCredentialForm(credential: CredentialRecord) {
    setEditingId(credential.id);
    setCredentialForm({
      itemType: getItemType(credential),
      title: credential.title,
      username: credential.username ?? "",
      password: credential.password ?? "",
      url: credential.url ?? "",
      category: credential.category,
      tags: getCredentialTags(credential),
      notes: credential.notes ?? "",
      favorite: credential.favorite,
      passwordChangedAt: getCredentialPasswordChangedAt(credential),
      passwordExpiresInDays: credential.passwordExpiresInDays ?? 0,
      passwordExpiryNoticeDays: credential.passwordExpiryNoticeDays ?? 15,
      passwordHistory: getPasswordHistory(credential),
      attachments: getAttachments(credential),
      totpSecret: credential.totpSecret ?? "",
      totpIssuer: credential.totpIssuer ?? "",
      cardholderName: credential.cardholderName ?? "",
      cardNumber: credential.cardNumber ?? "",
      cardExpiry: credential.cardExpiry ?? "",
      cardCvv: credential.cardCvv ?? "",
      cardIssuer: credential.cardIssuer ?? "",
      identityFullName: credential.identityFullName ?? "",
      identityDocument: credential.identityDocument ?? "",
      identityEmail: credential.identityEmail ?? "",
      identityPhone: credential.identityPhone ?? "",
      identityAddress: credential.identityAddress ?? "",
      licenseProduct: credential.licenseProduct ?? "",
      licenseKey: credential.licenseKey ?? "",
      licenseOwner: credential.licenseOwner ?? "",
      licenseExpiresAt: credential.licenseExpiresAt ?? "",
    });
    setCredentialTagsInput(formatTagsForInput(credential.tags));
    setFormOpen(true);
  }


  function resetTotpSetup() {
    setTotpSetupMode("choice");
    setTotpManualValue("");
    setTotpManualIssuer("");
    setTotpPreview(null);
    setTotpSetupError("");
    setTotpQrBusy(false);
    setTotpScreenImage("");
    setTotpScreenSelection(null);
    setTotpScreenDragStart(null);
  }

  function openTotpSetup(mode: TotpSetupMode = "choice") {
    setTotpSetupMode(mode);
    setTotpManualValue(credentialForm.totpSecret ?? "");
    setTotpManualIssuer(credentialForm.totpIssuer ?? credentialForm.title ?? "");
    setTotpPreview(null);
    setTotpSetupError("");
    setTotpScreenImage("");
    setTotpScreenSelection(null);
    setTotpScreenDragStart(null);
    setTotpSetupOpen(true);
  }

  function closeTotpSetup() {
    setTotpSetupOpen(false);
    resetTotpSetup();
  }

  async function validateTotpQrImageFile(file: File) {
    if (file.size > MAX_TOTP_QR_IMAGE_BYTES) {
      throw new Error("totp.easy.errorImageTooLarge");
    }

    const bitmap = await createImageBitmap(file);

    try {
      const pixels = bitmap.width * bitmap.height;

      if (bitmap.width > MAX_TOTP_QR_IMAGE_SIDE || bitmap.height > MAX_TOTP_QR_IMAGE_SIDE || pixels > MAX_TOTP_QR_IMAGE_PIXELS) {
        throw new Error("totp.easy.errorImageTooLarge");
      }
    } finally {
      bitmap.close();
    }
  }

  async function prepareTotpPreview(rawValue: string, source: TotpSetupSource, fallbackIssuer = credentialForm.totpIssuer || credentialForm.title): Promise<boolean> {
    try {
      const candidate = parseTotpCandidate(rawValue, fallbackIssuer, source);

      if (!isStandardTotp(candidate)) {
        setTotpSetupError(t("totp.easy.errorUnsupported"));
        setTotpPreview(null);
        setTotpSetupMode(source === "manual" ? "manual" : source === "screen" ? "screenCrop" : "choice");
        return false;
      }

      const currentCode = await generateTotp(candidate.secret);
      setTotpPreview({ ...candidate, currentCode });
      setTotpSetupMode("preview");
      setTotpSetupError("");
      return true;
    } catch (error) {
      const key = error instanceof Error && error.message.startsWith("totp.error.")
        ? error.message
        : "totp.easy.errorInvalid";
      setTotpSetupError(t(key as Parameters<typeof translate>[1]));
      setTotpPreview(null);
      setTotpSetupMode(source === "manual" ? "manual" : source === "screen" ? "screenCrop" : "choice");
      return false;
    }
  }

  async function handleTotpManualVerify() {
    await prepareTotpPreview(totpManualValue, "manual", totpManualIssuer || credentialForm.totpIssuer || credentialForm.title);
  }

  async function handleTotpImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setTotpSetupError(t("totp.easy.errorImageOnly"));
      return;
    }

    try {
      await validateTotpQrImageFile(file);
    } catch (error) {
      const key = error instanceof Error && error.message === "totp.easy.errorImageTooLarge"
        ? "totp.easy.errorImageTooLarge"
        : "totp.easy.errorQrNotFound";
      setTotpSetupError(t(key));
      return;
    }

    setTotpQrBusy(true);
    setTotpSetupError("");

    try {
      let content = "";

      try {
        content = await decodeQrFromImageFile(file);
      } catch {
        const dataUrl = await readFileAsDataUrl(file);
        content = await invoke<string>("decode_qr_from_image_data_url", { dataUrl });
      }

      await prepareTotpPreview(content, "image", credentialForm.totpIssuer || credentialForm.title);
    } catch {
      setTotpSetupError(t("totp.easy.errorQrNotFound"));
      setTotpPreview(null);
      setTotpSetupMode("choice");
    } finally {
      setTotpQrBusy(false);
    }
  }

  async function bringTotpWindowToFront(delayMs = 0, useTopBump = false) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
    }

    try {
      const appWindow = getCurrentWindow();
      await appWindow.unminimize();
      await appWindow.show();

      if (useTopBump) {
        try {
          await appWindow.setAlwaysOnTop(true);
        } catch {
          // Se o sistema negar o topo temporário, ainda tentamos foco normal.
        }
      }

      await appWindow.setFocus();

      if (useTopBump) {
        window.setTimeout(() => {
          void getCurrentWindow().setAlwaysOnTop(false).catch(() => undefined);
        }, 450);
      }
    } catch {
      // Conveniência de UX. A captura continua válida mesmo se o Windows bloquear o foco imediato.
    }
  }

  async function restoreTotpWindowAfterScreenSelection() {
    // Não deixamos a janela como always-on-top antes do seletor do Windows, porque isso pode causar
    // o retorno para a tela compartilhada em alguns ambientes. O "top bump" acontece só depois
    // que o frame já foi capturado e o stream encerrado.
    await bringTotpWindowToFront(120, true);
    window.setTimeout(() => void bringTotpWindowToFront(0, true), 450);
    window.setTimeout(() => void bringTotpWindowToFront(0, false), 1000);
    window.setTimeout(() => void bringTotpWindowToFront(0, false), 1800);
  }

  function getTotpScreenPoint(event: MouseEvent<HTMLDivElement>) {
    const image = totpScreenImageRef.current;
    if (!image) return null;

    const rect = image.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);

    return { x, y };
  }

  function normalizeTotpScreenSelection(start: { x: number; y: number }, end: { x: number; y: number }): TotpScreenSelection {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    return { x, y, width, height };
  }

  function isTotpScreenSelectionReady(selection: TotpScreenSelection | null) {
    return Boolean(selection && selection.width >= 24 && selection.height >= 24);
  }

  function handleTotpScreenMouseDown(event: MouseEvent<HTMLDivElement>) {
    const point = getTotpScreenPoint(event);
    if (!point) return;

    setTotpScreenDragStart(point);
    setTotpScreenSelection({ ...point, width: 0, height: 0 });
    setTotpSetupError("");
  }

  function handleTotpScreenMouseMove(event: MouseEvent<HTMLDivElement>) {
    if (!totpScreenDragStart) return;

    const point = getTotpScreenPoint(event);
    if (!point) return;

    setTotpScreenSelection(normalizeTotpScreenSelection(totpScreenDragStart, point));
  }

  function handleTotpScreenMouseUp(event: MouseEvent<HTMLDivElement>) {
    if (!totpScreenDragStart) return;

    const point = getTotpScreenPoint(event);
    if (point) {
      setTotpScreenSelection(normalizeTotpScreenSelection(totpScreenDragStart, point));
    }
    setTotpScreenDragStart(null);
  }

  async function captureTotpScreenFrame() {
    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
    };

    if (!mediaDevices?.getDisplayMedia) {
      setTotpSetupError(t("totp.easy.errorScreenUnsupported"));
      setTotpSetupMode("choice");
      return;
    }

    setTotpQrBusy(true);
    setTotpSetupError("");
    setTotpScreenImage("");
    setTotpScreenSelection(null);
    setTotpScreenDragStart(null);

    let stream: MediaStream | null = null;
    let shouldRestoreWindow = false;

    try {
      // O seletor nativo do Windows/WebView pode focar a tela ou janela escolhida.
      // Não prendemos o KPassword no topo antes do seletor para evitar o comportamento
      // em que ele volta a minimizar ou fica atrás da origem compartilhada.
      stream = await mediaDevices.getDisplayMedia({ video: true, audio: false });
      shouldRestoreWindow = true;
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await video.play();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      const width = video.videoWidth || settings.width || 0;
      const height = video.videoHeight || settings.height || 0;

      if (!width || !height) {
        throw new Error("Screen frame unavailable.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Canvas unavailable.");
      }

      context.drawImage(video, 0, 0, width, height);
      setTotpScreenImage(canvas.toDataURL("image/png"));
      setTotpSetupMode("screenCrop");
    } catch {
      setTotpSetupError(t("totp.easy.errorScreenCapture"));
      setTotpSetupMode("choice");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setTotpQrBusy(false);

      if (shouldRestoreWindow) {
        await restoreTotpWindowAfterScreenSelection();
      }
    }
  }

  async function decodeTotpScreenSelection() {
    const image = totpScreenImageRef.current;

    const selection = totpScreenSelection;

    if (!image || !totpScreenImage || !selection || !isTotpScreenSelectionReady(selection)) {
      setTotpSetupError(t("totp.easy.errorScreenSelection"));
      return;
    }

    const displayWidth = image.clientWidth;
    const displayHeight = image.clientHeight;

    if (!displayWidth || !displayHeight || !image.naturalWidth || !image.naturalHeight) {
      setTotpSetupError(t("totp.easy.errorScreenSelection"));
      return;
    }

    const scaleX = image.naturalWidth / displayWidth;
    const scaleY = image.naturalHeight / displayHeight;
    const sourceX = Math.max(0, Math.round(selection.x * scaleX));
    const sourceY = Math.max(0, Math.round(selection.y * scaleY));
    const sourceWidth = Math.max(1, Math.round(selection.width * scaleX));
    const sourceHeight = Math.max(1, Math.round(selection.height * scaleY));

    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      setTotpSetupError(t("totp.easy.errorQrNotFound"));
      return;
    }

    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

    setTotpQrBusy(true);
    setTotpSetupError("");

    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

      if (!blob) {
        throw new Error("Crop unavailable.");
      }

      let content = "";
      const file = new File([blob], "kpassword-qr-selection.png", { type: "image/png" });

      try {
        content = await decodeQrFromImageFile(file);
      } catch {
        content = await invoke<string>("decode_qr_from_image_data_url", { dataUrl: canvas.toDataURL("image/png") });
      }

      const previewReady = await prepareTotpPreview(content, "screen", credentialForm.totpIssuer || credentialForm.title);

      if (previewReady) {
        setTotpScreenImage("");
        setTotpScreenSelection(null);
        setTotpScreenDragStart(null);
      }
    } catch {
      setTotpSetupError(t("totp.easy.errorQrNotFound"));
      setTotpPreview(null);
      setTotpSetupMode("screenCrop");
    } finally {
      setTotpQrBusy(false);
    }
  }

  async function applyTotpPreview() {
    if (!totpPreview) return;

    const nextTotpSecret = totpPreview.secret;
    const nextTotpIssuer = totpPreview.issuer || credentialForm.title;

    setCredentialForm((current) => ({
      ...current,
      totpSecret: nextTotpSecret,
      totpIssuer: nextTotpIssuer || current.title,
    }));

    if (!vault || !editingId) {
      closeTotpSetup();
      return;
    }

    setBusy(true);

    try {
      const now = new Date().toISOString();
      await persistVault({
        ...vault,
        credentials: vault.credentials.map((credential) =>
          credential.id === editingId
            ? {
                ...credential,
                totpSecret: nextTotpSecret,
                totpIssuer: nextTotpIssuer || credential.title,
                updatedAt: now,
              }
            : credential,
        ),
        updatedAt: now,
      });
      setMessage(t("totp.easy.saveSuccess"));
      closeTotpSetup();
    } catch (error) {
      console.error(error);
      setMessage(t("totp.easy.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function clearTotpFromForm() {
    const confirmed = await askConfirmation({
      title: t("totp.easy.removeTitle"),
      message: t("totp.easy.removeMessage"),
      confirmText: t("totp.easy.removeConfirm"),
      cancelText: t("dialog.cancel"),
      tone: "danger",
    });

    if (!confirmed) return;

    setCredentialForm((current) => ({ ...current, totpSecret: "", totpIssuer: "" }));

    if (!vault || !editingId) {
      return;
    }

    setBusy(true);

    try {
      const now = new Date().toISOString();
      await persistVault({
        ...vault,
        credentials: vault.credentials.map((credential) =>
          credential.id === editingId
            ? {
                ...credential,
                totpSecret: "",
                totpIssuer: "",
                updatedAt: now,
              }
            : credential,
        ),
        updatedAt: now,
      });
      setMessage(t("totp.easy.removeSuccess"));
    } catch (error) {
      console.error(error);
      setMessage(t("totp.easy.removeError"));
    } finally {
      setBusy(false);
    }
  }

  function openCredentialTotpSetup(credential: CredentialRecord) {
    openEditCredentialForm(credential);
    window.setTimeout(() => {
      setTotpSetupMode("choice");
      setTotpManualValue(credential.totpSecret ?? "");
      setTotpManualIssuer(credential.totpIssuer ?? credential.title ?? "");
      setTotpPreview(null);
      setTotpSetupError("");
      setTotpSetupOpen(true);
    }, 0);
  }

  function openAssistantCredential(credential: CredentialRecord) {
    setDetailCredentialId(credential.id);
    setScreen("credentials");
  }

  async function openAssistantSite(credential: CredentialRecord) {
    if (!credential.url.trim()) {
      openEditCredentialForm(credential);
      return;
    }

    try {
      await openExternalUrl(credential.url);
    } catch (error) {
      console.error(error);
      setMessage(t("assistant.openSiteError"));
    }
  }

  function skipAssistantAction(action: AssistantAction) {
    setAssistantSkippedIds((current) => current.includes(action.id) ? current : [...current, action.id]);
    if (assistantFocusId === action.id) {
      setAssistantFocusId("");
    }
  }

  function runAssistantPrimaryAction(action: AssistantAction) {
    if (action.kind === "addTotp") {
      openCredentialTotpSetup(action.credential);
      return;
    }

    openEditCredentialForm(action.credential);
  }

  async function applyAssistantTagSuggestions(suggestions: AssistantTagSuggestion[]) {
    if (!vault || suggestions.length === 0) return;

    const preview = suggestions
      .slice(0, 6)
      .map((suggestion) => `${suggestion.credential.title} → #${suggestion.tag}`)
      .join("\n");
    const extraCount = Math.max(suggestions.length - 6, 0);
    const confirmed = await askConfirmation({
      title: t("assistant.tags.confirmTitle", { count: suggestions.length }),
      message: `${t("assistant.tags.confirmMessage", { count: suggestions.length })}\n\n${preview}${extraCount > 0 ? `\n${t("assistant.tags.confirmMore", { count: extraCount })}` : ""}`,
      confirmText: t("assistant.tags.applyCount", { count: suggestions.length }),
      cancelText: t("dialog.cancel"),
    });

    if (!confirmed) return;

    setBusy(true);

    try {
      const now = new Date().toISOString();
      const suggestionMap = new Map(suggestions.map((suggestion) => [suggestion.credential.id, suggestion.tag]));

      await persistVault({
        ...vault,
        credentials: vault.credentials.map((credential) => {
          const tag = suggestionMap.get(credential.id);

          if (!tag) return credential;

          return {
            ...credential,
            tags: normalizeCredentialTags([...getCredentialTags(credential), tag]),
            updatedAt: now,
          };
        }),
        updatedAt: now,
      });

      setMessage(t("assistant.tags.applied", { count: suggestions.length }));
    } catch (error) {
      console.error(error);
      setMessage(t("assistant.tags.error"));
    } finally {
      setBusy(false);
    }
  }

  async function applyAssistantTagSuggestion(suggestion: AssistantTagSuggestion) {
    await applyAssistantTagSuggestions([suggestion]);
  }

  async function handleSaveCredential(event: FormEvent) {
    event.preventDefault();

    if (!vault) return;

    if (!credentialForm.title.trim()) {
      setMessage(t("errors.credentialNameRequired"));
      return;
    }

    const itemType = credentialForm.itemType ?? "credential";

    if (itemType === "credential" && !credentialForm.password.trim()) {
      setMessage(t("errors.credentialPasswordRequired"));
      return;
    }

    const confirmed = await askConfirmation({
      title: editingId ? t("dialog.saveEditTitle") : t("dialog.createCredentialTitle"),
      message: editingId
        ? t("dialog.saveEditMessage")
        : t("dialog.createCredentialMessage"),
      confirmText: editingId ? t("dialog.saveEditTitle") : t("dialog.createCredentialTitle"),
      cancelText: t("dialog.cancel"),
    });

    if (!confirmed) {
      return;
    }

    const now = new Date().toISOString();
    const previousCredential = editingId
      ? vault.credentials.find((credential) => credential.id === editingId)
      : null;
    const previousItemType = previousCredential ? getItemType(previousCredential) : itemType;
    const passwordChanged =
      itemType === "credential" &&
      (!previousCredential || previousCredential.password !== credentialForm.password);
    const previousHistory = previousCredential ? getPasswordHistory(previousCredential) : [];
    const passwordHistory =
      passwordChanged && previousCredential && previousItemType === "credential" && previousCredential.password
        ? [
            {
              id: createId(),
              password: previousCredential.password,
              changedAt: getCredentialPasswordChangedAt(previousCredential),
              savedAt: now,
            },
            ...previousHistory,
          ].slice(0, 20)
        : previousHistory;

    const parsedTotp = itemType === "credential"
      ? parseTotpInput(credentialForm.totpSecret ?? "", credentialForm.totpIssuer ?? "")
      : { secret: "", issuer: "" };

    const cleanForm = {
      ...credentialForm,
      itemType,
      title: credentialForm.title.trim(),
      username: itemType === "credential" ? credentialForm.username.trim() : "",
      password: itemType === "credential" ? credentialForm.password : "",
      url: itemType === "credential" ? normalizeUrl(credentialForm.url) : "",
      tags: normalizeCredentialTags(credentialTagsInput),
      notes: credentialForm.notes.trim(),
      favorite: credentialForm.favorite,
      passwordChangedAt:
        itemType === "credential"
          ? passwordChanged
            ? now
            : previousCredential?.passwordChangedAt ?? previousCredential?.updatedAt ?? now
          : "",
      passwordExpiresInDays: itemType === "credential" ? Number(credentialForm.passwordExpiresInDays ?? 0) : 0,
      passwordExpiryNoticeDays: itemType === "credential" ? Number(credentialForm.passwordExpiryNoticeDays ?? 15) : 15,
      passwordHistory: itemType === "credential" ? passwordHistory : [],
      attachments: previousCredential ? getAttachments(previousCredential) : getAttachments(credentialForm),
      totpSecret: itemType === "credential" ? parsedTotp.secret : "",
      totpIssuer: itemType === "credential" ? parsedTotp.issuer.trim() : "",
      cardholderName: itemType === "card" ? (credentialForm.cardholderName ?? "").trim() : "",
      cardNumber: itemType === "card" ? (credentialForm.cardNumber ?? "").trim() : "",
      cardExpiry: itemType === "card" ? (credentialForm.cardExpiry ?? "").trim() : "",
      cardCvv: itemType === "card" ? (credentialForm.cardCvv ?? "").trim() : "",
      cardIssuer: itemType === "card" ? (credentialForm.cardIssuer ?? "").trim() : "",
      identityFullName: itemType === "identity" ? (credentialForm.identityFullName ?? "").trim() : "",
      identityDocument: itemType === "identity" ? (credentialForm.identityDocument ?? "").trim() : "",
      identityEmail: itemType === "identity" ? (credentialForm.identityEmail ?? "").trim() : "",
      identityPhone: itemType === "identity" ? (credentialForm.identityPhone ?? "").trim() : "",
      identityAddress: itemType === "identity" ? (credentialForm.identityAddress ?? "").trim() : "",
      licenseProduct: itemType === "license" ? (credentialForm.licenseProduct ?? "").trim() : "",
      licenseKey: itemType === "license" ? (credentialForm.licenseKey ?? "").trim() : "",
      licenseOwner: itemType === "license" ? (credentialForm.licenseOwner ?? "").trim() : "",
      licenseExpiresAt: itemType === "license" ? (credentialForm.licenseExpiresAt ?? "").trim() : "",
    };

    const createdId = createId();

    const nextCredentials = editingId
      ? vault.credentials.map((credential) =>
          credential.id === editingId
            ? {
                ...credential,
                ...cleanForm,
                updatedAt: now,
              }
            : credential,
        )
      : [
          {
            id: createdId,
            ...cleanForm,
            createdAt: now,
            updatedAt: now,
          },
          ...vault.credentials,
        ];

    setBusy(true);

    try {
      await persistVault({
        ...vault,
        credentials: nextCredentials,
        updatedAt: now,
      });

      setFormOpen(false);
      setEditingId(null);
      setCredentialForm(getEmptyCredential());
      setCredentialTagsInput("");
      setDetailCredentialId(editingId ?? createdId);
      setScreen("credentials");
      setMessage(editingId ? t("success.credentialUpdated") : t("success.credentialCreated"));
    } catch (error) {
      console.error(error);
      setMessage(t("errors.saveCredential"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCredential(id: string) {
    if (!vault) return;

    const target = vault.credentials.find((credential) => credential.id === id);
    const confirmed = await askConfirmation({
      title: t("dialog.deleteCredentialTitle"),
      message: t("dialog.moveToTrashMessage", { title: target?.title ?? t("dialog.selectedCredential") }),
      confirmText: t("trash.moveToTrash"),
      cancelText: t("dialog.cancel"),
      tone: "danger",
    });

    if (!confirmed) return;

    setBusy(true);

    try {
      const now = new Date().toISOString();

      await persistVault({
        ...vault,
        credentials: vault.credentials.map((credential) =>
          credential.id === id
            ? {
                ...credential,
                deletedAt: now,
                favorite: false,
                updatedAt: now,
              }
            : credential,
        ),
        updatedAt: now,
      });

      if (detailCredentialId === id) {
        setDetailCredentialId(null);
      }

      setMessage(t("trash.moved"));
    } catch (error) {
      console.error(error);
      setMessage(t("errors.deleteCredential"));
    } finally {
      setBusy(false);
    }
  }


  async function handleRestoreCredential(id: string) {
    if (!vault) return;

    const now = new Date().toISOString();

    try {
      await persistVault({
        ...vault,
        credentials: vault.credentials.map((credential) =>
          credential.id === id
            ? {
                ...credential,
                deletedAt: undefined,
                updatedAt: now,
              }
            : credential,
        ),
        updatedAt: now,
      });

      setMessage(t("trash.restored"));
    } catch (error) {
      console.error(error);
      setMessage(t("trash.restoreError"));
    }
  }

  async function handlePermanentDeleteCredential(id: string) {
    if (!vault) return;

    const target = vault.credentials.find((credential) => credential.id === id);

    const confirmed = await askConfirmation({
      title: t("trash.deleteForeverTitle"),
      message: t("trash.deleteForeverMessage", { title: target?.title ?? t("dialog.selectedCredential") }),
      confirmText: t("trash.deleteForever"),
      cancelText: t("dialog.cancel"),
      tone: "danger",
    });

    if (!confirmed) return;

    try {
      await persistVault({
        ...vault,
        credentials: vault.credentials.filter((credential) => credential.id !== id),
        updatedAt: new Date().toISOString(),
      });

      setMessage(t("trash.deletedForever"));
    } catch (error) {
      console.error(error);
      setMessage(t("trash.deleteForeverError"));
    }
  }

  async function handleEmptyTrash() {
    if (!vault) return;

    const deletedCredentials = getDeletedCredentials(vault.credentials);

    if (deletedCredentials.length === 0) return;

    const confirmed = await askConfirmation({
      title: t("trash.emptyTitle"),
      message: t("trash.emptyMessage", { count: deletedCredentials.length }),
      confirmText: t("trash.empty"),
      cancelText: t("dialog.cancel"),
      tone: "danger",
    });

    if (!confirmed) return;

    try {
      await persistVault({
        ...vault,
        credentials: getActiveCredentials(vault.credentials),
        updatedAt: new Date().toISOString(),
      });

      setMessage(t("trash.emptySuccess"));
    } catch (error) {
      console.error(error);
      setMessage(t("trash.emptyError"));
    }
  }

  async function handleRestorePasswordFromHistory(credentialId: string, historyId: string) {
    if (!vault) return;

    const target = vault.credentials.find((credential) => credential.id === credentialId);
    const historyEntry = target?.passwordHistory?.find((entry) => entry.id === historyId);

    if (!target || !historyEntry) return;

    const confirmed = await askConfirmation({
      title: t("history.restoreTitle"),
      message: t("history.restoreMessage", { title: target.title }),
      confirmText: t("history.restore"),
      cancelText: t("dialog.cancel"),
    });

    if (!confirmed) return;

    const now = new Date().toISOString();

    try {
      await persistVault({
        ...vault,
        credentials: vault.credentials.map((credential) => {
          if (credential.id !== credentialId) return credential;

          const remainingHistory = getPasswordHistory(credential).filter((entry) => entry.id !== historyId);
          const currentPasswordEntry = credential.password
            ? {
                id: createId(),
                password: credential.password,
                changedAt: getCredentialPasswordChangedAt(credential),
                savedAt: now,
              }
            : null;

          return {
            ...credential,
            password: historyEntry.password,
            passwordChangedAt: now,
            passwordHistory: [
              ...(currentPasswordEntry ? [currentPasswordEntry] : []),
              ...remainingHistory,
            ].slice(0, 20),
            updatedAt: now,
          };
        }),
        updatedAt: now,
      });

      setMessage(t("history.restored"));
    } catch (error) {
      console.error(error);
      setMessage(t("history.restoreError"));
    }
  }

  async function handleClearPasswordHistory(credentialId: string) {
    if (!vault) return;

    const target = vault.credentials.find((credential) => credential.id === credentialId);

    if (!target || getPasswordHistory(target).length === 0) return;

    const confirmed = await askConfirmation({
      title: t("history.clearTitle"),
      message: t("history.clearMessage", { title: target.title }),
      confirmText: t("history.clear"),
      cancelText: t("dialog.cancel"),
      tone: "danger",
    });

    if (!confirmed) return;

    const now = new Date().toISOString();

    try {
      await persistVault({
        ...vault,
        credentials: vault.credentials.map((credential) =>
          credential.id === credentialId
            ? {
                ...credential,
                passwordHistory: [],
                updatedAt: now,
              }
            : credential,
        ),
        updatedAt: now,
      });

      setMessage(t("history.cleared"));
    } catch (error) {
      console.error(error);
      setMessage(t("history.clearError"));
    }
  }

  async function toggleFavorite(id: string) {
    if (!vault) return;

    const nextCredentials = vault.credentials
      .map((credential) =>
        credential.id === id
          ? {
              ...credential,
              favorite: !credential.favorite,
              updatedAt: new Date().toISOString(),
            }
          : credential,
      )
      .sort((first, second) => Number(second.favorite) - Number(first.favorite));

    await persistVault({
      ...vault,
      credentials: nextCredentials,
      updatedAt: new Date().toISOString(),
    });
  }

  async function moveCredentialByOffset(id: string, offset: -1 | 1) {
    if (!vault || search.trim()) return;

    const orderedCredentials = getOrderedCredentials(getActiveCredentials(vault.credentials));
    const sourceIndex = orderedCredentials.findIndex((credential) => credential.id === id);

    if (sourceIndex < 0) return;

    const targetIndex = sourceIndex + offset;

    if (targetIndex < 0 || targetIndex >= orderedCredentials.length) return;

    const source = orderedCredentials[sourceIndex];
    const target = orderedCredentials[targetIndex];

    if (source.favorite !== target.favorite) return;

    const reordered = [...orderedCredentials];
    const [removed] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, removed);

    await persistVault({
      ...vault,
      credentials: [...reordered, ...getDeletedCredentials(vault.credentials)],
      updatedAt: new Date().toISOString(),
    });
  }

  async function copySecure(value: string, label: string) {
    if (!value) return;

    if (clipboardCleanupRef.current) {
      window.clearTimeout(clipboardCleanupRef.current);
      clipboardCleanupRef.current = null;
    }

    await navigator.clipboard.writeText(value);
    setCopiedField(label);

    const copiedValue = value;

    clipboardCleanupRef.current = window.setTimeout(async () => {
      try {
        const current = await navigator.clipboard.readText();

        if (current === copiedValue) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        // Sem permissão de leitura: não limpa para evitar apagar conteúdo novo do usuário.
      } finally {
        clipboardCleanupRef.current = null;
        setCopiedField("");
      }
    }, (vault?.settings.clipboardClearSeconds ?? CLIPBOARD_CLEAR_SECONDS) * 1000);
  }


  async function handleAddAttachment(credentialId: string, file?: File) {
    if (!vault || !file) return;

    if (file.size > 10 * 1024 * 1024) {
      setMessage(t("attachments.tooLarge"));
      return;
    }

    setBusy(true);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const now = new Date().toISOString();
      const attachment: VaultAttachment = {
        id: createId(),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        dataUrl,
        createdAt: now,
      };

      await persistVault({
        ...vault,
        credentials: vault.credentials.map((credential) =>
          credential.id === credentialId
            ? {
                ...credential,
                attachments: [attachment, ...getAttachments(credential)],
                updatedAt: now,
              }
            : credential,
        ),
        updatedAt: now,
      });

      setMessage(t("attachments.added"));
    } catch (error) {
      console.error(error);
      setMessage(t("attachments.addError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveAttachment(credentialId: string, attachmentId: string) {
    if (!vault) return;

    const target = vault.credentials.find((credential) => credential.id === credentialId);
    const attachment = getAttachments(target).find((item) => item.id === attachmentId);

    const confirmed = await askConfirmation({
      title: t("attachments.removeTitle"),
      message: t("attachments.removeMessage", { name: attachment?.name ?? t("attachments.selected") }),
      confirmText: t("attachments.remove"),
      cancelText: t("dialog.cancel"),
      tone: "danger",
    });

    if (!confirmed) return;

    const now = new Date().toISOString();

    try {
      await persistVault({
        ...vault,
        credentials: vault.credentials.map((credential) =>
          credential.id === credentialId
            ? {
                ...credential,
                attachments: getAttachments(credential).filter((item) => item.id !== attachmentId),
                updatedAt: now,
              }
            : credential,
        ),
        updatedAt: now,
      });

      setMessage(t("attachments.removed"));
    } catch (error) {
      console.error(error);
      setMessage(t("attachments.removeError"));
    }
  }

  async function handleExportEncryptedJson() {
    if (!vault || !masterPassword) return;

    const confirmed = await askConfirmation({
      title: t("export.encryptedTitle"),
      message: t("export.encryptedMessage"),
      confirmText: t("export.downloadEncrypted"),
      cancelText: t("dialog.cancel"),
    });

    if (!confirmed) return;

    setBusy(true);

    try {
      const file = await encryptVault(vault, masterPassword, encryptedVault);
      const date = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        `kpassword-export-criptografado-${date}.json`,
        JSON.stringify(file, null, 2),
      );
      setEncryptedVault(file);
      setMessage(t("export.encryptedSuccess"));
    } catch (error) {
      console.error(error);
      setMessage(t("export.encryptedError"));
    } finally {
      setBusy(false);
    }
  }

  function closeCsvExportDialog() {
    setCsvExportDialogOpen(false);
    setCsvExportAcknowledged(false);
    setExportPassword("");
  }

  function openCsvExportDialog() {
    setMessage("");
    setCsvExportDialogOpen(true);
    setCsvExportAcknowledged(false);
    setExportPassword("");
  }

  async function handleExportPlainCsv() {
    if (!vault) return;

    if (!csvExportAcknowledged) {
      setMessage(t("export.csvAcknowledgeError"));
      return;
    }

    if (exportPassword !== masterPassword) {
      setMessage(t("export.passwordError"));
      return;
    }

    try {
      const date = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        `KPassword-export-CSV-NAO-CRIPTOGRAFADO-${date}.csv`,
        buildCsv(getActiveCredentials(vault.credentials)),
        "text/csv;charset=utf-8",
      );
      closeCsvExportDialog();
      setMessage(t("export.csvSuccess"));
    } catch (error) {
      console.error(error);
      setMessage(t("export.csvError"));
    }
  }

  async function handleImportCsvFile(file?: File) {
    if (!file) return;

    setBusy(true);

    try {
      const text = await readFileAsText(file);
      const parsed = parseCsvDocument(text);

      if (parsed.rows.length === 0 || parsed.headers.length === 0) {
        setCsvImportPreview(null);
        setMessage(t("import.noItems"));
        return;
      }

      setCsvImportIncludeDuplicates(false);
      setCsvImportPreview({
        ...parsed,
        filename: file.name,
        mapping: detectCsvImportMapping(parsed.headers),
      });
      setMessage(t("import.previewReady", { count: parsed.rows.length }));
    } catch (error) {
      console.error(error);
      setCsvImportPreview(null);
      setMessage(t("import.csvError"));
    } finally {
      setBusy(false);
    }
  }

  function updateCsvImportMapping(field: CsvImportFieldKey, header: string) {
    setCsvImportPreview((current) =>
      current
        ? {
            ...current,
            mapping: {
              ...current.mapping,
              [field]: header,
            },
          }
        : current,
    );
  }

  async function confirmCsvImportPreview() {
    if (!vault || !csvImportPreview) return;

    if (csvImportAnalysis.importableItems.length === 0) {
      setMessage(t("import.noImportableItems"));
      return;
    }

    const confirmed = await askConfirmation({
      title: t("import.csvTitle"),
      message: t("import.confirmPreview", { count: csvImportAnalysis.importableItems.length }),
      confirmText: t("import.import"),
      cancelText: t("dialog.cancel"),
    });

    if (!confirmed) return;

    setBusy(true);

    try {
      const now = new Date().toISOString();
      const importedCredentials = csvImportAnalysis.importableItems.map((item) => ({
        ...item.credential,
        id: createId(),
        createdAt: now,
        updatedAt: now,
      }));

      await persistVault({
        ...vault,
        credentials: [...importedCredentials, ...vault.credentials],
        updatedAt: now,
      });

      setCsvImportPreview(null);
      setCsvImportIncludeDuplicates(false);
      setScreen("credentials");
      setMessage(t("import.csvSuccess", { count: importedCredentials.length }));
    } catch (error) {
      console.error(error);
      setMessage(t("import.csvError"));
    } finally {
      setBusy(false);
    }
  }

  function cancelCsvImportPreview() {
    setCsvImportPreview(null);
    setCsvImportIncludeDuplicates(false);
    setMessage(t("import.previewCancelled"));
  }

  async function handleOpenVaultFolder() {
    try {
      await openVaultFolder(activeVaultName);
    } catch (error) {
      console.error(error);
      setMessage(t("folders.openVaultError"));
    }
  }

  async function handleOpenBackupFolder() {
    try {
      await openBackupFolder(activeVaultName);
    } catch (error) {
      console.error(error);
      setMessage(t("folders.openBackupError"));
    }
  }


  const diagnosticPasswordCounts = useMemo(() => {
    const counts = new Map<string, number>();

    getActiveCredentials(vault?.credentials ?? [])
      .filter(isCredentialItem)
      .forEach((credential) => {
        const password = credential.password.trim();
        if (!password) return;
        counts.set(password, (counts.get(password) ?? 0) + 1);
      });

    return counts;
  }, [vault]);

  const getDiagnosticIssuesFor = useCallback(
    (credential: CredentialRecord) => getCredentialDiagnosticIssues(credential, diagnosticPasswordCounts),
    [diagnosticPasswordCounts],
  );

  const getDiagnosticLabel = useCallback(
    (issue: DiagnosticFilter) => t(`diagnostic.issue.${issue}`),
    [t],
  );

  const openDiagnosticFilter = useCallback((filter: DiagnosticFilter) => {
    setActiveDiagnosticFilter(filter);
    setActiveQuickFilter("all");
    setSearch("");
    setScreen("credentials");
  }, []);

  const openQuickVaultFilter = useCallback((filter: QuickVaultFilter) => {
    setActiveQuickFilter(filter);
    setActiveDiagnosticFilter("all");
    setQuickFilterMenuOpen(false);

    if (filter === "all") {
      setActiveTagFilter("");
      setSearch("");
    }

    setScreen("credentials");
  }, []);

  const filteredCredentials = useMemo(() => {
    if (!vault) return [];

    const terms = search
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    return getOrderedCredentials(getActiveCredentials(vault.credentials)).filter((credential) => {
      if (activeDiagnosticFilter !== "all" && !getDiagnosticIssuesFor(credential).includes(activeDiagnosticFilter)) {
        return false;
      }

      if (activeQuickFilter === "favorites" && !credential.favorite) {
        return false;
      }

      if (activeQuickFilter === "withTags" && getCredentialTags(credential).length === 0) {
        return false;
      }

      if (isDiagnosticQuickFilter(activeQuickFilter) && !getDiagnosticIssuesFor(credential).includes(activeQuickFilter)) {
        return false;
      }

      if (activeTagFilter && !getCredentialTags(credential).some((tag) => tag.toLowerCase() === activeTagFilter.toLowerCase())) {
        return false;
      }

      if (terms.length === 0) return true;

      const searchable = [
        credential.title,
        credential.username,
        credential.url,
        credential.category,
        credential.notes,
        getCredentialTags(credential).join(" "),
        credential.password,
        credential.totpIssuer,
        getItemTypeLabel(getItemType(credential), appLanguage),
        credential.cardholderName,
        credential.cardNumber,
        credential.cardExpiry,
        credential.cardIssuer,
        credential.identityFullName,
        credential.identityDocument,
        credential.identityEmail,
        credential.identityPhone,
        credential.identityAddress,
        credential.licenseProduct,
        credential.licenseKey,
        credential.licenseOwner,
        credential.licenseExpiresAt,
        getAttachments(credential).map((attachment) => attachment.name).join(" "),
        credential.favorite ? "favorito favorita estrela" : "",
      ]
        .join(" ")
        .toLowerCase();

      return terms.every((term) => searchable.includes(term));
    });
  }, [activeDiagnosticFilter, activeQuickFilter, activeTagFilter, appLanguage, getDiagnosticIssuesFor, search, vault]);

  const detailCredential = useMemo(() => {
    if (!vault || !detailCredentialId) return null;
    return vault.credentials.find((credential) => credential.id === detailCredentialId) ?? null;
  }, [detailCredentialId, vault]);

  const stats = useMemo(() => {
    const credentials = getActiveCredentials(vault?.credentials ?? []);
    const credentialItems = credentials.filter(isCredentialItem);
    const deleted = getDeletedCredentials(vault?.credentials ?? []);
    const repeatedPasswords = new Map<string, number>();

    credentialItems.forEach((credential) => {
      const password = credential.password.trim();
      if (!password) return;
      repeatedPasswords.set(
        password,
        (repeatedPasswords.get(password) ?? 0) + 1,
      );
    });

    const weak = credentialItems.filter(
      (credential) => getPasswordScore(credential.password) < 60,
    ).length;
    const repeated = credentialItems.filter(
      (credential) => credential.password.trim() && (repeatedPasswords.get(credential.password.trim()) ?? 0) > 1,
    ).length;
    const expired = credentialItems.filter(
      (credential) => getPasswordExpiryInfo(credential).status === "expired",
    ).length;
    const expiringSoon = credentialItems.filter(
      (credential) => getPasswordExpiryInfo(credential).status === "soon",
    ).length;
    const missingUrl = credentialItems.filter((credential) => !credential.url).length;
    const missingUser = credentialItems.filter((credential) => !credential.username).length;
    const oldPasswords = credentialItems.filter(
      (credential) => daysBetween(getCredentialPasswordChangedAt(credential)) >= 180,
    ).length;

    return {
      total: credentials.length,
      credentialItems: credentialItems.length,
      secureNotes: credentials.filter((credential) => getItemType(credential) === "secure_note").length,
      cards: credentials.filter((credential) => getItemType(credential) === "card").length,
      identities: credentials.filter((credential) => getItemType(credential) === "identity").length,
      licenses: credentials.filter((credential) => getItemType(credential) === "license").length,
      deleted: deleted.length,
      favorites: credentials.filter((credential) => credential.favorite).length,
      weak,
      repeated,
      expired,
      expiringSoon,
      missingUrl,
      missingUser,
      oldPasswords,
    };
  }, [vault]);

  const activeCredentials = getActiveCredentials(vault?.credentials ?? []);
  const allVaultTags = Array.from(
    new Set(activeCredentials.flatMap((credential) => getCredentialTags(credential))),
  ).sort((first, second) => first.localeCompare(second, getDateLocale(appLanguage)));
  const deletedCredentials = getDeletedCredentials(vault?.credentials ?? []);
  const credentialItems = activeCredentials.filter(isCredentialItem);
  const expiredCredentials = credentialItems.filter(
    (credential) => getPasswordExpiryInfo(credential).status === "expired",
  );
  const expiringSoonCredentials = credentialItems.filter(
    (credential) => getPasswordExpiryInfo(credential).status === "soon",
  );
  const weakCredentials = credentialItems.filter(
    (credential) => getPasswordScore(credential.password) < 60,
  );
  const repeatedCredentials = credentialItems.filter(
    (credential) => credential.password.trim() && (diagnosticPasswordCounts.get(credential.password.trim()) ?? 0) > 1,
  );
  const oldPasswordCredentials = credentialItems.filter(
    (credential) => daysBetween(getCredentialPasswordChangedAt(credential)) >= OLD_PASSWORD_DAYS,
  );
  const missingTotpCredentials = credentialItems.filter(
    (credential) => !credential.totpSecret?.trim(),
  );
  const incompleteCredentials = credentialItems.filter(
    (credential) => !credential.url.trim() || !credential.username.trim() || !credential.category,
  );

  const diagnosticIssueCounts: Record<DiagnosticIssue, number> = {
    weak: weakCredentials.length,
    reused: repeatedCredentials.length,
    old: oldPasswordCredentials.length,
    expired: expiredCredentials.length,
    expiring: expiringSoonCredentials.length,
    missingTotp: missingTotpCredentials.length,
    incomplete: incompleteCredentials.length,
  };

  const vaultHealthScore = getVaultHealthScore(diagnosticIssueCounts);
  const vaultHealthTone = getVaultHealthTone(vaultHealthScore);

  const diagnosticCards: Array<{
    filter: DiagnosticIssue;
    count: number;
    tone: "danger" | "warning" | "neutral";
    description: string;
    guidance: DiagnosticGuidance;
  }> = [
    { filter: "expired", count: diagnosticIssueCounts.expired, tone: "danger", description: t("diagnostic.description.expired"), guidance: getVaultIssueGuidance("expired", t) },
    { filter: "reused", count: diagnosticIssueCounts.reused, tone: "danger", description: t("diagnostic.description.reused"), guidance: getVaultIssueGuidance("reused", t) },
    { filter: "weak", count: diagnosticIssueCounts.weak, tone: "warning", description: t("diagnostic.description.weak"), guidance: getVaultIssueGuidance("weak", t) },
    { filter: "expiring", count: diagnosticIssueCounts.expiring, tone: "warning", description: t("diagnostic.description.expiring"), guidance: getVaultIssueGuidance("expiring", t) },
    { filter: "old", count: diagnosticIssueCounts.old, tone: "neutral", description: t("diagnostic.description.old", { days: OLD_PASSWORD_DAYS }), guidance: getVaultIssueGuidance("old", t) },
    { filter: "missingTotp", count: diagnosticIssueCounts.missingTotp, tone: "neutral", description: t("diagnostic.description.missingTotp"), guidance: getVaultIssueGuidance("missingTotp", t) },
    { filter: "incomplete", count: diagnosticIssueCounts.incomplete, tone: "neutral", description: t("diagnostic.description.incomplete"), guidance: getVaultIssueGuidance("incomplete", t) },
  ];

  const quickFilterOptions: Array<{ filter: QuickVaultFilter; label: string; count: number }> = [
    { filter: "all", label: t("quickFilters.all"), count: activeCredentials.length },
    { filter: "favorites", label: t("quickFilters.favorites"), count: stats.favorites },
    { filter: "weak", label: t("quickFilters.weak"), count: diagnosticIssueCounts.weak },
    { filter: "reused", label: t("quickFilters.reused"), count: diagnosticIssueCounts.reused },
    { filter: "expired", label: t("quickFilters.expired"), count: diagnosticIssueCounts.expired },
    { filter: "expiring", label: t("quickFilters.expiring"), count: diagnosticIssueCounts.expiring },
    { filter: "old", label: t("quickFilters.old"), count: diagnosticIssueCounts.old },
    { filter: "missingTotp", label: t("quickFilters.missingTotp"), count: diagnosticIssueCounts.missingTotp },
    { filter: "incomplete", label: t("quickFilters.incomplete"), count: diagnosticIssueCounts.incomplete },
    { filter: "withTags", label: t("quickFilters.withTags"), count: activeCredentials.filter((credential) => getCredentialTags(credential).length > 0).length },
  ];

  const activeQuickFilterOption = quickFilterOptions.find((item) => item.filter === activeQuickFilter);
  const activeQuickFilterLabel = activeQuickFilterOption?.label ?? t("quickFilters.all");
  const quickFilterButtonLabel = activeQuickFilter === "all" ? t("quickFilters.button") : activeQuickFilterLabel;
  const quickFilterButtonCount = activeQuickFilter === "all" ? filteredCredentials.length : activeQuickFilterOption?.count ?? filteredCredentials.length;

  const assistantActions = useMemo<AssistantAction[]>(() => {
    return credentialItems
      .flatMap((credential) => {
        const issues = getDiagnosticIssuesFor(credential);
        const importance = getCredentialImportanceScore(credential);

        return issues.map((issue) => ({
          id: `${credential.id}:${issue}`,
          credential,
          issue,
          priority: ASSISTANT_ISSUE_PRIORITY[issue] + importance + issues.length * 3,
          tone: getAssistantIssueTone(issue),
          kind: getAssistantActionKind(issue),
        }));
      })
      .sort((first, second) => second.priority - first.priority);
  }, [credentialItems, getDiagnosticIssuesFor]);

  const assistantTagSuggestions = useMemo<AssistantTagSuggestion[]>(() => {
    return credentialItems
      .filter((credential) => getCredentialTags(credential).length === 0)
      .map((credential) => ({
        id: `${credential.id}:tag`,
        credential,
        tag: inferCredentialTag(credential),
        priority: getCredentialImportanceScore(credential),
      }))
      .sort((first, second) => second.priority - first.priority || first.credential.title.localeCompare(second.credential.title, getDateLocale(appLanguage)))
      .slice(0, 12);
  }, [appLanguage, credentialItems]);

  const assistantVisibleActions = assistantActions.filter((action) => !assistantSkippedIds.includes(action.id));
  const assistantMainAction = assistantVisibleActions.find((action) => action.id === assistantFocusId) ?? assistantVisibleActions[0] ?? null;
  const assistantQueue = assistantVisibleActions.filter((action) => action.id !== assistantMainAction?.id).slice(0, 4);
  const assistantImprovementCount = assistantActions.length + assistantTagSuggestions.length;
  const assistantExternalActionCount = assistantActions.filter((action) => action.kind !== "completeCredential").length;
  const assistantSafeActionCount = assistantTagSuggestions.length;
  const assistantSkippedCount = assistantSkippedIds.length;

  const canReorderCredentials = search.trim().length === 0 && activeDiagnosticFilter === "all" && activeQuickFilter === "all" && !activeTagFilter;
  const masterIssues = validateMasterPassword(setupPassword);
  const score = getPasswordScore(credentialForm.password);

  const vaultOptions = useMemo(() => {
    const options = [...vaultFiles];

    if (!options.some((item) => item.name === activeVaultName)) {
      options.unshift({
        name: activeVaultName,
        display_name: getVaultDisplayName(activeVaultName, []),
        filename: `${activeVaultName}.kpvault`,
        size_bytes: 0,
        modified_epoch_ms: 0,
        is_default: activeVaultName === DEFAULT_VAULT_NAME,
      });
    }

    if (options.length === 0) {
      options.push({
        name: DEFAULT_VAULT_NAME,
        display_name: "Principal",
        filename: "vault.kpvault",
        size_bytes: 0,
        modified_epoch_ms: 0,
        is_default: true,
      });
    }

    return options;
  }, [activeVaultName, vaultFiles]);

  const vaultSelectorElement = (
    <div className="vaultSwitcher">
      <label>
        <span>{t("vault.current")}</span>
        <select
          value={activeVaultName}
          onChange={(event) => void handleSwitchVault(event.target.value)}
        >
          {vaultOptions.map((item) => (
            <option key={item.name} value={item.name}>
              {item.display_name}
            </option>
          ))}
        </select>
      </label>

      <div className="newVaultRow">
        <input
          value={newVaultName}
          onChange={(event) => setNewVaultName(event.target.value)}
          placeholder={t("vault.newNamePlaceholder")}
        />
        <button type="button" className="secondaryButton" onClick={() => void handleCreateNewVault()}>
          {t("vault.create")}
        </button>
      </div>

      <small>{t("vault.currentFile", { name: getVaultDisplayName(activeVaultName, vaultFiles) })}</small>
    </div>
  );

  const authLoginToolsElement = (
    <div className="authLoginTools" aria-label={t("auth.quickSettings")}>
      <div className="authThemeSlot">
        <div className="authThemeButtons" role="group" aria-label={t("preferences.theme")}>
          <button
            type="button"
            title={t("preferences.dark")}
            aria-label={t("preferences.dark")}
            className={appTheme === "dark" ? "authThemeButton active" : "authThemeButton"}
            onClick={() => setAppTheme("dark")}
          >
            <span className="authThemeIcon" aria-hidden="true">☾</span>
            <span>{t("preferences.dark")}</span>
          </button>
          <button
            type="button"
            title={t("preferences.light")}
            aria-label={t("preferences.light")}
            className={appTheme === "light" ? "authThemeButton active" : "authThemeButton"}
            onClick={() => setAppTheme("light")}
          >
            <span className="authThemeIcon" aria-hidden="true">☀</span>
            <span>{t("preferences.light")}</span>
          </button>
          <button
            type="button"
            title={t("preferences.mixed")}
            aria-label={t("preferences.mixed")}
            className={appTheme === "mixed" ? "authThemeButton active" : "authThemeButton"}
            onClick={() => setAppTheme("mixed")}
          >
            <span className="authThemeIcon" aria-hidden="true">◐</span>
            <span>{t("preferences.mixed")}</span>
          </button>
        </div>
      </div>

      <div className="authVaultActions" aria-label={t("auth.quickVault")}>
        <button
          type="button"
          className="authToolButton"
          onClick={() => {
            const typedName = window.prompt(t("vault.newNamePlaceholder"), newVaultName);

            if (typedName === null) return;

            void handleCreateNewVault(typedName);
          }}
        >
          {t("vault.create")}
        </button>

        <select
          className="authVaultSelect"
          value={activeVaultName}
          title={t("vault.current")}
          aria-label={t("vault.current")}
          onChange={(event) => void handleSwitchVault(event.target.value)}
        >
          {vaultOptions.map((item) => (
            <option key={item.name} value={item.name}>
              {item.display_name}
            </option>
          ))}
        </select>

        <button type="button" className="authToolButton" onClick={() => setRestorePopupOpen(true)}>
          {t("auth.restoreBackup")}
        </button>
      </div>

      <div className="authLanguageSlot">
        <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} compact />
      </div>
    </div>
  );

  const confirmDialogElement = confirmDialog ? (
    <div className="confirmOverlay" onMouseDown={() => closeConfirmDialog(false)}>
      <section className="confirmCard" onMouseDown={(event) => event.stopPropagation()}>
        <div className={confirmDialog.tone === "danger" ? "confirmIcon danger" : "confirmIcon"}>
          {confirmDialog.tone === "danger" ? "!" : "✓"}
        </div>
        <div>
          <h2>{confirmDialog.title}</h2>
          <p>{confirmDialog.message}</p>
        </div>
        <div className="confirmActions">
          <button className="ghostButton" onClick={() => closeConfirmDialog(false)}>
            {confirmDialog.cancelText ?? t("dialog.cancel")}
          </button>
          <button
            className={confirmDialog.tone === "danger" ? "dangerConfirmButton" : "primaryButton"}
            onClick={() => closeConfirmDialog(true)}
          >
            {confirmDialog.confirmText ?? t("dialog.confirm")}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  const totpSetupDialog = totpSetupOpen ? (
    <div className="modalOverlay totpEasyOverlay" onMouseDown={closeTotpSetup}>
      <section className={`credentialModal totpEasyModal totpEasyModal--${totpSetupMode}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <p className="eyebrow">{t("totp.easy.eyebrow")}</p>
            <h2>{t("totp.easy.title")}</h2>
          </div>
          <button type="button" className="iconButton" onClick={closeTotpSetup}>×</button>
        </div>

        <div className="totpEasyNotice">
          <strong>{t("totp.easy.noticeTitle")}</strong>
          <p>{t("totp.easy.noticeText")}</p>
        </div>

        <input
          ref={totpImageInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => void handleTotpImageSelected(event)}
        />

        {totpSetupMode === "choice" && (
          <div className="totpEasyChoiceGrid">
            <button
              type="button"
              className="totpEasyChoice primary"
              disabled={totpQrBusy}
              onClick={() => setTotpSetupMode("screenIntro")}
            >
              <span>{t("totp.easy.selectScreen")}</span>
              <small>{t("totp.easy.selectScreenHint")}</small>
            </button>

            <button
              type="button"
              className="totpEasyChoice"
              disabled={totpQrBusy}
              onClick={() => totpImageInputRef.current?.click()}
            >
              <span>{totpQrBusy ? t("totp.easy.reading") : t("totp.easy.importImage")}</span>
              <small>{t("totp.easy.importImageHint")}</small>
            </button>

            <button type="button" className="totpEasyChoice" onClick={() => setTotpSetupMode("manual")}>
              <span>{t("totp.easy.manual")}</span>
              <small>{t("totp.easy.manualHint")}</small>
            </button>
          </div>
        )}

        {totpSetupMode === "screenIntro" && (
          <div className="totpScreenIntroPanel">
            <strong>{t("totp.easy.screenIntroTitle")}</strong>
            <p>{t("totp.easy.screenIntroText")}</p>
            <ul>
              <li>{t("totp.easy.screenIntroStep1")}</li>
              <li>{t("totp.easy.screenIntroStep2")}</li>
              <li>{t("totp.easy.screenIntroStep3")}</li>
            </ul>
          </div>
        )}

        {totpSetupMode === "screenCrop" && totpScreenImage && (
          <div className="totpScreenCropPanel">
            <div className="totpScreenCropHint">
              <strong>{t("totp.easy.screenCropTitle")}</strong>
              <p>{t("totp.easy.screenCropText")}</p>
            </div>
            <div
              className="totpScreenCropCanvas"
              onMouseDown={handleTotpScreenMouseDown}
              onMouseMove={handleTotpScreenMouseMove}
              onMouseUp={handleTotpScreenMouseUp}
              onMouseLeave={handleTotpScreenMouseUp}
            >
              <img ref={totpScreenImageRef} src={totpScreenImage} alt={t("totp.easy.screenImageAlt")} draggable={false} />
              {totpScreenSelection && (
                <span
                  className="totpScreenSelection"
                  style={{
                    left: `${totpScreenSelection.x}px`,
                    top: `${totpScreenSelection.y}px`,
                    width: `${totpScreenSelection.width}px`,
                    height: `${totpScreenSelection.height}px`,
                  }}
                />
              )}
            </div>
          </div>
        )}

        {totpSetupMode === "manual" && (
          <div className="totpManualPanel">
            <label>
              {t("totp.easy.manualIssuer")}
              <input
                value={totpManualIssuer}
                onChange={(event) => setTotpManualIssuer(event.target.value)}
                placeholder={t("totp.issuerPlaceholder")}
              />
            </label>

            <label>
              {t("totp.easy.manualValue")}
              <textarea
                value={totpManualValue}
                onChange={(event) => setTotpManualValue(event.target.value)}
                placeholder={t("totp.secretPlaceholder")}
                rows={4}
              />
              <small>{t("totp.easy.manualHelp")}</small>
            </label>
          </div>
        )}

        {totpSetupMode === "preview" && totpPreview && (
          <div className="totpPreviewPanel">
            <div className="totpPreviewCode">
              <span>{t("totp.easy.currentCode")}</span>
              <strong>{totpPreview.currentCode}</strong>
              <small>{t("totp.remaining", { seconds: getTotpRemainingSeconds(totpTick) })}</small>
            </div>

            <div className="totpPreviewGrid">
              <div><span>{t("totp.easy.service")}</span><strong>{totpPreview.issuer || t("totp.easy.genericIssuer")}</strong></div>
              <div><span>{t("totp.easy.account")}</span><strong>{totpPreview.account || credentialForm.username || "—"}</strong></div>
              <div><span>{t("totp.easy.type")}</span><strong>TOTP · {totpPreview.digits} · {totpPreview.period}s</strong></div>
              <div><span>{t("totp.easy.source")}</span><strong>{t(totpPreview.source === "screen" ? "totp.easy.sourceScreen" : totpPreview.source === "image" ? "totp.easy.sourceImage" : "totp.easy.sourceManual")}</strong></div>
            </div>
          </div>
        )}

        {totpSetupError && <p className="totpEasyError">{totpSetupError}</p>}

        <div className="modalActions">
          {totpSetupMode === "screenIntro" && (
            <button type="button" className="primaryButton" disabled={totpQrBusy} onClick={() => void captureTotpScreenFrame()}>
              {totpQrBusy ? t("totp.easy.reading") : t("totp.easy.startScreenSelection")}
            </button>
          )}
          {totpSetupMode === "screenCrop" && (
            <button type="button" className="primaryButton" disabled={totpQrBusy || !isTotpScreenSelectionReady(totpScreenSelection)} onClick={() => void decodeTotpScreenSelection()}>
              {totpQrBusy ? t("totp.easy.reading") : t("totp.easy.readSelection")}
            </button>
          )}
          {totpSetupMode === "screenCrop" && (
            <button type="button" className="secondaryButton" disabled={totpQrBusy} onClick={() => void captureTotpScreenFrame()}>
              {t("totp.easy.captureAgain")}
            </button>
          )}
          {totpSetupMode === "manual" && (
            <button type="button" className="primaryButton" onClick={() => void handleTotpManualVerify()}>
              {t("totp.easy.verify")}
            </button>
          )}
          {totpSetupMode === "preview" && (
            <button type="button" className="primaryButton" disabled={busy} onClick={() => void applyTotpPreview()}>
              {credentialForm.totpSecret ? t("totp.easy.replaceConfirm") : t("totp.easy.saveConfirm")}
            </button>
          )}
          {totpSetupMode !== "choice" && (
            <button type="button" className="secondaryButton" onClick={() => { setTotpSetupMode("choice"); setTotpSetupError(""); setTotpPreview(null); setTotpScreenImage(""); setTotpScreenSelection(null); setTotpScreenDragStart(null); }}>
              {t("totp.easy.back")}
            </button>
          )}
          <button type="button" className="secondaryButton" onClick={closeTotpSetup}>{t("dialog.cancel")}</button>
        </div>
      </section>
    </div>
  ) : null;

  const csvExportDialog = csvExportDialogOpen ? (
    <div className="modalOverlay csvExportOverlay" onMouseDown={closeCsvExportDialog}>
      <section
        className="csvExportModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csvExportTitle"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modalHeader csvExportHeader">
          <div>
            <p className="eyebrow">{t("export.csvModalEyebrow")}</p>
            <h2 id="csvExportTitle">{t("export.csvModalTitle")}</h2>
            <span>{t("export.csvModalSubtitle")}</span>
          </div>
          <button type="button" className="iconButton" aria-label={t("dialog.cancel")} onClick={closeCsvExportDialog}>
            ×
          </button>
        </div>

        <div className="csvExportBody">
          <div className="csvRiskPanel" role="alert">
            <strong>{t("export.csvRiskTitle")}</strong>
            <p>{t("export.csvRiskIntro")}</p>
            <ul>
              <li>{t("export.csvRiskSecrets")}</li>
              <li>{t("export.csvRiskStorage")}</li>
              <li>{t("export.csvRiskBackup")}</li>
            </ul>
          </div>

          <div className="csvRecommendedPanel">
            <strong>{t("export.csvRecommendedTitle")}</strong>
            <p>{t("export.csvRecommendedBackup")}</p>
          </div>

          <label className="csvExportPasswordField">
            {t("export.confirmPassword")}
            <input
              type="password"
              value={exportPassword}
              onChange={(event) => setExportPassword(event.target.value)}
              placeholder={t("auth.unlockPlaceholder")}
              autoFocus
            />
          </label>

          <label className="csvAcknowledgeBox">
            <input
              type="checkbox"
              checked={csvExportAcknowledged}
              onChange={(event) => setCsvExportAcknowledged(event.target.checked)}
            />
            <span>{t("export.csvAcknowledge")}</span>
          </label>
        </div>

        <div className="modalActions csvExportActions">
          <button
            className="dangerConfirmButton"
            type="button"
            disabled={busy || !csvExportAcknowledged || exportPassword.length === 0}
            onClick={() => void handleExportPlainCsv()}
          >
            {t("export.downloadCsv")}
          </button>
          <button className="secondaryButton" type="button" onClick={closeCsvExportDialog}>
            {t("dialog.cancel")}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  const restoreBackupDialog = restorePopupOpen ? (
    <div
      className="popupOverlay"
      onMouseDown={() => {
        setRestorePopupOpen(false);
        setRestorePassword("");
      }}
    >
      <section className="restoreDialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="detailHeader">
          <div>
            <span>{t("restore.encryptedBackup")}</span>
            <h2>Restaurar backup</h2>
          </div>
          <button
            className="iconButton"
            onClick={() => {
              setRestorePopupOpen(false);
              setRestorePassword("");
            }}
          >
            ×
          </button>
        </div>

        <p>{t("restore.description")}</p>

        <label>
          {t("restore.backupPassword")}
          <input
            type="password"
            value={restorePassword}
            onChange={(event) => setRestorePassword(event.target.value)}
            placeholder={t("restore.backupPasswordPlaceholder")}
            autoFocus
          />
        </label>

        <label className="fileImportButton inlineFileButton">
          {t("settings.selectBackup")}
          <input
            type="file"
            accept=".kpvault,application/json"
            onChange={(event) => {
              void handleBackupFileInput(event.target.files?.[0], restorePassword);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </section>
    </div>
  ) : null;

  const csvImportDialog = csvImportPreview ? (
    <div className="modalOverlay csvImportOverlay" onMouseDown={cancelCsvImportPreview}>
      <section className="csvImportModal" role="dialog" aria-modal="true" aria-labelledby="csvImportTitle" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHeader csvImportModalHeader">
          <div>
            <p className="eyebrow">{t("import.csvTitle")}</p>
            <h2 id="csvImportTitle">{t("import.previewTitle")}</h2>
            <span>{t("import.previewFile", { name: csvImportPreview.filename })}</span>
          </div>
          <button type="button" className="iconButton" aria-label={t("import.cancelPreview")} onClick={cancelCsvImportPreview}>
            ×
          </button>
        </div>

        <div className="csvImportPreview" role="region" aria-label={t("import.previewTitle")}>
          <div className="csvImportStats">
            <div>
              <strong>{csvImportAnalysis.totalRows}</strong>
              <span>{t("import.statRows")}</span>
            </div>
            <div>
              <strong>{csvImportAnalysis.validCount}</strong>
              <span>{t("import.statValid")}</span>
            </div>
            <div>
              <strong>{csvImportAnalysis.invalidCount}</strong>
              <span>{t("import.statInvalid")}</span>
            </div>
            <div>
              <strong>{csvImportAnalysis.duplicateCount}</strong>
              <span>{t("import.statDuplicates")}</span>
            </div>
          </div>

          <div className="csvMappingGrid">
            {CSV_IMPORT_FIELDS.map((field) => (
              <label key={field.key}>
                {t(field.labelKey)}
                <select
                  value={csvImportPreview.mapping[field.key]}
                  onChange={(event) => updateCsvImportMapping(field.key, event.target.value)}
                >
                  <option value="">{t("import.fieldIgnore")}</option>
                  {csvImportPreview.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {csvImportAnalysis.duplicateCount > 0 && (
            <label className="csvDuplicateToggle">
              <input
                type="checkbox"
                checked={csvImportIncludeDuplicates}
                onChange={(event) => setCsvImportIncludeDuplicates(event.target.checked)}
              />
              <span>{t("import.includeDuplicates")}</span>
            </label>
          )}

          <div className="csvPreviewList">
            {csvImportAnalysis.items.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className={item.errors.length > 0 ? "csvPreviewItem invalid" : item.duplicateTitle ? "csvPreviewItem duplicate" : "csvPreviewItem"}
              >
                <div>
                  <strong>{item.credential.title}</strong>
                  <span>
                    {t("import.previewLine", { line: item.lineNumber })} · {item.credential.username || item.credential.url || t("credential.noUser")}
                  </span>
                </div>
                {(item.errors.length > 0 || item.warnings.length > 0) && (
                  <small>
                    {[...item.errors, ...item.warnings]
                      .map((key) =>
                        key === "import.validation.duplicate" && item.duplicateTitle
                          ? t(key, { title: item.duplicateTitle })
                          : t(key),
                      )
                      .join(" ")}
                  </small>
                )}
              </div>
            ))}

            {csvImportAnalysis.items.length > 5 && (
              <p className="csvPreviewHint">
                {t("import.previewMore", { count: csvImportAnalysis.items.length - 5 })}
              </p>
            )}
          </div>
        </div>

        <div className="modalActions csvImportActions">
          <button className="primaryButton" type="button" disabled={busy || csvImportAnalysis.importableItems.length === 0} onClick={() => void confirmCsvImportPreview()}>
            {t("import.importPreview", { count: csvImportAnalysis.importableItems.length })}
          </button>
          <button className="secondaryButton" type="button" onClick={cancelCsvImportPreview}>
            {t("dialog.cancel")}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  if (mode === "loading") {
    return (
      <>
        <main className="authShell authDesktopShell">
          <section className="authCard authExperience authLoading">
            <div className="authUtilityBar">
              <div className="authProductMark">
                <AppLogo size="sm" />
                <div>
                  <strong>KPassword</strong>
                  <span>{t("app.localVault")}</span>
                </div>
              </div>
              {authLoginToolsElement}
            </div>

            <div className="authHeroBlock">
              <AppLogo size="lg" />
              <p className="eyebrow">{t("auth.localOfflineBadge")}</p>
              <h1>KPassword</h1>
              <p>{t("auth.heroDescription")}</p>
              <div className="authTrustRow">
                <span>{t("auth.trustLocal")}</span>
                <span>{t("auth.trustEncrypted")}</span>
                <span>{t("auth.trustPrivate")}</span>
              </div>
            </div>

            <section className="authPanel authLoadingPanel">
              <span className="authPanelLabel">{t("status.loadingVault")}</span>
              <div className="authLoadingBar" aria-hidden="true" />
            </section>

            <footer className="authDeveloperCredit">
              Desenvolvido por <strong>MNSTechbr</strong>
            </footer>
          </section>
        </main>
        {confirmDialogElement}
        {restoreBackupDialog}
      </>
    );
  }

  if (mode === "setup") {
    return (
      <>
        <main className="authShell authDesktopShell">
          <section className="authCard authExperience authSetup">
            <div className="authUtilityBar">
              <div className="authProductMark">
                <AppLogo size="sm" />
                <div>
                  <strong>KPassword</strong>
                  <span>{t("app.localVault")}</span>
                </div>
              </div>
              {authLoginToolsElement}
            </div>

            <div className="authHeroBlock">
              <AppLogo size="lg" />
              <p className="eyebrow">{t("auth.firstAccess")}</p>
              <h1>{t("auth.createMasterTitle")}</h1>
              <p>{t("auth.createMasterDescription")}</p>

              <div className="firstUseGuide refinedFirstUseGuide">
                <strong>{t("onboarding.title")}</strong>
                <span>{t("onboarding.step1")}</span>
                <span>{t("onboarding.step2")}</span>
                <span>{t("onboarding.step3")}</span>
              </div>
            </div>

            <section className="authPanel">
              <span className="authPanelLabel">{t("auth.setupPanelLabel")}</span>
              <form onSubmit={handleCreateVault} className="authForm">
                <label>
                  {t("auth.masterPassword")}
                  <input
                    type="password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    placeholder={t("auth.masterPlaceholder")}
                    autoFocus
                  />
                </label>

                <label>
                  {t("auth.confirmMasterPassword")}
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder={t("auth.repeatPassword")}
                  />
                </label>

                {setupPassword && (
                  <div className="securityNotes">
                    {masterIssues.length === 0 ? (
                      <span>{t("auth.validMasterPassword")}</span>
                    ) : (
                      masterIssues.map((issue) => <span key={issue}>{translateValidationIssue(issue, appLanguage)}</span>)
                    )}
                  </div>
                )}

                {message && <div className="message error">{message}</div>}

                <button disabled={busy} className="primaryButton">
                  {busy ? t("auth.creatingVault") : t("auth.createEncryptedVault")}
                </button>
              </form>
            </section>

            <footer className="authDeveloperCredit">
              Desenvolvido por <strong>MNSTechbr</strong>
            </footer>
          </section>
        </main>
        {confirmDialogElement}
        {restoreBackupDialog}
      </>
    );
  }

  if (mode === "locked") {
    return (
      <>
        <main className="authShell authDesktopShell">
          <section className={`authCard authExperience authLocked${unlockPassword || busy || windowsHelloBusy ? " authUnlockTyping" : ""}${unlockGateOpen ? " authUnlockSuccess" : ""}`}>
            <div className="authUtilityBar">
              <div className="authProductMark">
                <AppLogo size="sm" />
                <div>
                  <strong>KPassword</strong>
                  <span>{t("app.localVault")}</span>
                </div>
              </div>
              {authLoginToolsElement}
            </div>

            <div className="authHeroBlock authLogoStage">
              <AppLogo
                size="lg"
                className={unlockPassword || busy || windowsHelloBusy || unlockGateOpen ? "vaultLogo opening" : "vaultLogo"}
              />
            </div>

            <section className="authPanel authUnlockPanel">
              <span className="authPanelLabel">{t("auth.vaultBlockedPanelLabel")}</span>
              <form onSubmit={handleUnlock} className="authForm authUnlockForm">
                <label>
                  {t("auth.masterPassword")}
                  <input
                    type="password"
                    value={unlockPassword}
                    onChange={(event) => setUnlockPassword(event.target.value)}
                    placeholder={t("auth.unlockPlaceholder")}
                    autoFocus
                  />
                </label>

                {message && <div className="message error">{message}</div>}

                <button disabled={busy} className="primaryButton">
                  {busy ? t("auth.unlocking") : t("auth.unlock")}
                </button>

                {windowsHelloStatus.enabled && windowsHelloStatus.available && (
                  <button
                    type="button"
                    className="windowsHelloButton"
                    disabled={busy || windowsHelloBusy}
                    onClick={() => void handleUnlockWithWindowsHello()}
                  >
                    {windowsHelloBusy ? t("auth.unlocking") : getPinUnlockLabel(appLanguage)}
                  </button>
                )}
              </form>
            </section>

            <footer className="authDeveloperCredit">
              Desenvolvido por <strong>MNSTechbr</strong>
            </footer>
          </section>
        </main>
        {confirmDialogElement}
        {restoreBackupDialog}
      </>
    );
  }

  return (
    <main
      className={`appShell ${sidebarExpanded ? "sidebarOpen" : "sidebarClosed"}${sidebarHorizontal ? " sidebarHorizontal" : ""}`}
    >
      <aside className="sidebar">
        <div className="sidebarBrand">
          <button
            className="sidebarToggle"
            onClick={() => {
              if (!sidebarHorizontal) {
                setSidebarExpanded((current) => !current);
              }
            }}
            title={sidebarHorizontal ? "KPassword" : sidebarExpanded ? t("nav.closeSidebar") : t("nav.openSidebar")}
            aria-label={sidebarHorizontal ? "KPassword" : sidebarExpanded ? t("nav.closeSidebar") : t("nav.openSidebar")}
            aria-disabled={sidebarHorizontal}
            tabIndex={sidebarHorizontal ? -1 : 0}
          >
            <AppLogo size="md" />
          </button>

          <div className="brandText">
            <strong>KPassword</strong>
            <span>{t("app.localVault")}</span>
          </div>
        </div>

        <nav className="navList"><button
            className={screen === "credentials" ? "active" : ""}
            onClick={() => setScreen("credentials")}
            title={t("nav.credentials")}
            aria-label={t("nav.credentials")}
          >
            <span className="navIcon" aria-hidden="true">🔑</span>
            <span className="navLabel">{t("nav.credentials")}</span>
          </button>
          <button
            className={screen === "dashboard" ? "active" : ""}
            onClick={() => setScreen("dashboard")}
            title={t("nav.dashboard")}
            aria-label={t("nav.dashboard")}
          >
            <span className="navIcon" aria-hidden="true">📊</span>
            <span className="navLabel">{t("nav.dashboard")}</span>
          </button>
          <button
            className={screen === "trash" ? "active" : ""}
            onClick={() => setScreen("trash")}
            title={t("nav.trash")}
            aria-label={t("nav.trash")}
          >
            <span className="navIcon" aria-hidden="true">🗑️</span>
            <span className="navLabel">{t("nav.trash")}</span>
          </button>
          <button
            className={screen === "settings" ? "active" : ""}
            onClick={() => setScreen("settings")}
            title={t("nav.securityBackup")}
            aria-label={t("nav.securityBackup")}
          >
            <span className="navIcon" aria-hidden="true">🛡️</span>
            <span className="navLabel">{t("nav.securityBackup")}</span>
          </button>
          <button
            className={screen === "preferences" ? "active" : ""}
            onClick={() => setScreen("preferences")}
            title={t("nav.preferences")}
            aria-label={t("nav.preferences")}
          >
            <span className="navIcon" aria-hidden="true">⚙️</span>
            <span className="navLabel">{t("nav.preferences")}</span>
          </button>
        </nav>

        <div className="sidebarFooter">
          <button className="lockButton" onClick={lockVault} title={t("nav.lockVault")} aria-label={t("nav.lockVault")}>
            <span className="navIcon" aria-hidden="true">🔒</span>
            <span className="navLabel">{t("nav.lockVault")}</span>
          </button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="topbarTitle">
            <AppLogo size="md" />
            <div>
              <p className="eyebrow">{t("topbar.localProtection")}</p>
              <h1>
                {screen === "credentials" && t("nav.credentials")}
                {screen === "dashboard" && t("nav.dashboard")}
                {screen === "trash" && t("nav.trash")}
                {screen === "settings" && t("nav.securityBackup")}
                {screen === "preferences" && t("nav.preferences")}
              </h1>
            </div>
          </div>

          <div className="topbarActions">
            <button
              type="button"
              className="vaultIndicator"
              onClick={() => setScreen("preferences")}
              title={t("vault.current")}
            >
              <span>{t("vault.current")}</span>
              <strong>{getVaultDisplayName(activeVaultName, vaultFiles)}</strong>
            </button>
            <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} compact />
            {screen !== "trash" && (
              <button
                className="primaryButton addItemIconButton"
                onClick={openNewCredentialForm}
                title={t("topbar.addItem")}
                aria-label={t("topbar.addItem")}
              >
                <span aria-hidden="true">+</span>
              </button>
            )}
          </div>
        </header>

        {message && <div className="message success">{message}</div>}

        {screen === "credentials" && (
          <>
            <div className="toolbar vaultSearchToolbar">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("search.placeholder")}
              />

              <div className="quickFilterDropdown" ref={quickFilterMenuRef}>
                <button
                  type="button"
                  className={activeQuickFilter === "all" ? "quickFilterMenuButton" : "quickFilterMenuButton active"}
                  onClick={() => setQuickFilterMenuOpen((current) => !current)}
                  aria-haspopup="menu"
                  aria-expanded={quickFilterMenuOpen}
                >
                  <span>{quickFilterButtonLabel}</span>
                  <strong>{quickFilterButtonCount}</strong>
                  <span className="quickFilterMenuChevron" aria-hidden="true">⌄</span>
                </button>

                {quickFilterMenuOpen && (
                  <div className="quickFilterMenu" role="menu" aria-label={t("quickFilters.title")}>
                    <div className="quickFilterMenuHeader">
                      <span>{t("quickFilters.title")}</span>
                      <small>{t("search.results", { count: filteredCredentials.length })}</small>
                    </div>

                    {quickFilterOptions.map((item) => (
                      <button
                        key={item.filter}
                        type="button"
                        role="menuitem"
                        className={activeQuickFilter === item.filter ? "quickFilterMenuItem active" : "quickFilterMenuItem"}
                        onClick={() => openQuickVaultFilter(item.filter)}
                        disabled={item.filter !== "all" && item.count === 0}
                      >
                        <span>{item.label}</span>
                        <strong>{item.count}</strong>
                      </button>
                    ))}

                    {activeQuickFilter !== "all" && (
                      <button
                        type="button"
                        role="menuitem"
                        className="quickFilterMenuClear"
                        onClick={() => openQuickVaultFilter("all")}
                      >
                        {t("quickFilters.clearFilter")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {allVaultTags.length > 0 && (
              <div className="tagFilterBar" aria-label={t("tags.title")}>
                <span>{t("tags.title")}</span>
                <div className="tagFilterChips">
                  <button
                    type="button"
                    className={activeTagFilter ? "tagFilterChip" : "tagFilterChip active"}
                    onClick={() => setActiveTagFilter("")}
                  >
                    {t("tags.filterAll")}
                  </button>
                  {allVaultTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={activeTagFilter === tag ? "tagFilterChip active" : "tagFilterChip"}
                      onClick={() => setActiveTagFilter(tag)}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTagFilter && (
              <div className="diagnosticFilterBanner tagFilterBanner">
                <div>
                  <strong>{t("tags.filteringBy")}</strong>
                  <span>#{activeTagFilter}</span>
                </div>
                <button type="button" className="secondaryButton" onClick={() => setActiveTagFilter("")}>
                  {t("tags.clearFilter")}
                </button>
              </div>
            )}

            {activeDiagnosticFilter !== "all" && (
              <div className="diagnosticFilterBanner">
                <div>
                  <strong>{t("diagnostic.filteringBy")}</strong>
                  <span>{getDiagnosticLabel(activeDiagnosticFilter)}</span>
                </div>
                <button type="button" className="secondaryButton" onClick={() => setActiveDiagnosticFilter("all")}>
                  {t("diagnostic.clearFilter")}
                </button>
              </div>
            )}

            <section className="credentialRows">
              {filteredCredentials.map((credential, index) => {
                const itemType = getItemType(credential);
                const passwordScore = isCredentialItem(credential) ? getPasswordScore(credential.password) : 0;
                const primarySecret = getItemPrimarySecret(credential);
                const previousCredential = filteredCredentials[index - 1];
                const nextCredential = filteredCredentials[index + 1];
                const canMoveUp =
                  canReorderCredentials && previousCredential?.favorite === credential.favorite;
                const canMoveDown =
                  canReorderCredentials && nextCredential?.favorite === credential.favorite;

                return (
                  <article
                    className="credentialRow"
                    key={credential.id}
                    onClick={() => setDetailCredentialId(credential.id)}
                    title={t("credential.clickTitle")}
                  >
                    <span className="reorderControls" aria-label={t("credential.reorder")}>
                      <button
                        type="button"
                        disabled={!canMoveUp}
                        title={canReorderCredentials ? t("credential.moveUp") : t("credential.clearSearchToReorder")}
                        onClick={(event) => {
                          stopAction(event);
                          void moveCredentialByOffset(credential.id, -1);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={!canMoveDown}
                        title={canReorderCredentials ? t("credential.moveDown") : t("credential.clearSearchToReorder")}
                        onClick={(event) => {
                          stopAction(event);
                          void moveCredentialByOffset(credential.id, 1);
                        }}
                      >
                        ↓
                      </button>
                    </span>
                    <span
                      className={credential.favorite ? "rowStar active" : "rowStar"}
                      onClick={(event) => {
                        stopAction(event);
                        void toggleFavorite(credential.id);
                      }}
                      title={credential.favorite ? t("credential.removeFavorite") : t("credential.favorite")}
                    >
                      ★
                    </span>

                    <span className="rowMain">
                      <strong>{credential.title}</strong>
                      <small>{getItemSubtitle(credential, appLanguage)}</small>
                      {getCredentialTags(credential).length > 0 && (
                        <span className="credentialTags compact">
                          {getCredentialTags(credential).slice(0, 3).map((tag) => (
                            <span key={tag} className="tagPill">#{tag}</span>
                          ))}
                        </span>
                      )}
                    </span>

                    <span className="rowPassword">
                      {isCredentialItem(credential) ? maskPassword(credential.password) : maskGenericSecret(primarySecret)}
                    </span>

                    <span className="rowCategory">
                      {getItemTypeIcon(itemType)} {getItemTypeLabel(itemType, appLanguage)}
                    </span>

                    <span className="rowHealth">
                      {isCredentialItem(credential) ? (
                        <>
                          <span>{translatePasswordLabel(getPasswordLabel(passwordScore), appLanguage)} · {passwordScore}%</span>
                          <span className={getExpiryBadgeClass(getPasswordExpiryInfo(credential).status)}>
                            {getExpiryLabel(credential)}
                          </span>
                          {getDiagnosticIssuesFor(credential).slice(0, 2).map((issue) => (
                            <span key={issue} className={`diagnosticMiniBadge issue-${issue}`}>
                              {getDiagnosticLabel(issue)}
                            </span>
                          ))}
                        </>
                      ) : (
                        <>
                          <span>{getCategoryLabel(credential.category, appLanguage)}</span>
                          <span className="expiryBadge never">{t("item.encrypted")}</span>
                        </>
                      )}
                    </span>

                    <span className="rowActions">
                      {isCredentialItem(credential) && credential.username && (
                        <button
                          type="button"
                          onClick={(event) => {
                            stopAction(event);
                            void copySecure(credential.username, `user-${credential.id}`);
                          }}
                        >
                          {copiedField === `user-${credential.id}` ? t("credential.copied") : t("credential.copyUser")}
                        </button>
                      )}

                      {primarySecret && (
                        <button
                          type="button"
                          onClick={(event) => {
                            stopAction(event);
                            void copySecure(primarySecret, `secret-${credential.id}`);
                          }}
                        >
                          {copiedField === `secret-${credential.id}` ? t("credential.copiedFemale") : t(isCredentialItem(credential) ? "credential.copyPassword" : "item.copySecret")}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(event) => {
                          stopAction(event);
                          openEditCredentialForm(credential);
                        }}
                      >
                        {t("credential.edit")}
                      </button>
                    </span>
                  </article>
                );
              })}

              {filteredCredentials.length === 0 && (
                <div className="emptyState">
                  <h2>{t("credential.emptyTitle")}</h2>
                  <p>{t("credential.emptyDescription")}</p>
                  <button className="primaryButton" onClick={openNewCredentialForm}>
                    {t("topbar.addItem")}
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {screen === "dashboard" && (
          <div className="assistantPage">
            <section className={`assistantHero tone-${vaultHealthTone}`}>
              <div>
                <p className="eyebrow">{t("assistant.eyebrow")}</p>
                <h2>{t("assistant.title")}</h2>
                <p>
                  {assistantImprovementCount > 0
                    ? t("assistant.heroWithActions", { count: assistantImprovementCount })
                    : t("assistant.heroClean")}
                </p>
              </div>

              <div className="assistantPulse" aria-label={t("diagnostic.score")}>
                <span>{t("diagnostic.score")}</span>
                <strong>{vaultHealthScore}</strong>
                <small>{t(`diagnostic.health.${vaultHealthTone}`)}</small>
              </div>
            </section>

            <section className="assistantDecisionGrid">
              <article className={`assistantNextCard tone-${assistantMainAction?.tone ?? "neutral"}`}>
                <div className="assistantCardHeader">
                  <span className="assistantOrb" aria-hidden="true">✦</span>
                  <div>
                    <p className="eyebrow">{t("assistant.nextEyebrow")}</p>
                    <h2>{assistantMainAction ? t(`assistant.action.title.${assistantMainAction.issue}`, { title: assistantMainAction.credential.title }) : t("assistant.noActionTitle")}</h2>
                  </div>
                </div>

                {assistantMainAction ? (
                  <>
                    <p className="assistantReason">
                      {t(`assistant.action.reason.${assistantMainAction.issue}`, { title: assistantMainAction.credential.title })}
                    </p>

                    <div className="assistantIssueLine">
                      <span className={`diagnosticMiniBadge issue-${assistantMainAction.issue}`}>{getDiagnosticLabel(assistantMainAction.issue)}</span>
                      <span>{getItemSubtitle(assistantMainAction.credential, appLanguage)}</span>
                    </div>

                    <div className="assistantActionButtons">
                      <button className="primaryButton" type="button" onClick={() => runAssistantPrimaryAction(assistantMainAction)}>
                        {t(`assistant.primary.${assistantMainAction.kind}`)}
                      </button>
                      {assistantMainAction.credential.url.trim() && (
                        <button className="secondaryButton" type="button" onClick={() => void openAssistantSite(assistantMainAction.credential)}>
                          {t("assistant.openSite")}
                        </button>
                      )}
                      <button className="ghostButton" type="button" onClick={() => openAssistantCredential(assistantMainAction.credential)}>
                        {t("assistant.viewCredential")}
                      </button>
                      <button className="ghostButton assistantSkipButton" type="button" onClick={() => skipAssistantAction(assistantMainAction)}>
                        {t("assistant.skipNow")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="assistantEmptyAction">
                    <p>{t("assistant.noActionDescription")}</p>
                    <button className="primaryButton" type="button" onClick={() => setScreen("credentials")}>{t("assistant.goVault")}</button>
                  </div>
                )}
              </article>

              <article className="assistantQueueCard">
                <div className="assistantCardHeader compact">
                  <div>
                    <p className="eyebrow">{t("assistant.queueEyebrow")}</p>
                    <h2>{t("assistant.queueTitle")}</h2>
                  </div>
                  {assistantSkippedCount > 0 && (
                    <button className="ghostButton" type="button" onClick={() => setAssistantSkippedIds([])}>
                      {t("assistant.restoreSkipped", { count: assistantSkippedCount })}
                    </button>
                  )}
                </div>

                <div className="assistantQueueList">
                  {assistantQueue.length > 0 ? (
                    assistantQueue.map((action, index) => (
                      <button
                        key={action.id}
                        type="button"
                        className={`assistantQueueItem tone-${action.tone}`}
                        onClick={() => setAssistantFocusId(action.id)}
                      >
                        <span>{index + 1}</span>
                        <strong>{action.credential.title}</strong>
                        <small>{getDiagnosticLabel(action.issue)}</small>
                      </button>
                    ))
                  ) : (
                    <p className="emptyText">{assistantMainAction ? t("assistant.queueEmpty") : t("assistant.noIssuesQueue")}</p>
                  )}
                </div>
              </article>
            </section>

            <section className="assistantActionColumns">
              <article className="assistantSafeCard">
                <div>
                  <p className="eyebrow">{t("assistant.safeEyebrow")}</p>
                  <h2>{t("assistant.safeTitle")}</h2>
                  <p>{assistantSafeActionCount > 0 ? t("assistant.safeDescription", { count: assistantSafeActionCount }) : t("assistant.safeEmpty")}</p>
                </div>

                {assistantTagSuggestions.length > 0 && (
                  <>
                    <div className="assistantTagRail">
                      {assistantTagSuggestions.slice(0, 5).map((suggestion) => (
                        <button key={suggestion.id} className="assistantSuggestionButton" type="button" onClick={() => void applyAssistantTagSuggestion(suggestion)} disabled={busy}>
                          <span>{suggestion.credential.title}</span>
                          <strong>#{suggestion.tag}</strong>
                        </button>
                      ))}
                    </div>

                    <button className="primaryButton" type="button" onClick={() => void applyAssistantTagSuggestions(assistantTagSuggestions)} disabled={busy}>
                      {t("assistant.tags.applyCount", { count: assistantTagSuggestions.length })}
                    </button>
                  </>
                )}
              </article>

              <article className="assistantNeedsYouCard">
                <div>
                  <p className="eyebrow">{t("assistant.needsYouEyebrow")}</p>
                  <h2>{t("assistant.needsYouTitle")}</h2>
                  <p>{assistantExternalActionCount > 0 ? t("assistant.needsYouDescription", { count: assistantExternalActionCount }) : t("assistant.needsYouEmpty")}</p>
                </div>

                <div className="assistantIssueChips">
                  {diagnosticCards
                    .filter((card) => card.count > 0)
                    .map((card) => (
                      <button key={card.filter} type="button" className={`assistantIssueChipButton tone-${card.tone}`} onClick={() => openDiagnosticFilter(card.filter)}>
                        <strong>{card.count}</strong>
                        <span>{getDiagnosticLabel(card.filter)}</span>
                      </button>
                    ))}
                </div>
              </article>
            </section>

            <section className="assistantRulesCard">
              <strong>{t("assistant.ruleTitle")}</strong>
              <span>{t("assistant.ruleText")}</span>
            </section>
          </div>
        )}

        {screen === "trash" && (
          <div className="settingsGrid">
            <article className="wideCard">
              <div className="cardTitleRow">
                <div>
                  <h2>{t("trash.title")}</h2>
                  <p>{t("trash.description")}</p>
                </div>
                <button
                  className="dangerConfirmButton"
                  disabled={deletedCredentials.length === 0}
                  onClick={() => void handleEmptyTrash()}
                >
                  {t("trash.empty")}
                </button>
              </div>

              <div className="trashList">
                {deletedCredentials.map((credential) => (
                  <article key={credential.id} className="trashItem">
                    <div>
                      <strong>{credential.title}</strong>
                      <span>
                        {credential.username || t("credential.noUser")} · {t("trash.deletedAt")} {formatDate(credential.deletedAt, appLanguage)}
                      </span>
                    </div>
                    <div className="trashActions">
                      <button className="secondaryButton" onClick={() => void handleRestoreCredential(credential.id)}>
                        {t("trash.restore")}
                      </button>
                      <button className="dangerButton" onClick={() => void handlePermanentDeleteCredential(credential.id)}>
                        {t("trash.deleteForever")}
                      </button>
                    </div>
                  </article>
                ))}

                {deletedCredentials.length === 0 && (
                  <div className="emptyState">
                    <h2>{t("trash.emptyListTitle")}</h2>
                    <p>{t("trash.emptyListDescription")}</p>
                  </div>
                )}
              </div>
            </article>
          </div>
        )}

        {screen === "settings" && (
          <div className="settingsGrid">
            <article className="wideCard storageCard">
              <div className="cardTitleRow">
                <div>
                  <h2>{t("settings.localStorage")}</h2>
                  <p>{t("settings.localStorageDescription")}</p>
                </div>

                <button
                  className="secondaryButton"
                  onClick={() => {
                    setShowStoragePaths(true);
                    window.setTimeout(() => setShowStoragePaths(false), 30000);
                  }}
                >
                  {t("settings.show30s")}
                </button>
              </div>

              {showStoragePaths ? (
                <div className="pathGrid">
                  <div className="pathBox">
                    <span>{t("settings.encryptedVault")}</span>
                    <strong>{storageInfo?.vault_path ?? t("settings.loading")}</strong>
                  </div>
                  <div className="pathBox">
                    <span>{t("settings.encryptedBackups")}</span>
                    <strong>{storageInfo?.backup_dir ?? t("settings.loading")}</strong>
                  </div>
                </div>
              ) : (
                <div className="hiddenPathsBox">
                  <strong>{t("settings.hiddenPaths")}</strong>
                  <span>{t("settings.hiddenPathsDescription")}</span>
                </div>
              )}

              <div className="folderActionGrid">
                <button className="secondaryButton" type="button" onClick={() => void handleOpenVaultFolder()}>
                  {t("folders.openVault")}
                </button>
                <button className="secondaryButton" type="button" onClick={() => void handleOpenBackupFolder()}>
                  {t("folders.openBackups")}
                </button>
              </div>
            </article>

            <article className="wideCard">
              <h2>{t("settings.autoBackups")}</h2>
              <p>{t("settings.autoBackupsDescription")}</p>

              <div className="backupList">
                {backups.slice(0, 3).map((backup) => (
                  <div key={backup.filename}>
                    <strong>{backup.filename}</strong>
                    <span>
                      {formatDate(backup.modified_epoch_ms)} · {(backup.size_bytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ))}

                {backups.length === 0 && <p className="emptyText">{t("settings.noBackups")}</p>}
              </div>

              {backups.length > 3 && (
                <p className="backupListHint">
                  Exibindo os 3 backups mais recentes. Para ver todos, use Abrir pasta de backups.
                </p>
              )}

              <button
                className="secondaryButton"
                onClick={() => {
                  if (!vault) return;

                  void askConfirmation({
                    title: "Criar backup",
                    message: "Criar um novo backup criptografado agora?",
                    confirmText: "Criar backup",
                    cancelText: t("dialog.cancel"),
                  }).then((confirmed) => {
                    if (!confirmed) return;

                    void persistVault(vault, undefined, true)
                      .then(() => refreshStorageInfo())
                      .then(() => setMessage("Backup criptografado atualizado."))
                      .catch(() => setMessage("Erro ao criar backup."));
                  });
                }}
              >
                Criar backup agora
              </button>
            </article>

            <article className="wideCard securityActionCard settingsAdvancedToggleCard">
              <div>
                <h2>{t("settings.advancedOptionsTitle")}</h2>
                <p>{t("settings.advancedOptionsDescription")}</p>
              </div>
              <button
                className="secondaryButton"
                type="button"
                onClick={() => setSecurityAdvancedOpen((open) => !open)}
                aria-expanded={securityAdvancedOpen}
              >
                {securityAdvancedOpen ? t("settings.hideAdvancedOptions") : t("settings.showAdvancedOptions")}
              </button>
            </article>

            {securityAdvancedOpen && (
              <div className="settingsAdvancedStack">
            <article className="wideCard securityActionCard settingsAdvancedCard">
              <div className="settingsSectionHeader">
                <span>
                  <strong>{t("settings.masterPasswordTitle")}</strong>
                  <small>{t("settings.masterPasswordDescription")}</small>
                </span>
              </div>

              <div className="settingsAccordionBody">
                <p>
                  Não existe recuperação da senha mestra atual. Se ela for perdida, o cofre e os backups criptografados não podem ser descriptografados. Troque a senha periodicamente e guarde-a em local seguro.
                </p>

                <form className="changePasswordForm" onSubmit={handleChangeMasterPassword}>
                  <label>
                    Senha atual
                    <input
                      type="password"
                      value={currentMasterPassword}
                      onChange={(event) => setCurrentMasterPassword(event.target.value)}
                      placeholder="Digite a senha atual"
                    />
                  </label>
                  <label>
                    Nova senha mestra
                    <input
                      type="password"
                      value={newMasterPassword}
                      onChange={(event) => setNewMasterPassword(event.target.value)}
                      placeholder={t("auth.masterPlaceholder")}
                    />
                  </label>
                  <label>
                    Confirmar nova senha
                    <input
                      type="password"
                      value={newMasterConfirm}
                      onChange={(event) => setNewMasterConfirm(event.target.value)}
                      placeholder="Repita a nova senha"
                    />
                  </label>

                  {newMasterPassword && (
                    <div className="securityNotes inlineNotes">
                      {validateMasterPassword(newMasterPassword).length === 0 ? (
                        <span>{t("settings.newPasswordValid")}</span>
                      ) : (
                        validateMasterPassword(newMasterPassword).map((issue) => <span key={issue}>{translateValidationIssue(issue, appLanguage)}</span>)
                      )}
                    </div>
                  )}

                  <button className="primaryButton" disabled={busy}>
                    Alterar senha mestra
                  </button>
                </form>
              </div>
            </article>

            <article className="wideCard securityActionCard backupVerifyCard settingsAdvancedCard">
              <div className="settingsSectionHeader">
                <span>
                  <strong>{t("backupVerify.title")}</strong>
                  <small>{t("backupVerify.description")}</small>
                </span>
              </div>

              <div className="settingsAccordionBody">
              <div className="backupVerifyPanel">
                <label>
                  {t("backupVerify.passwordLabel")}
                  <input
                    type="password"
                    value={backupVerifyPassword}
                    onChange={(event) => setBackupVerifyPassword(event.target.value)}
                    placeholder={t("backupVerify.passwordPlaceholder")}
                  />
                </label>

                <label className="fileImportButton inlineFileButton backupVerifyButton">
                  {t("backupVerify.button")}
                  <input
                    type="file"
                    accept=".kpvault,application/json"
                    onChange={(event) => {
                      void handleVerifyBackupFile(event.target.files?.[0], backupVerifyPassword);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>

              {backupVerifyResult && (
                <div
                  className={backupVerifyResult.ok ? "backupVerifyResult success" : "backupVerifyResult failure"}
                  role="status"
                >
                  <strong>
                    {backupVerifyResult.ok
                      ? t("backupVerify.successTitle")
                      : t("backupVerify.failureTitle")}
                  </strong>
                  <p>
                    {backupVerifyResult.ok
                      ? t("backupVerify.successMessage")
                      : t("backupVerify.failureMessage")}
                  </p>
                  <p>{t("backupVerify.noChanges")}</p>

                  {backupVerifyResult.ok && (
                    <dl className="backupVerifyMeta">
                      {backupVerifyResult.backupVersion && (
                        <div>
                          <dt>{t("backupVerify.backupVersion")}</dt>
                          <dd>{backupVerifyResult.backupVersion}</dd>
                        </div>
                      )}
                      {backupVerifyResult.cryptoVersion !== undefined && (
                        <div>
                          <dt>{t("backupVerify.cryptoVersion")}</dt>
                          <dd>{backupVerifyResult.cryptoVersion}</dd>
                        </div>
                      )}
                      {backupVerifyResult.itemCount !== undefined && (
                        <div>
                          <dt>{t("backupVerify.itemCount")}</dt>
                          <dd>{backupVerifyResult.itemCount}</dd>
                        </div>
                      )}
                      {backupVerifyResult.createdAt && (
                        <div>
                          <dt>{t("backupVerify.createdAt")}</dt>
                          <dd>{formatDate(backupVerifyResult.createdAt, appLanguage)}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </div>
              )}
              </div>
            </article>

            <article className="wideCard securityActionCard settingsAdvancedCard">
              <div className="settingsSectionHeader">
                <span>
                  <strong>{t("settings.importBackup")}</strong>
                  <small>{t("settings.importBackupDescription")}</small>
                </span>
              </div>

              <div className="settingsAccordionBody">
              <label className="fileImportButton inlineFileButton">
                {t("settings.selectBackup")}
                <input
                  type="file"
                  accept=".kpvault,application/json"
                  onChange={(event) => {
                    void handleBackupFileInput(event.target.files?.[0], masterPassword);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              </div>
            </article>


            <article className="wideCard securityActionCard settingsAdvancedCard">
              <div className="settingsSectionHeader">
                <span>
                  <strong>{t("export.title")}</strong>
                  <small>{t("export.description")}</small>
                </span>
              </div>

              <div className="settingsAccordionBody">
              <div className="exportActionGrid">
                <div className="exportBox">
                  <strong>{t("export.encryptedTitle")}</strong>
                  <span>{t("export.encryptedDescription")}</span>
                  <button className="secondaryButton" type="button" onClick={() => void handleExportEncryptedJson()}>
                    {t("export.downloadEncrypted")}
                  </button>
                </div>

                <div className="exportBox dangerExportBox csvMigrationExportBox">
                  <span className="dangerBadge">{t("export.csvDangerBadge")}</span>
                  <strong>{t("export.csvTitle")}</strong>
                  <span>{t("export.csvDescription")}</span>
                  <small>{t("export.csvFilenameHint")}</small>
                  <button className="dangerConfirmButton" type="button" onClick={openCsvExportDialog}>
                    {t("export.openCsvDialog")}
                  </button>
                </div>

                <div className="exportBox csvImportBox">
                  <strong>{t("import.csvTitle")}</strong>
                  <span>{t("import.csvDescription")}</span>
                  <label className="fileImportButton inlineFileButton">
                    {t("import.selectCsv")}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) => {
                        void handleImportCsvFile(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>

                  {csvImportPreview && (
                    <div className="csvImportReadyHint" role="status">
                      <strong>{t("import.previewTitle")}</strong>
                      <span>{t("import.previewFile", { name: csvImportPreview.filename })}</span>
                    </div>
                  )}
                </div>
              </div>
              </div>
            </article>


            <article className="wideCard securityActionCard settingsAdvancedCard">
              <div className="settingsSectionHeader">
                <span>
                  <strong>{t("settings.securitySettings")}</strong>
                  <small>{t("settings.securitySettingsDescription")}</small>
                </span>
              </div>

              <div className="settingsAccordionBody">
                <p>{t("security.localThreatModel")}</p>

              <div className={windowsHelloStatus.enabled ? "windowsHelloPanel enabled" : "windowsHelloPanel"}>
                <div className="windowsHelloPanelText">
                  <strong>{t("windowsHello.title")}</strong>
                  <span>{t("windowsHello.description")}</span>
                  <small>
                    {windowsHelloStatus.enabled
                      ? t("windowsHello.statusEnabled")
                      : windowsHelloStatus.available
                        ? t("windowsHello.statusDisabled")
                        : t("windowsHello.unavailable")}
                  </small>
                </div>

                {windowsHelloStatus.enabled ? (
                  <button
                    type="button"
                    className="dangerConfirmButton"
                    disabled={busy || windowsHelloBusy}
                    onClick={() => void handleDisableWindowsHello()}
                  >
                    {windowsHelloBusy ? t("windowsHello.processing") : t("windowsHello.disable")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy || windowsHelloBusy || !windowsHelloStatus.available}
                    onClick={() => void handleEnableWindowsHello()}
                  >
                    {windowsHelloBusy ? t("windowsHello.processing") : t("windowsHello.enable")}
                  </button>
                )}
              </div>

              <div className="settingsControlGrid">
                <label>
                  {t("settings.autoLockLabel")}
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={vault?.settings.autoLockMinutes ?? 10}
                    onChange={(event) => void updateVaultSettings({ autoLockMinutes: getBoundedVaultInputValue(event.target.value, 10, 1, 120) })}
                  />
                </label>

                <label>
                  {t("settings.clipboardLabel")}
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={vault?.settings.clipboardClearSeconds ?? CLIPBOARD_CLEAR_SECONDS}
                    onChange={(event) => void updateVaultSettings({ clipboardClearSeconds: getBoundedVaultInputValue(event.target.value, CLIPBOARD_CLEAR_SECONDS, 10, 300) })}
                  />
                </label>

                <label>
                  {t("settings.backupIntervalLabel")}
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={vault?.settings.backupIntervalHours ?? 4}
                    onChange={(event) => void updateVaultSettings({ backupIntervalHours: getBoundedVaultInputValue(event.target.value, 4, 1, 24) })}
                  />
                </label>
              </div>

              <div className="toggleList">
                <label className="toggleRow">
                  <span>
                    <strong>{t("settings.lockOnInactive")}</strong>
                    <small>{t("settings.lockOnInactiveDescription")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={vault?.settings.lockOnInactive ?? true}
                    onChange={(event) => void updateVaultSettings({ lockOnInactive: event.target.checked })}
                  />
                </label>

                <label className="toggleRow">
                  <span>
                    <strong>{t("settings.lockOnMinimize")}</strong>
                    <small>{t("settings.lockOnMinimizeDescription")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={vault?.settings.lockOnMinimize ?? true}
                    onChange={(event) => void updateVaultSettings({ lockOnMinimize: event.target.checked })}
                  />
                </label>

                <label className="toggleRow">
                  <span>
                    <strong>{t("settings.lockOnClose")}</strong>
                    <small>{t("settings.lockOnCloseDescription")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={vault?.settings.lockOnClose ?? true}
                    onChange={(event) => void updateVaultSettings({ lockOnClose: event.target.checked })}
                  />
                </label>

                <label className="toggleRow">
                  <span>
                    <strong>{t("settings.notifyOnTray")}</strong>
                    <small>{t("settings.notifyOnTrayDescription")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={vault?.settings.notifyOnTray ?? true}
                    onChange={(event) => void updateVaultSettings({ notifyOnTray: event.target.checked })}
                  />
                </label>

                <label className="toggleRow">
                  <span>
                    <strong>{t("settings.soundOnTray")}</strong>
                    <small>{t("settings.soundOnTrayDescription")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={vault?.settings.soundOnTray ?? true}
                    onChange={(event) => void updateVaultSettings({ soundOnTray: event.target.checked })}
                  />
                </label>
              </div>

              <div className="securityGrid">
                <span>{t("settings.winV")}</span>
                <span>{t("settings.autostart")}</span>
                <span>{t("settings.tray")}</span>
                <span>{t("settings.singleInstance")}</span>
              </div>
              </div>
            </article>
              </div>
            )}
          </div>
        )}

        {screen === "preferences" && (
          <div className="preferencesGrid">
            <article className="wideCard preferenceCard">
              <h2>{t("vault.title")}</h2>
              <p>{t("vault.description")}</p>
              {vaultSelectorElement}
            </article>

            <article className="wideCard preferenceCard">
              <h2>{t("language.title")}</h2>
              <p>{t("language.description")}</p>
              <div className="languagePreferenceBox">
                <span>{t("language.current")}</span>
                <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} />
              </div>
            </article>

            <article className="wideCard preferenceCard helpAboutCompactCard">
              <div className="cardTitleRow">
                <div>
                  <h2>{t("helpAbout.title")}</h2>
                  <p>{t("helpAbout.description")}</p>
                </div>
                <span className="versionBadge">v{APP_VERSION}</span>
              </div>

              <div className="compactInfoGrid">
                <div>
                  <strong>{t("helpAbout.example1Title")}</strong>
                  <span>{t("helpAbout.example1Text")}</span>
                </div>
                <div>
                  <strong>{t("helpAbout.example2Title")}</strong>
                  <span>{t("helpAbout.example2Text")}</span>
                </div>
                <div>
                  <strong>{t("helpAbout.example3Title")}</strong>
                  <span>{t("helpAbout.example3Text")}</span>
                </div>
              </div>

              <div className="localSecurityNotice">
                <strong>{t("helpAbout.securityTitle")}</strong>
                <span>{t("helpAbout.securityText")}</span>
              </div>
            </article>

            <article className="wideCard preferenceCard">
              <h2>{t("preferences.theme")}</h2>
              <p>{t("preferences.themeDescription")}</p>

              <div className="optionGrid">
                <button
                  className={appTheme === "dark" ? "optionButton active" : "optionButton"}
                  onClick={() => setAppTheme("dark")}
                >
                  <span>🌙</span>
                  <strong>{t("preferences.dark")}</strong>
                  <small>{t("preferences.darkDescription")}</small>
                </button>

                <button
                  className={appTheme === "light" ? "optionButton active" : "optionButton"}
                  onClick={() => setAppTheme("light")}
                >
                  <span>☀️</span>
                  <strong>{t("preferences.light")}</strong>
                  <small>{t("preferences.lightDescription")}</small>
                </button>

                <button
                  className={appTheme === "mixed" ? "optionButton active" : "optionButton"}
                  onClick={() => setAppTheme("mixed")}
                >
                  <span>🌓</span>
                  <strong>{t("preferences.mixed")}</strong>
                  <small>{t("preferences.mixedDescription")}</small>
                </button>
              </div>
            </article>

            <article className="wideCard preferenceCard">
              <h2>{t("preferences.accessibility")}</h2>
              <p>{t("preferences.accessibilityDescription")}</p>

              <div className="toggleList">
                <label className="toggleRow">
                  <span>
                    <strong>{t("preferences.largeFont")}</strong>
                    <small>{t("preferences.largeFontDescription")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={fontScale === "large"}
                    onChange={(event) => setFontScale(event.target.checked ? "large" : "normal")}
                  />
                </label>

                <label className="toggleRow">
                  <span>
                    <strong>{t("preferences.reduceMotion")}</strong>
                    <small>{t("preferences.reduceMotionDescription")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={reduceMotion}
                    onChange={(event) => setReduceMotion(event.target.checked)}
                  />
                </label>

                <label className="toggleRow">
                  <span>
                    <strong>{t("preferences.compactList")}</strong>
                    <small>{t("preferences.compactListDescription")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={compactMode}
                    onChange={(event) => setCompactMode(event.target.checked)}
                  />
                </label>
              </div>
            </article>

            <article className="wideCard preferenceCard">
              <h2>{t("preferences.updates")}</h2>
              <p>{t("preferences.updatesDescription")}</p>

              <div className="updateSummary">
                <div>
                  <span>{t("preferences.installedVersion")}</span>
                  <strong>{APP_VERSION}</strong>
                </div>
                <div>
                  <span>{t("preferences.channel")}</span>
                  <strong>{UPDATE_GITHUB_OWNER && UPDATE_GITHUB_REPO ? t("preferences.githubReleases") : t("preferences.notConfigured")}</strong>
                </div>
              </div>

              <button className="secondaryButton" onClick={() => void handleCheckUpdates()}>
                {t("preferences.checkUpdate")}
              </button>

              {updateStatus && <div className="updateStatus">{updateStatus}</div>}
            </article>

            <article className="wideCard preferenceCard">
              <h2>{t("preferences.sensitiveActions")}</h2>
              <p>{t("preferences.sensitiveActionsDescription")}</p>

              <button
                className="dangerConfirmButton"
                onClick={() => {
                  void askConfirmation({
                    title: t("dialog.restoreAppearanceTitle"),
                    message: t("dialog.restoreAppearanceMessage"),
                    confirmText: t("dialog.restore"),
                    cancelText: t("dialog.cancel"),
                    tone: "danger",
                  }).then((confirmed) => {
                    if (!confirmed) return;

                    setAppTheme("dark");
                    setFontScale("normal");
                    setReduceMotion(false);
                    setCompactMode(false);
                    setMessage(t("success.appearanceRestored"));
                  });
                }}
              >
                {t("preferences.restoreAppearance")}
              </button>
            </article>
          </div>
        )}

      </section>

      {detailCredential && (() => {
        const itemType = getItemType(detailCredential);
        const primarySecret = getItemPrimarySecret(detailCredential);
        const historyEntries = getPasswordHistory(detailCredential);

        return (
          <div className="popupOverlay" onMouseDown={() => setDetailCredentialId(null)}>
            <aside className="detailPopup" onMouseDown={(event) => event.stopPropagation()}>
              <div className="detailHeader">
                <div>
                  <span>{getItemTypeIcon(itemType)} {getItemTypeLabel(itemType, appLanguage)} · {getCategoryLabel(detailCredential.category, appLanguage)}</span>
                  <h2>{detailCredential.title}</h2>
                </div>
                <button className="iconButton" onClick={() => setDetailCredentialId(null)}>
                  ×
                </button>
              </div>

              {getCredentialTags(detailCredential).length > 0 && (
                <div className="detailTagList">
                  <span>{t("detail.tags")}</span>
                  <div className="credentialTags">
                    {getCredentialTags(detailCredential).map((tag) => (
                      <button
                        type="button"
                        key={tag}
                        className="tagPill interactive"
                        onClick={() => {
                          setActiveTagFilter(tag);
                          setDetailCredentialId(null);
                          setScreen("credentials");
                        }}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {itemType === "credential" && (
                <div className="detailGrid">
                  <div>
                    <span>{t("detail.user")}</span>
                    <strong>{detailCredential.username || "—"}</strong>
                  </div>

                  <div>
                    <span>{t("detail.password")}</span>
                    <strong>
                      {visiblePasswords[detailCredential.id]
                        ? detailCredential.password
                        : maskPassword(detailCredential.password)}
                    </strong>
                  </div>

                  <div>
                    <span>{t("detail.site")}</span>
                    <strong>{detailCredential.url || "—"}</strong>
                  </div>

                  <div>
                    <span>{t("detail.strength")}</span>
                    <strong>
                      {translatePasswordLabel(getPasswordLabel(getPasswordScore(detailCredential.password)), appLanguage)} ·{" "}
                      {getPasswordScore(detailCredential.password)}%
                    </strong>
                  </div>

                  <div>
                    <span>{t("expiry.changedAt")}</span>
                    <strong>{formatDate(getCredentialPasswordChangedAt(detailCredential), appLanguage)}</strong>
                  </div>

                  <div>
                    <span>{t("expiry.status")}</span>
                    <strong className={getExpiryBadgeClass(getPasswordExpiryInfo(detailCredential).status)}>
                      {getExpiryLabel(detailCredential)}
                    </strong>
                  </div>

                  <div>
                    <span>{t("detail.createdAt")}</span>
                    <strong>{formatDate(detailCredential.createdAt, appLanguage)}</strong>
                  </div>

                  <div>
                    <span>{t("detail.updatedAt")}</span>
                    <strong>{formatDate(detailCredential.updatedAt, appLanguage)}</strong>
                  </div>
                </div>
              )}

              {itemType === "credential" && (() => {
                const issues = getDiagnosticIssuesFor(detailCredential);

                return (
                  <div className={issues.length > 0 ? "credentialDiagnosisBox attention" : "credentialDiagnosisBox safe"}>
                    <div>
                      <strong>{t("diagnostic.itemTitle")}</strong>
                      <span>{issues.length > 0 ? t("diagnostic.itemAttention") : t("diagnostic.itemSafe")}</span>
                    </div>

                    {issues.length > 0 ? (
                      <div className="credentialDiagnosisList">
                        {issues.map((issue) => (
                          <span key={issue} className={`diagnosticMiniBadge issue-${issue}`}>
                            {getDiagnosticLabel(issue)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="diagnosticMiniBadge issue-safe">{t("diagnostic.ok")}</span>
                    )}
                  </div>
                );
              })()}

              {itemType === "credential" && (
                <div className={detailCredential.totpSecret ? "totpBox" : "totpBox empty"}>
                  {detailCredential.totpSecret ? (
                    <>
                      <div>
                        <span>{t("totp.title")}</span>
                        <strong>{detailTotpCode || "------"}</strong>
                        <small>{t("totp.remaining", { seconds: getTotpRemainingSeconds(totpTick) })}</small>
                        {detailCredential.totpIssuer && <small>{t("totp.issuer")}: {detailCredential.totpIssuer}</small>}
                      </div>
                      <div className="totpBoxActions">
                        <button
                          type="button"
                          className="secondaryButton"
                          disabled={!detailTotpCode}
                          onClick={() => void copySecure(detailTotpCode, `totp-${detailCredential.id}`)}
                        >
                          {copiedField === `totp-${detailCredential.id}` ? t("credential.copied") : t("totp.copy")}
                        </button>
                        <button type="button" className="secondaryButton" onClick={() => openCredentialTotpSetup(detailCredential)}>
                          {t("totp.easy.change")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span>{t("totp.title")}</span>
                        <strong className="totpEmptyTitle">{t("totp.easy.notConfigured")}</strong>
                        <small>{t("totp.easy.detailHint")}</small>
                      </div>
                      <button type="button" className="secondaryButton" onClick={() => openCredentialTotpSetup(detailCredential)}>
                        {t("totp.easy.add")}
                      </button>
                    </>
                  )}
                </div>
              )}

              {itemType === "secure_note" && (
                <div className="detailGrid">
                  <div>
                    <span>{t("item.type")}</span>
                    <strong>{getItemTypeLabel(itemType, appLanguage)}</strong>
                  </div>
                  <div>
                    <span>{t("detail.createdAt")}</span>
                    <strong>{formatDate(detailCredential.createdAt, appLanguage)}</strong>
                  </div>
                  <div>
                    <span>{t("detail.updatedAt")}</span>
                    <strong>{formatDate(detailCredential.updatedAt, appLanguage)}</strong>
                  </div>
                  <div>
                    <span>{t("detail.category")}</span>
                    <strong>{getCategoryLabel(detailCredential.category, appLanguage)}</strong>
                  </div>
                </div>
              )}

              {itemType === "card" && (
                <div className="detailGrid">
                  <div>
                    <span>{t("card.holder")}</span>
                    <strong>{detailCredential.cardholderName || "—"}</strong>
                  </div>
                  <div>
                    <span>{t("card.number")}</span>
                    <strong>{visiblePasswords[`card-${detailCredential.id}`] ? detailCredential.cardNumber || "—" : maskGenericSecret(detailCredential.cardNumber)}</strong>
                  </div>
                  <div>
                    <span>{t("card.expiry")}</span>
                    <strong>{detailCredential.cardExpiry || "—"}</strong>
                  </div>
                  <div>
                    <span>{t("card.cvv")}</span>
                    <strong>{visiblePasswords[`card-${detailCredential.id}`] ? detailCredential.cardCvv || "—" : maskGenericSecret(detailCredential.cardCvv)}</strong>
                  </div>
                  <div>
                    <span>{t("card.issuer")}</span>
                    <strong>{detailCredential.cardIssuer || "—"}</strong>
                  </div>
                  <div>
                    <span>{t("detail.updatedAt")}</span>
                    <strong>{formatDate(detailCredential.updatedAt, appLanguage)}</strong>
                  </div>
                </div>
              )}

              {itemType === "identity" && (
                <div className="detailGrid">
                  <div>
                    <span>{t("identity.fullName")}</span>
                    <strong>{detailCredential.identityFullName || "—"}</strong>
                  </div>
                  <div>
                    <span>{t("identity.document")}</span>
                    <strong>{detailCredential.identityDocument || "—"}</strong>
                  </div>
                  <div>
                    <span>{t("identity.email")}</span>
                    <strong>{detailCredential.identityEmail || "—"}</strong>
                  </div>
                  <div>
                    <span>{t("identity.phone")}</span>
                    <strong>{detailCredential.identityPhone || "—"}</strong>
                  </div>
                  <div className="full">
                    <span>{t("identity.address")}</span>
                    <strong>{detailCredential.identityAddress || "—"}</strong>
                  </div>
                </div>
              )}

              {itemType === "license" && (
                <div className="detailGrid">
                  <div>
                    <span>{t("license.product")}</span>
                    <strong>{detailCredential.licenseProduct || "—"}</strong>
                  </div>
                  <div>
                    <span>{t("license.key")}</span>
                    <strong>{visiblePasswords[`license-${detailCredential.id}`] ? detailCredential.licenseKey || "—" : maskGenericSecret(detailCredential.licenseKey)}</strong>
                  </div>
                  <div>
                    <span>{t("license.owner")}</span>
                    <strong>{detailCredential.licenseOwner || "—"}</strong>
                  </div>
                  <div>
                    <span>{t("license.expiresAt")}</span>
                    <strong>{detailCredential.licenseExpiresAt || "—"}</strong>
                  </div>
                </div>
              )}

              <div className="notesBox">
                <span>{itemType === "secure_note" ? t("note.content") : t("detail.notes")}</span>
                <p>{detailCredential.notes || t("detail.noNotes")}</p>
              </div>

              <div className="attachmentsBox">
                <div className="cardTitleRow">
                  <div>
                    <h3>{t("attachments.title")}</h3>
                    <p>{t("attachments.description")}</p>
                  </div>
                  <label className="fileImportButton inlineFileButton compactFileButton">
                    {t("attachments.add")}
                    <input
                      type="file"
                      onChange={(event) => {
                        void handleAddAttachment(detailCredential.id, event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>

                <div className="attachmentsList">
                  {getAttachments(detailCredential).map((attachment) => (
                    <article key={attachment.id} className="attachmentItem">
                      <div>
                        <strong>{attachment.name}</strong>
                        <span>
                          {formatBytes(attachment.sizeBytes)} · {attachment.mimeType || "application/octet-stream"} · {formatDate(attachment.createdAt, appLanguage)}
                        </span>
                      </div>
                      <div className="attachmentActions">
                        <button type="button" onClick={() => downloadDataUrl(safeExportFilename(attachment.name), attachment.dataUrl)}>
                          {t("attachments.download")}
                        </button>
                        <button type="button" className="dangerButton" onClick={() => void handleRemoveAttachment(detailCredential.id, attachment.id)}>
                          {t("attachments.remove")}
                        </button>
                      </div>
                    </article>
                  ))}

                  {getAttachments(detailCredential).length === 0 && (
                    <p className="emptyText">{t("attachments.empty")}</p>
                  )}
                </div>
              </div>

              {itemType === "credential" && (
                <div className="historyBox">
                  <div className="cardTitleRow">
                    <div>
                      <h3>{t("history.title")}</h3>
                      <p>{t("history.description")}</p>
                    </div>
                    <button
                      className="dangerButton"
                      disabled={historyEntries.length === 0}
                      onClick={() => void handleClearPasswordHistory(detailCredential.id)}
                    >
                      {t("history.clear")}
                    </button>
                  </div>

                  <div className="historyList">
                    {historyEntries.map((entry) => (
                      <article key={entry.id} className="historyItem">
                        <div>
                          <strong>
                            {visibleHistoryPasswords[entry.id] ? entry.password : maskPassword(entry.password)}
                          </strong>
                          <span>
                            {t("history.savedAt")} {formatDate(entry.savedAt, appLanguage)} · {t("history.changedAt")} {formatDate(entry.changedAt, appLanguage)}
                          </span>
                        </div>
                        <div className="historyActions">
                          <button
                            type="button"
                            onClick={() =>
                              setVisibleHistoryPasswords((current) => ({
                                ...current,
                                [entry.id]: !current[entry.id],
                              }))
                            }
                          >
                            {visibleHistoryPasswords[entry.id] ? t("credential.hidePassword") : t("credential.showPassword")}
                          </button>
                          <button type="button" onClick={() => void copySecure(entry.password, `history-${entry.id}`)}>
                            {copiedField === `history-${entry.id}` ? t("credential.copiedFemale") : t("credential.copyPassword")}
                          </button>
                          <button type="button" onClick={() => void handleRestorePasswordFromHistory(detailCredential.id, entry.id)}>
                            {t("history.restore")}
                          </button>
                        </div>
                      </article>
                    ))}

                    {historyEntries.length === 0 && <p className="emptyText">{t("history.empty")}</p>}
                  </div>
                </div>
              )}

              <div className="detailActions">
                {itemType === "credential" && detailCredential.username && (
                  <button onClick={() => void copySecure(detailCredential.username, `user-${detailCredential.id}`)}>
                    {copiedField === `user-${detailCredential.id}` ? t("credential.userCopied") : t("credential.copyUser")}
                  </button>
                )}

                {primarySecret && (
                  <button onClick={() => void copySecure(primarySecret, `secret-${detailCredential.id}`)}>
                    {copiedField === `secret-${detailCredential.id}` ? t("credential.copiedFemale") : t(itemType === "credential" ? "credential.copyPassword" : "item.copySecret")}
                  </button>
                )}

                {(itemType === "credential" || itemType === "card" || itemType === "license") && (
                  <button
                    onClick={() =>
                      setVisiblePasswords((current) => ({
                        ...current,
                        [itemType === "card" ? `card-${detailCredential.id}` : itemType === "license" ? `license-${detailCredential.id}` : detailCredential.id]:
                          !current[itemType === "card" ? `card-${detailCredential.id}` : itemType === "license" ? `license-${detailCredential.id}` : detailCredential.id],
                      }))
                    }
                  >
                    {visiblePasswords[itemType === "card" ? `card-${detailCredential.id}` : itemType === "license" ? `license-${detailCredential.id}` : detailCredential.id]
                      ? t("credential.hidePassword")
                      : t("credential.showPassword")}
                  </button>
                )}

                {detailCredential.url && (
                  <button
                    onClick={() => void openExternalUrl(detailCredential.url).catch((error) => {
                      console.error(error);
                      setMessage(t("credential.openSiteError"));
                    })}
                  >
                    {t("credential.openSite")}
                  </button>
                )}

                <button onClick={() => openEditCredentialForm(detailCredential)}>{t("credential.edit")}</button>

                <button
                  className="dangerButton"
                  onClick={() => void handleDeleteCredential(detailCredential.id)}
                >
                  {t("credential.delete")}
                </button>
              </div>
            </aside>
          </div>
        );
      })()}

      {formOpen && (
        <div className="modalOverlay" onMouseDown={() => setFormOpen(false)}>
          <form className="credentialModal" onSubmit={handleSaveCredential} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{editingId ? t("form.editing") : t("form.new")}</p>
                <h2>{editingId ? t("form.editItem") : t("form.addItem")}</h2>
              </div>
              <button type="button" className="iconButton" onClick={() => setFormOpen(false)}>
                ×
              </button>
            </div>

            <div className="itemTypeSwitch full">
              {ITEM_TYPES.map((itemType) => (
                <button
                  type="button"
                  key={itemType}
                  className={(credentialForm.itemType ?? "credential") === itemType ? "itemTypeButton active" : "itemTypeButton"}
                  onClick={() =>
                    setCredentialForm((current) => ({
                      ...getEmptyCredential(),
                      itemType,
                      title: current.title,
                      category: current.category,
                      tags: normalizeCredentialTags(credentialTagsInput),
                      favorite: current.favorite,
                    }))
                  }
                >
                  <span>{getItemTypeIcon(itemType)}</span>
                  <strong>{getItemTypeLabel(itemType, appLanguage)}</strong>
                </button>
              ))}
            </div>

            <div className="formGrid">
              <label>
                {t("form.name")}
                <input
                  value={credentialForm.title}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder={t("form.namePlaceholder")}
                  autoFocus
                />
              </label>

              <label>
                {t("form.category")}
                <select
                  value={credentialForm.category}
                  onChange={(event) =>
                    setCredentialForm((current) => ({
                      ...current,
                      category: event.target.value as CredentialCategory,
                    }))
                  }
                >
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>{getCategoryLabel(category, appLanguage)}</option>
                  ))}
                </select>
              </label>

              <label className="full">
                {t("tags.input")}
                <input
                  value={credentialTagsInput}
                  onChange={(event) => {
                    setCredentialTagsInput(event.target.value);
                    setCredentialForm((current) => ({
                      ...current,
                      tags: normalizeCredentialTags(event.target.value),
                    }));
                  }}
                  placeholder={t("tags.placeholder")}
                />
                <small className="tagInputHint">{t("tags.hint")}</small>
              </label>

              {(credentialForm.itemType ?? "credential") === "credential" && (
                <>
                  <label>
                    {t("form.userEmail")}
                    <input
                      value={credentialForm.username}
                      onChange={(event) =>
                        setCredentialForm((current) => ({ ...current, username: event.target.value }))
                      }
                      placeholder="usuario@email.com"
                    />
                  </label>

                  <label>
                    {t("form.site")}
                    <input
                      value={credentialForm.url}
                      onChange={(event) =>
                        setCredentialForm((current) => ({ ...current, url: event.target.value }))
                      }
                      placeholder="https://..."
                    />
                  </label>

                  <div className="totpEasyCard full">
                    <div>
                      <span className="eyebrow">{t("totp.easy.eyebrow")}</span>
                      <strong>{credentialForm.totpSecret ? t("totp.easy.configured") : t("totp.easy.notConfigured")}</strong>
                      <p>{credentialForm.totpSecret ? t("totp.easy.configuredDescription", { issuer: credentialForm.totpIssuer || credentialForm.title || t("totp.easy.genericIssuer") }) : t("totp.easy.description")}</p>
                    </div>
                    <div className="totpEasyActions">
                      <button type="button" className="secondaryButton" onClick={() => openTotpSetup("choice")}>
                        {credentialForm.totpSecret ? t("totp.easy.change") : t("totp.easy.add")}
                      </button>
                      {credentialForm.totpSecret && (
                        <button type="button" className="dangerButton ghost" onClick={() => void clearTotpFromForm()}>
                          {t("totp.easy.remove")}
                        </button>
                      )}
                    </div>
                  </div>

                  <label>
                    {t("expiry.expiresIn")}
                    <select
                      value={credentialForm.passwordExpiresInDays ?? 0}
                      onChange={(event) =>
                        setCredentialForm((current) => ({
                          ...current,
                          passwordExpiresInDays: Number(event.target.value),
                        }))
                      }
                    >
                      {PASSWORD_EXPIRY_OPTIONS.map((days) => (
                        <option key={days} value={days}>
                          {days === 0 ? t("expiry.never") : t("expiry.days", { days })}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    {t("expiry.noticeDays")}
                    <select
                      value={credentialForm.passwordExpiryNoticeDays ?? 15}
                      onChange={(event) =>
                        setCredentialForm((current) => ({
                          ...current,
                          passwordExpiryNoticeDays: Number(event.target.value),
                        }))
                      }
                    >
                      {PASSWORD_NOTICE_OPTIONS.map((days) => (
                        <option key={days} value={days}>
                          {t("expiry.daysBefore", { days })}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="full">
                    {t("form.password")}
                    <div className="passwordInput">
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={credentialForm.password}
                        onChange={(event) =>
                          setCredentialForm((current) => ({
                            ...current,
                            password: event.target.value,
                          }))
                        }
                        placeholder={t("form.passwordPlaceholder")}
                      />
                      <button type="button" onClick={generateCredentialPassword}>
                        {t("form.generateStrong")}
                      </button>
                    </div>
                    <span className="strength">
                      {t("form.strength", { label: translatePasswordLabel(getPasswordLabel(score), appLanguage), score })}
                    </span>

                    <div className="generatorPanel">
                      <label>
                        {t("generator.mode")}
                        <select
                          value={generatorMode}
                          onChange={(event) => setGeneratorMode(event.target.value as PasswordGeneratorMode)}
                        >
                          <option value="random">{t("generator.random")}</option>
                          <option value="memorable">{t("generator.memorable")}</option>
                          <option value="pin">{t("generator.pin")}</option>
                        </select>
                      </label>

                      <label>
                        {generatorMode === "pin" ? t("generator.pinLength") : t("generator.length")}
                        <input
                          type="number"
                          min={generatorMode === "pin" ? 4 : 8}
                          max={generatorMode === "pin" ? 16 : 96}
                          value={generatorLength}
                          onChange={(event) => setGeneratorLength(Number(event.target.value))}
                        />
                      </label>

                      {generatorMode === "random" && (
                        <div className="generatorOptions">
                          <label>
                            <input
                              type="checkbox"
                              checked={generatorLowercase}
                              onChange={(event) => setGeneratorLowercase(event.target.checked)}
                            />
                            {t("generator.lowercase")}
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={generatorUppercase}
                              onChange={(event) => setGeneratorUppercase(event.target.checked)}
                            />
                            {t("generator.uppercase")}
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={generatorNumbers}
                              onChange={(event) => setGeneratorNumbers(event.target.checked)}
                            />
                            {t("generator.numbers")}
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={generatorSymbols}
                              onChange={(event) => setGeneratorSymbols(event.target.checked)}
                            />
                            {t("generator.symbols")}
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={generatorAvoidAmbiguous}
                              onChange={(event) => setGeneratorAvoidAmbiguous(event.target.checked)}
                            />
                            {t("generator.avoidAmbiguous")}
                          </label>
                        </div>
                      )}
                    </div>
                  </label>
                </>
              )}

              {(credentialForm.itemType ?? "credential") === "card" && (
                <>
                  <label>
                    {t("card.holder")}
                    <input
                      value={credentialForm.cardholderName ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, cardholderName: event.target.value }))}
                      placeholder={t("card.holderPlaceholder")}
                    />
                  </label>
                  <label>
                    {t("card.issuer")}
                    <input
                      value={credentialForm.cardIssuer ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, cardIssuer: event.target.value }))}
                      placeholder={t("card.issuerPlaceholder")}
                    />
                  </label>
                  <label>
                    {t("card.number")}
                    <input
                      value={credentialForm.cardNumber ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, cardNumber: event.target.value }))}
                      placeholder="0000 0000 0000 0000"
                    />
                  </label>
                  <label>
                    {t("card.expiry")}
                    <input
                      value={credentialForm.cardExpiry ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, cardExpiry: event.target.value }))}
                      placeholder="MM/AA"
                    />
                  </label>
                  <label>
                    {t("card.cvv")}
                    <input
                      value={credentialForm.cardCvv ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, cardCvv: event.target.value }))}
                      placeholder="***"
                    />
                  </label>
                </>
              )}

              {(credentialForm.itemType ?? "credential") === "identity" && (
                <>
                  <label>
                    {t("identity.fullName")}
                    <input
                      value={credentialForm.identityFullName ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, identityFullName: event.target.value }))}
                      placeholder={t("identity.fullNamePlaceholder")}
                    />
                  </label>
                  <label>
                    {t("identity.document")}
                    <input
                      value={credentialForm.identityDocument ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, identityDocument: event.target.value }))}
                      placeholder={t("identity.documentPlaceholder")}
                    />
                  </label>
                  <label>
                    {t("identity.email")}
                    <input
                      value={credentialForm.identityEmail ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, identityEmail: event.target.value }))}
                      placeholder="email@exemplo.com"
                    />
                  </label>
                  <label>
                    {t("identity.phone")}
                    <input
                      value={credentialForm.identityPhone ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, identityPhone: event.target.value }))}
                      placeholder={t("identity.phonePlaceholder")}
                    />
                  </label>
                  <label className="full">
                    {t("identity.address")}
                    <textarea
                      value={credentialForm.identityAddress ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, identityAddress: event.target.value }))}
                      placeholder={t("identity.addressPlaceholder")}
                    />
                  </label>
                </>
              )}

              {(credentialForm.itemType ?? "credential") === "license" && (
                <>
                  <label>
                    {t("license.product")}
                    <input
                      value={credentialForm.licenseProduct ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, licenseProduct: event.target.value }))}
                      placeholder={t("license.productPlaceholder")}
                    />
                  </label>
                  <label>
                    {t("license.owner")}
                    <input
                      value={credentialForm.licenseOwner ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, licenseOwner: event.target.value }))}
                      placeholder={t("license.ownerPlaceholder")}
                    />
                  </label>
                  <label className="full">
                    {t("license.key")}
                    <textarea
                      value={credentialForm.licenseKey ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, licenseKey: event.target.value }))}
                      placeholder={t("license.keyPlaceholder")}
                    />
                  </label>
                  <label>
                    {t("license.expiresAt")}
                    <input
                      value={credentialForm.licenseExpiresAt ?? ""}
                      onChange={(event) => setCredentialForm((current) => ({ ...current, licenseExpiresAt: event.target.value }))}
                      placeholder={t("license.expiresAtPlaceholder")}
                    />
                  </label>
                </>
              )}

              <label className="full">
                {(credentialForm.itemType ?? "credential") === "secure_note" ? t("note.content") : t("form.notes")}
                <textarea
                  value={credentialForm.notes}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder={(credentialForm.itemType ?? "credential") === "secure_note" ? t("note.contentPlaceholder") : t("form.notesPlaceholder")}
                />
              </label>

              <label className="checkRow full">
                <input
                  type="checkbox"
                  checked={credentialForm.favorite}
                  onChange={(event) =>
                    setCredentialForm((current) => ({
                      ...current,
                      favorite: event.target.checked,
                    }))
                  }
                />
                {t("form.markFavorite")}
              </label>
            </div>

            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setFormOpen(false)}>
                {t("dialog.cancel")}
              </button>
              <button disabled={busy} className="primaryButton">
                {busy ? t("form.saving") : t("form.saveItem")}
              </button>
            </div>
          </form>
        </div>
      )}

      {totpSetupDialog}
      {csvExportDialog}
      {csvImportDialog}
      {confirmDialogElement}
      {restoreBackupDialog}
    </main>
  );
}
