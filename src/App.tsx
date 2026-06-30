import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  createEmptyVault,
  decryptVault,
  encryptVault,
  parseEncryptedVault,
  validateMasterPassword,
} from "./crypto";
import { generatePassword, getPasswordLabel, getPasswordScore, type PasswordGeneratorMode } from "./password";
import {
  getStorageInfo,
  listBackupFiles,
  loadVaultFile,
  saveVaultFile,
} from "./vault-storage";
import type {
  BackupFile,
  CredentialCategory,
  CredentialRecord,
  PasswordHistoryEntry,
  VaultItemType,
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
  notes: "",
  favorite: false,
  passwordChangedAt: "",
  passwordExpiresInDays: 90,
  passwordExpiryNoticeDays: 15,
  passwordHistory: [],
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
const APP_VERSION = "0.4.0";
const UPDATE_GITHUB_OWNER = "mnstechbr";
const UPDATE_GITHUB_REPO = "KPassword";
const PASSWORD_ROTATION_DAYS = 30;

type Screen = "credentials" | "dashboard" | "trash" | "settings" | "preferences";

const ITEM_TYPES: VaultItemType[] = ["credential", "secure_note", "card", "identity", "license"];

type AppTheme = "dark" | "light" | "mixed";
type FontScale = "normal" | "large";

const PASSWORD_EXPIRY_OPTIONS = [0, 30, 60, 90, 180, 365];
const PASSWORD_NOTICE_OPTIONS = [7, 15, 30, 60];

type PasswordExpiryStatus = "never" | "valid" | "soon" | "expired";

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
  return { ...EMPTY_FORM };
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();

  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
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

function AppLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`appLogo ${size}`} aria-hidden="true">
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
  return (
    <label className={compact ? "languageSelect compact" : "languageSelect"}>
      <span>{compact ? "🌐" : label}</span>
      <select
        value={language}
        aria-label={label}
        onChange={(event) => onChange(event.target.value as AppLanguage)}
      >
        {LANGUAGES.map((item) => (
          <option key={item.code} value={item.code}>
            {compact ? item.shortLabel : item.label}
          </option>
        ))}
      </select>
    </label>
  );
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
      autoLockMinutes: vault.settings?.autoLockMinutes ?? 3,
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
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailCredentialId, setDetailCredentialId] = useState<string | null>(null);
  const [credentialForm, setCredentialForm] = useState(getEmptyCredential);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [showStoragePaths, setShowStoragePaths] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [visibleHistoryPasswords, setVisibleHistoryPasswords] = useState<Record<string, boolean>>({});
  const [copiedField, setCopiedField] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [currentMasterPassword, setCurrentMasterPassword] = useState("");
  const [newMasterPassword, setNewMasterPassword] = useState("");
  const [newMasterConfirm, setNewMasterConfirm] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [restorePopupOpen, setRestorePopupOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(getInitialLanguage);
  const [generatorMode, setGeneratorMode] = useState<PasswordGeneratorMode>("random");
  const [generatorLength, setGeneratorLength] = useState(24);
  const [generatorLowercase, setGeneratorLowercase] = useState(true);
  const [generatorUppercase, setGeneratorUppercase] = useState(true);
  const [generatorNumbers, setGeneratorNumbers] = useState(true);
  const [generatorSymbols, setGeneratorSymbols] = useState(true);
  const [generatorAvoidAmbiguous, setGeneratorAvoidAmbiguous] = useState(true);

  const t = useCallback(
    (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
      translate(appLanguage, key, values),
    [appLanguage],
  );


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
    if (!vault) return;

    localStorage.setItem("kpassword:auto-lock-minutes", String(vault.settings.autoLockMinutes ?? 3));
    localStorage.setItem("kpassword:lock-on-minimize", String(vault.settings.lockOnMinimize ?? true));
    localStorage.setItem("kpassword:lock-on-close", String(vault.settings.lockOnClose ?? true));
    localStorage.setItem("kpassword:lock-on-inactive", String(vault.settings.lockOnInactive ?? true));
    localStorage.setItem("kpassword:tray-notifications", String(vault.settings.notifyOnTray ?? true));
    localStorage.setItem("kpassword:tray-sound", String(vault.settings.soundOnTray ?? true));
    localStorage.setItem("kpassword:clipboard-clear-seconds", String(vault.settings.clipboardClearSeconds ?? CLIPBOARD_CLEAR_SECONDS));
  }, [vault]);

  const refreshStorageInfo = useCallback(async () => {
    try {
      const [info, backupFiles] = await Promise.all([getStorageInfo(), listBackupFiles()]);
      setStorageInfo(info);
      setBackups(backupFiles);
    } catch (error) {
      console.error("Erro ao carregar informações de armazenamento:", error);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setMessage("");
        const raw = await loadVaultFile();

        if (!raw) {
          setMode("setup");
          await refreshStorageInfo();
          return;
        }

        setEncryptedVault(parseEncryptedVault(raw));
        setMode("locked");
        await refreshStorageInfo();
      } catch (error) {
        console.error(error);
        setMessage(t("errors.loadVault"));
        setMode("setup");
      }
    })();
  }, [refreshStorageInfo]);

  const lockVault = useCallback(() => {
    setVault(null);
    setMasterPassword("");
    setUnlockPassword("");
    setSetupPassword("");
    setConfirmPassword("");
    setVisiblePasswords({});
    setVisibleHistoryPasswords({});
    setDetailCredentialId(null);
    setMessage("");
    setMode((current) => (current === "setup" ? "setup" : "locked"));
  }, []);

  useEffect(() => {
    const handler = () => lockVault();

    window.addEventListener("kpassword:lock", handler);

    return () => window.removeEventListener("kpassword:lock", handler);
  }, [lockVault]);

  const persistVault = useCallback(
    async (nextVault: PlainVault, passwordOverride?: string) => {
      const password = passwordOverride ?? masterPassword;

      if (!password) {
        throw new Error(t("errors.masterPasswordUnavailable"));
      }

      const file = await encryptVault(nextVault, password, encryptedVault);
      const info = await saveVaultFile(JSON.stringify(file, null, 2));

      setEncryptedVault(file);
      setVault({
        ...nextVault,
        updatedAt: file.updatedAt,
      });
      setStorageInfo(info);
      setBackups(info.backups);

      return file;
    },
    [encryptedVault, masterPassword],
  );

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
      const info = await saveVaultFile(JSON.stringify(file, null, 2));

      setEncryptedVault(file);
      setVault(newVault);
      setMasterPassword(setupPassword);
      setSetupPassword("");
      setConfirmPassword("");
      setStorageInfo(info);
      setBackups(info.backups);
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

    if (!encryptedVault) {
      setMode("setup");
      return;
    }

    setBusy(true);

    try {
      const plainVault = normalizeVault(await decryptVault(encryptedVault, unlockPassword));

      setVault(plainVault);
      setMasterPassword(unlockPassword);
      setUnlockPassword("");
      setScreen("credentials");
      setMode("unlocked");
      setMessage("");
      await refreshStorageInfo();
      void maybeShowPasswordRotationReminder(plainVault);
      void maybeShowPasswordExpiryReminder(plainVault);
    } catch (error) {
      console.error(error);
      setMessage(t("errors.unlock"));
    } finally {
      setBusy(false);
    }
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
      const info = await saveVaultFile(JSON.stringify(file, null, 2));

      setEncryptedVault(file);
      setVault({ ...nextVault, updatedAt: file.updatedAt });
      setMasterPassword(newMasterPassword);
      setCurrentMasterPassword("");
      setNewMasterPassword("");
      setNewMasterConfirm("");
      setStorageInfo(info);
      setBackups(info.backups);
      setMessage(t("success.masterPasswordChanged"));
    } catch (error) {
      console.error(error);
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
      const parsed = parseEncryptedVault(raw);
      const restoredVault = normalizeVault(await decryptVault(parsed, password));

      const confirmed = await askConfirmation({
        title: t("dialog.restoreBackupTitle"),
        message:
          t("dialog.restoreBackupMessage"),
        confirmText: t("dialog.restoreBackupTitle"),
        cancelText: t("dialog.cancel"),
        tone: "danger",
      });

      if (!confirmed) return;

      const info = await saveVaultFile(raw);

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
    } catch (error) {
      console.error(error);
      setMessage(t("errors.restoreBackup"));
    }
  }

  async function handleBackupFileInput(file: File | undefined | null, password: string) {
    if (!file) return;

    const raw = await file.text();
    await restoreBackupFromText(raw, password);
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
  }  async function updateVaultSettings(nextSettings: Partial<PlainVault["settings"]>) {
    if (!vault) return;

    const nextVault = normalizeVault({
      ...vault,
      settings: {
        ...vault.settings,
        ...nextSettings,
      },
      updatedAt: new Date().toISOString(),
    });

    try {
      await persistVault(nextVault);
      setMessage(t("success.settingsUpdated"));
    } catch (error) {
      console.error(error);
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
      notes: credential.notes ?? "",
      favorite: credential.favorite,
      passwordChangedAt: getCredentialPasswordChangedAt(credential),
      passwordExpiresInDays: credential.passwordExpiresInDays ?? 0,
      passwordExpiryNoticeDays: credential.passwordExpiryNoticeDays ?? 15,
      passwordHistory: getPasswordHistory(credential),
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
    setFormOpen(true);
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

    const cleanForm = {
      ...credentialForm,
      itemType,
      title: credentialForm.title.trim(),
      username: itemType === "credential" ? credentialForm.username.trim() : "",
      password: itemType === "credential" ? credentialForm.password : "",
      url: itemType === "credential" ? normalizeUrl(credentialForm.url) : "",
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

    await navigator.clipboard.writeText(value);
    setCopiedField(label);

    window.setTimeout(async () => {
      try {
        const current = await navigator.clipboard.readText();

        if (current === value) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        try {
          await navigator.clipboard.writeText("");
        } catch {
          // Ignora falha de limpeza em ambiente sem permissão de clipboard.
        }
      }

      setCopiedField("");
    }, (vault?.settings.clipboardClearSeconds ?? CLIPBOARD_CLEAR_SECONDS) * 1000);
  }

  const filteredCredentials = useMemo(() => {
    if (!vault) return [];

    const terms = search
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    return getOrderedCredentials(getActiveCredentials(vault.credentials)).filter((credential) => {
      if (terms.length === 0) return true;

      const searchable = [
        credential.title,
        credential.username,
        credential.url,
        credential.category,
        credential.notes,
        credential.password,
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
        credential.favorite ? "favorito favorita estrela" : "",
      ]
        .join(" ")
        .toLowerCase();

      return terms.every((term) => searchable.includes(term));
    });
  }, [appLanguage, search, vault]);

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
      repeatedPasswords.set(
        credential.password,
        (repeatedPasswords.get(credential.password) ?? 0) + 1,
      );
    });

    const weak = credentialItems.filter(
      (credential) => getPasswordScore(credential.password) < 60,
    ).length;
    const repeated = credentialItems.filter(
      (credential) => (repeatedPasswords.get(credential.password) ?? 0) > 1,
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
  const repeatedPasswordCounts = new Map<string, number>();
  credentialItems.forEach((credential) => {
    repeatedPasswordCounts.set(credential.password, (repeatedPasswordCounts.get(credential.password) ?? 0) + 1);
  });
  const repeatedCredentials = credentialItems.filter(
    (credential) => (repeatedPasswordCounts.get(credential.password) ?? 0) > 1,
  );
  const incompleteCredentials = credentialItems.filter(
    (credential) => !credential.url || !credential.username || !credential.category,
  );

  const canReorderCredentials = search.trim().length === 0;
  const masterIssues = validateMasterPassword(setupPassword);
  const score = getPasswordScore(credentialForm.password);

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

  if (mode === "loading") {
    return (
      <>
        <main className="authShell">
          <section className="authCard">
            <div className="authLanguageRow">
              <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} compact />
            </div>
            <AppLogo size="lg" />
            <h1>KPassword</h1>
            <p>{t("status.loadingVault")}</p>
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
        <main className="authShell">
          <section className="authCard">
            <div className="authLanguageRow">
              <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} compact />
            </div>
            <AppLogo size="lg" />
            <p className="eyebrow">{t("auth.firstAccess")}</p>
            <h1>{t("auth.createMasterTitle")}</h1>
            <p>{t("auth.createMasterDescription")}</p>

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

            <button
              type="button"
              className="authTextButton"
              onClick={() => setRestorePopupOpen(true)}
            >
              {t("auth.restoreBackup")}
            </button>
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
        <main className="authShell">
          <section className="authCard">
            <div className="authLanguageRow">
              <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} compact />
            </div>
            <AppLogo size="lg" />
            <p className="eyebrow">{t("auth.vaultLocked")}</p>
            <h1>{t("auth.unlockTitle")}</h1>
            <p>{t("auth.unlockDescription")}</p>

            <form onSubmit={handleUnlock} className="authForm">
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
            </form>

            <button
              type="button"
              className="authTextButton"
              onClick={() => setRestorePopupOpen(true)}
            >
              {t("auth.restoreBackup")}
            </button>
          </section>
        </main>
        {confirmDialogElement}
        {restoreBackupDialog}
      </>
    );
  }

  return (
    <main className={sidebarExpanded ? "appShell sidebarOpen" : "appShell sidebarClosed"}>
      <aside className="sidebar">
        <div className="sidebarBrand">
          <button
            className="sidebarToggle"
            onClick={() => setSidebarExpanded((current) => !current)}
            title={sidebarExpanded ? t("nav.closeSidebar") : t("nav.openSidebar")}
            aria-label={sidebarExpanded ? t("nav.closeSidebar") : t("nav.openSidebar")}
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
                {screen === "credentials" && t("nav.items")}
                {screen === "dashboard" && t("topbar.vaultDashboard")}
                {screen === "trash" && t("nav.trash")}
                {screen === "settings" && t("nav.securityBackup")}
                {screen === "preferences" && t("nav.preferences")}
              </h1>
            </div>
          </div>

          <div className="topbarActions">
            <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} compact />
            {screen !== "trash" && (
              <button className="primaryButton" onClick={openNewCredentialForm}>
                {t("topbar.addItem")}
              </button>
            )}
          </div>
        </header>

        {message && <div className="message success">{message}</div>}

        {screen === "credentials" && (
          <>
            <div className="toolbar">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("search.placeholder")}
              />
              <span>{t("search.results", { count: filteredCredentials.length })}</span>
            </div>

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
          <div className="dashboardGrid">
            <article className="metricCard">
              <span>{t("dashboard.total")}</span>
              <strong>{stats.total}</strong>
              <small>{t("dashboard.savedItems")}</small>
            </article>
            <article className="metricCard">
              <span>{t("itemType.credential")}</span>
              <strong>{stats.credentialItems}</strong>
              <small>{t("dashboard.credentialsOnly")}</small>
            </article>
            <article className="metricCard">
              <span>{t("itemType.secure_note")}</span>
              <strong>{stats.secureNotes}</strong>
              <small>{t("dashboard.secureNotes")}</small>
            </article>
            <article className="metricCard">
              <span>{t("itemType.card")}</span>
              <strong>{stats.cards}</strong>
              <small>{t("dashboard.cards")}</small>
            </article>
            <article className="metricCard">
              <span>{t("dashboard.favorites")}</span>
              <strong>{stats.favorites}</strong>
              <small>{t("dashboard.quickAccess")}</small>
            </article>
            <article className={stats.expired > 0 ? "metricCard danger" : "metricCard"}>
              <span>{t("dashboard.expired")}</span>
              <strong>{stats.expired}</strong>
              <small>{t("dashboard.expiredDescription")}</small>
            </article>
            <article className={stats.expiringSoon > 0 ? "metricCard warning" : "metricCard"}>
              <span>{t("dashboard.expiringSoon")}</span>
              <strong>{stats.expiringSoon}</strong>
              <small>{t("dashboard.expiringSoonDescription")}</small>
            </article>
            <article className={stats.weak > 0 ? "metricCard warning" : "metricCard"}>
              <span>{t("dashboard.weak")}</span>
              <strong>{stats.weak}</strong>
              <small>{t("dashboard.reviewNeeded")}</small>
            </article>
            <article className={stats.repeated > 0 ? "metricCard warning" : "metricCard"}>
              <span>{t("dashboard.repeated")}</span>
              <strong>{stats.repeated}</strong>
              <small>{t("dashboard.reuseRisk")}</small>
            </article>
            <article className={stats.oldPasswords > 0 ? "metricCard warning" : "metricCard"}>
              <span>{t("dashboard.oldPasswords")}</span>
              <strong>{stats.oldPasswords}</strong>
              <small>{t("dashboard.oldPasswordsDescription")}</small>
            </article>
            <article className={stats.deleted > 0 ? "metricCard" : "metricCard"}>
              <span>{t("nav.trash")}</span>
              <strong>{stats.deleted}</strong>
              <small>{t("trash.items")}</small>
            </article>

            <article className="wideCard">
              <h2>{t("dashboard.securityHealth")}</h2>
              <div className="securityGrid">
                <span>{t("dashboard.weakCount", { count: stats.weak })}</span>
                <span>{t("dashboard.repeatedCount", { count: stats.repeated })}</span>
                <span>{t("dashboard.expiredCount", { count: stats.expired })}</span>
                <span>{t("dashboard.expiringSoonCount", { count: stats.expiringSoon })}</span>
                <span>{t("dashboard.missingUrlCount", { count: stats.missingUrl })}</span>
                <span>{t("dashboard.missingUserCount", { count: stats.missingUser })}</span>
                <span>{t("dashboard.oldPasswordCount", { count: stats.oldPasswords })}</span>
                <span>{t("dashboard.deletedCount", { count: stats.deleted })}</span>
              </div>
            </article>

            <article className="wideCard">
              <h2>{t("dashboard.attentionList")}</h2>
              <div className="miniList">
                {[...expiredCredentials, ...expiringSoonCredentials, ...weakCredentials, ...repeatedCredentials, ...incompleteCredentials]
                  .filter((credential, index, list) => list.findIndex((item) => item.id === credential.id) === index)
                  .slice(0, 8)
                  .map((credential) => (
                    <button
                      key={credential.id}
                      onClick={() => {
                        setDetailCredentialId(credential.id);
                        setScreen("credentials");
                      }}
                    >
                      <strong>{credential.title}</strong>
                      <span>{getExpiryLabel(credential)} · {translatePasswordLabel(getPasswordLabel(getPasswordScore(credential.password)), appLanguage)}</span>
                    </button>
                  ))}

                {expiredCredentials.length === 0 &&
                  expiringSoonCredentials.length === 0 &&
                  weakCredentials.length === 0 &&
                  repeatedCredentials.length === 0 &&
                  incompleteCredentials.length === 0 && (
                    <p className="emptyText">{t("dashboard.noAttentionItems")}</p>
                  )}
              </div>
            </article>

            <article className="wideCard">
              <h2>{t("dashboard.protectionTitle")}</h2>
              <div className="securityGrid">
                <span>{t("security.aes")}</span>
                <span>{t("security.pbkdf2")}</span>
                <span>{t("security.salt")}</span>
                <span>{t("security.iv")}</span>
                <span>{t("security.encryptedBackups")}</span>
                <span>{t("security.autolock")}</span>
                <span>{t("security.clipboard")}</span>
                <span>{t("security.offline")}</span>
              </div>
            </article>
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
            </article>

            <article className="wideCard">
              <h2>{t("settings.autoBackups")}</h2>
              <p>{t("settings.autoBackupsDescription")}</p>

              <div className="backupList">
                {backups.slice(0, 8).map((backup) => (
                  <div key={backup.filename}>
                    <strong>{backup.filename}</strong>
                    <span>
                      {formatDate(backup.modified_epoch_ms)} · {(backup.size_bytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ))}

                {backups.length === 0 && <p className="emptyText">{t("settings.noBackups")}</p>}
              </div>

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

                    void persistVault(vault)
                      .then(() => refreshStorageInfo())
                      .then(() => setMessage("Backup criptografado atualizado."))
                      .catch(() => setMessage("Erro ao criar backup."));
                  });
                }}
              >
                Criar backup agora
              </button>
            </article>

            <article className="wideCard securityActionCard">
              <h2>{t("settings.masterPasswordTitle")}</h2>
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
            </article>

            <article className="wideCard securityActionCard">
              <h2>{t("settings.importBackup")}</h2>
              <p>
                Importe um arquivo .kpvault para restaurar o cofre. O arquivo continua exigindo a senha mestra usada quando o backup foi criado.
              </p>

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
            </article>

            <article className="wideCard securityActionCard">
              <h2>{t("settings.securitySettings")}</h2>
              <p>{t("settings.securitySettingsDescription")}</p>

              <div className="settingsControlGrid">
                <label>
                  {t("settings.autoLockLabel")}
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={vault?.settings.autoLockMinutes ?? 3}
                    onChange={(event) => void updateVaultSettings({ autoLockMinutes: Number(event.target.value) })}
                  />
                </label>

                <label>
                  {t("settings.clipboardLabel")}
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={vault?.settings.clipboardClearSeconds ?? CLIPBOARD_CLEAR_SECONDS}
                    onChange={(event) => void updateVaultSettings({ clipboardClearSeconds: Number(event.target.value) })}
                  />
                </label>

                <label>
                  {t("settings.backupIntervalLabel")}
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={vault?.settings.backupIntervalHours ?? 4}
                    onChange={(event) => void updateVaultSettings({ backupIntervalHours: Number(event.target.value) })}
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
            </article>
          </div>
        )}

        {screen === "preferences" && (
          <div className="preferencesGrid">
            <article className="wideCard preferenceCard">
              <h2>{t("language.title")}</h2>
              <p>{t("language.description")}</p>
              <div className="languagePreferenceBox">
                <span>{t("language.current")}</span>
                <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} />
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
                  <button onClick={() => window.open(detailCredential.url, "_blank")}>
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

      {confirmDialogElement}
      {restoreBackupDialog}
    </main>
  );
}



