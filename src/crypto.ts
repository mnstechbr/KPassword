import { invoke } from "@tauri-apps/api/core";
import type { EncryptedVaultFile, EncryptedVaultFileV2, PlainVault } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLegacyVaultFile(value: unknown): value is EncryptedVaultFile {
  if (!isRecord(value) || value.version !== 1 || value.app !== "KPassword") return false;
  if (value.cryptoVersion !== undefined && value.cryptoVersion !== 1) return false;
  if (!isRecord(value.crypto)) return false;

  return (
    value.crypto.algorithm === "AES-GCM" &&
    value.crypto.kdf === "PBKDF2-SHA-256" &&
    typeof value.crypto.iterations === "number" &&
    typeof value.crypto.salt === "string" &&
    typeof value.crypto.iv === "string" &&
    typeof value.payload === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isArgon2idVaultFile(value: unknown): value is EncryptedVaultFileV2 {
  if (!isRecord(value) || value.version !== 1 || value.app !== "KPassword") return false;
  if (value.cryptoVersion !== 2 || !isRecord(value.kdf) || !isRecord(value.cipher)) return false;
  if (!isRecord(value.kdf.params)) return false;

  return (
    value.kdf.algorithm === "argon2id" &&
    typeof value.kdf.salt === "string" &&
    value.cipher.algorithm === "AES-256-GCM" &&
    typeof value.cipher.nonce === "string" &&
    typeof value.kdf.params.memoryKiB === "number" &&
    typeof value.kdf.params.timeCost === "number" &&
    typeof value.kdf.params.parallelism === "number" &&
    typeof value.kdf.params.outputLength === "number" &&
    typeof value.payload === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function needsCryptoMigration(file: EncryptedVaultFile) {
  return (file.cryptoVersion ?? 1) < 2;
}

export async function encryptVault(
  vault: PlainVault,
  masterPassword: string,
  previousFile?: EncryptedVaultFile | null,
): Promise<EncryptedVaultFile> {
  const updatedVault: PlainVault = {
    ...vault,
    updatedAt: new Date().toISOString(),
  };

  return invoke<EncryptedVaultFileV2>("encrypt_vault_argon2id", {
    plainVaultJson: JSON.stringify(updatedVault),
    masterPassword,
    createdAt: previousFile?.createdAt ?? updatedVault.createdAt,
  });
}

export async function decryptVault(
  file: EncryptedVaultFile,
  masterPassword: string,
): Promise<PlainVault> {
  try {
    const decrypted = await invoke<string>("decrypt_vault_payload", { file, masterPassword });
    return JSON.parse(decrypted) as PlainVault;
  } catch {
    throw new Error("Senha mestra incorreta ou arquivo de cofre invalido.");
  }
}

export function parseEncryptedVault(raw: string): EncryptedVaultFile {
  const parsed = JSON.parse(raw) as unknown;

  if (isLegacyVaultFile(parsed) || isArgon2idVaultFile(parsed)) {
    return parsed;
  }

  throw new Error("Arquivo de cofre invalido ou incompativel.");
}
export function createEmptyVault(): PlainVault {
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    credentials: [],
    settings: {
      autoLockMinutes: 3,
      backupIntervalHours: 4,
      clipboardClearSeconds: 60,
      masterPasswordChangedAt: now,
      lastPasswordRotationReminderAt: now,
      lockOnMinimize: true,
      lockOnClose: true,
      lockOnInactive: true,
      notifyOnTray: true,
      soundOnTray: true,
    },
  };
}

export function validateMasterPassword(password: string) {
  const issues: string[] = [];

  if (password.length < 12) {
    issues.push("Use pelo menos 12 caracteres.");
  }

  if (!/[A-Z]/.test(password)) {
    issues.push("Inclua pelo menos uma letra maiúscula.");
  }

  if (!/[a-z]/.test(password)) {
    issues.push("Inclua pelo menos uma letra minúscula.");
  }

  if (!/[0-9]/.test(password)) {
    issues.push("Inclua pelo menos um número.");
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    issues.push("Inclua pelo menos um símbolo.");
  }

  return issues;
}
