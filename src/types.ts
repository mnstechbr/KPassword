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

export type ActionHistoryType =
  | "vault_created"
  | "vault_unlocked"
  | "vault_unlocked_windows_hello"
  | "credential_created"
  | "credential_updated"
  | "credential_moved_to_trash"
  | "credential_restored"
  | "credential_deleted_forever"
  | "trash_emptied"
  | "password_copied"
  | "username_copied"
  | "master_password_changed"
  | "windows_hello_enabled"
  | "windows_hello_disabled"
  | "totp_updated"
  | "totp_removed"
  | "attachment_added"
  | "attachment_removed"
  | "encrypted_exported"
  | "csv_exported"
  | "csv_imported";

export type ActionHistoryEntry = {
  id: string;
  type: ActionHistoryType;
  targetName?: string;
  createdAt: string;
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
  tags?: string[];
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
  actionHistory?: ActionHistoryEntry[];
  settings: VaultSettings;
};

export type LegacyEncryptedVaultFile = {
  version: 1;
  app: "KPassword";
  cryptoVersion?: 1;
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

export type Argon2idKdfParams = {
  memoryKiB: number;
  timeCost: number;
  parallelism: number;
  outputLength: number;
};

export type EncryptedVaultFileV2 = {
  version: 1;
  app: "KPassword";
  cryptoVersion: 2;
  kdf: {
    algorithm: "argon2id";
    params: Argon2idKdfParams;
    salt: string;
  };
  cipher: {
    algorithm: "AES-256-GCM";
    nonce: string;
  };
  createdAt: string;
  updatedAt: string;
  payload: string;
};

export type EncryptedVaultFile = LegacyEncryptedVaultFile | EncryptedVaultFileV2;

export type BackupVerificationReport = {
  ok: boolean;
  message: string;
  backupVersion?: string;
  cryptoVersion?: number;
  itemCount?: number;
  createdAt?: string;
};

export type WindowsHelloStatus = {
  available: boolean;
  enabled: boolean;
  reason: string;
  vault_name: string;
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
