import type { CredentialCategory, CredentialRecord, PasswordHistoryEntry, VaultAttachment, VaultItemType } from "../types";
import { translate, type AppLanguage } from "../i18n";

export const EMPTY_FORM: Omit<CredentialRecord, "id" | "createdAt" | "updatedAt"> = {
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

export const CATEGORIES: CredentialCategory[] = [
  "Trabalho",
  "Pessoal",
  "Banco",
  "E-mail",
  "Sistema",
  "Outro",
];

export const ITEM_TYPES: VaultItemType[] = ["credential", "secure_note", "card", "identity", "license", "api_key"];
export const PASSWORD_EXPIRY_OPTIONS = [0, 30, 60, 90, 180, 365];
export const PASSWORD_NOTICE_OPTIONS = [7, 15, 30, 60];
export type PasswordExpiryStatus = "never" | "valid" | "soon" | "expired";

export function getEmptyCredential(): Omit<CredentialRecord, "id" | "createdAt" | "updatedAt"> {
  return { ...EMPTY_FORM, tags: [] };
}

export function normalizeCredentialTags(input: unknown): string[] {
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

export function formatTagsForInput(tags: unknown) {
  return normalizeCredentialTags(tags).join(", ");
}

export function getCredentialTags(credential: CredentialRecord) {
  return normalizeCredentialTags(credential.tags);
}

export function maskPassword(password: string) {
  if (!password) return "—";
  return "••••••••••••";
}

export function getOrderedCredentials(credentials: CredentialRecord[]) {
  return [...credentials].sort(
    (first, second) => Number(second.favorite) - Number(first.favorite),
  );
}

export function getItemType(credential: CredentialRecord): VaultItemType {
  return credential.itemType ?? "credential";
}

export function isCredentialItem(credential: CredentialRecord) {
  return getItemType(credential) === "credential";
}

export function getItemTypeLabel(itemType: VaultItemType, language: AppLanguage) {
  return translate(language, `itemType.${itemType}`);
}

export function getItemSubtitle(item: CredentialRecord, language: AppLanguage) {
  const itemType = getItemType(item);

  if (itemType === "credential") {
    return item.username || translate(language, "credential.noUser");
  }

  if (itemType === "api_key") return item.apiProvider || item.apiIdentifier || "API Key";

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

export function getItemPrimarySecret(item: CredentialRecord) {
  const itemType = getItemType(item);

  if (itemType === "credential" || itemType === "api_key") return item.password;
  if (itemType === "card") return item.cardNumber ?? "";
  if (itemType === "license") return item.licenseKey ?? "";

  return "";
}

export function maskGenericSecret(value?: string) {
  if (!value) return "—";
  const normalized = value.replace(/\s+/g, "");

  if (normalized.length <= 4) return "••••";
  return `•••• ${normalized.slice(-4)}`;
}

export function getAttachments(credential?: Partial<CredentialRecord> | null): VaultAttachment[] {
  return Array.isArray(credential?.attachments) ? credential.attachments : [];
}

export function getPasswordHistory(credential: CredentialRecord): PasswordHistoryEntry[] {
  return credential.passwordHistory ?? [];
}

export function daysBetween(startIso: string | undefined, end = new Date()) {
  if (!startIso) return 0;

  const start = new Date(startIso).getTime();

  if (Number.isNaN(start)) return 0;

  return Math.floor((end.getTime() - start) / (24 * 60 * 60 * 1000));
}

export function getActiveCredentials(credentials: CredentialRecord[]) {
  return credentials.filter((credential) => !credential.deletedAt);
}

export function getDeletedCredentials(credentials: CredentialRecord[]) {
  return credentials.filter((credential) => Boolean(credential.deletedAt));
}

export function getCredentialPasswordChangedAt(credential: CredentialRecord) {
  return credential.passwordChangedAt ?? credential.updatedAt ?? credential.createdAt;
}

export function getPasswordExpiryInfo(credential: CredentialRecord) {
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

export function getExpiryBadgeClass(status: PasswordExpiryStatus) {
  if (status === "expired") return "expiryBadge expired";
  if (status === "soon") return "expiryBadge soon";
  if (status === "valid") return "expiryBadge valid";
  return "expiryBadge never";
}
