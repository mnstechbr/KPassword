export type CredentialCategory =
  | "Trabalho"
  | "Pessoal"
  | "Banco"
  | "E-mail"
  | "Sistema"
  | "Outro";

export type CredentialRecord = {
  id: string;
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
};
