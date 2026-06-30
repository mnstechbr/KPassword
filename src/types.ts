export type CredentialCategory =
  | "Trabalho"
  | "Pessoal"
  | "Banco"
  | "E-mail"
  | "Sistema"
  | "Outro";

export type VaultItemType =
  | "credential"
  | "secure_note"
  | "card"
  | "identity"
  | "license";

export type PasswordHistoryEntry = {
  id: string;
  password: string;
  changedAt: string;
  savedAt: string;
};

export type VaultAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  createdAt: string;
};

export type VaultFileInfo = {
  name: string;
  display_name: string;
  filename: string;
  size_bytes: number;
  modified_epoch_ms: number;
  is_default: boolean;
};

export type CredentialRecord = {
  id: string;
  itemType?: VaultItemType;
  title: string;
  username: string;
  password: string;
  url: string;
  category: CredentialCategory;
  notes: string;
  favorite: boolean;
  deletedAt?: string;
  passwordChangedAt?: string;
  passwordExpiresInDays?: number;
  passwordExpiryNoticeDays?: number;
  passwordHistory?: PasswordHistoryEntry[];
  attachments?: VaultAttachment[];
  totpSecret?: string;
  totpIssuer?: string;

  cardholderName?: string;
  cardNumber?: string;
  cardExpiry?: string;
  cardCvv?: string;
  cardIssuer?: string;

  identityFullName?: string;
  identityDocument?: string;
  identityEmail?: string;
  identityPhone?: string;
  identityAddress?: string;

  licenseProduct?: string;
  licenseKey?: string;
  licenseOwner?: string;
  licenseExpiresAt?: string;

  createdAt: string;
  updatedAt: string;
};

export type VaultSettings = {
  autoLockMinutes: number;
  backupIntervalHours: number;
  clipboardClearSeconds: number;
  masterPasswordChangedAt?: string;
  lastPasswordRotationReminderAt?: string;
  lockOnMinimize?: boolean;
  lockOnClose?: boolean;
  lockOnInactive?: boolean;
  notifyOnTray?: boolean;
  soundOnTray?: boolean;
};

export type PlainVault = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  credentials: CredentialRecord[];
  settings: VaultSettings;
};

export type EncryptedVaultFile = {
  version: 1;
  app: "KPassword";
  crypto: {
    algorithm: "AES-GCM";
    kdf: "PBKDF2-SHA-256";
    iterations: number;
    salt: string;
    iv: string;
  };
  createdAt: string;
  updatedAt: string;
  payload: string;
};

export type BackupFile = {
  filename: string;
  size_bytes: number;
  modified_epoch_ms: number;
};

export type StorageInfo = {
  vault_path: string;
  backup_dir: string;
  backups: BackupFile[];
  vault_name?: string;
};
