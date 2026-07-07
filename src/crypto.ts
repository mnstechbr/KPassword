import { invoke } from "@tauri-apps/api/core";
import type { BackupVerificationReport, EncryptedVaultFile, EncryptedVaultFileV2, PlainVault } from "./types";

const ARGON2ID_MAX_MEMORY_KIB = 262_144;
const ARGON2ID_MAX_TIME_COST = 10;
const ARGON2ID_MAX_PARALLELISM = 4;
const LEGACY_PBKDF2_MAX_ITERATIONS = 2_000_000;

function isPositiveIntegerAtMost(value: unknown, max: number): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0 && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertPlainVault(value: unknown): asserts value is PlainVault {
  if (!isRecord(value)) throw new Error("Payload de cofre invalido.");
  if (value.version !== 1) throw new Error("Versao de payload incompativel.");
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    throw new Error("Datas do cofre invalidas.");
  }
  if (!Array.isArray(value.credentials)) throw new Error("Lista de credenciais invalida.");
  if (!isRecord(value.settings)) throw new Error("Configuracoes do cofre invalidas.");
}

function isLegacyVaultFile(value: unknown): value is EncryptedVaultFile {
  if (!isRecord(value) || value.version !== 1 || value.app !== "KPassword") return false;
  if (value.cryptoVersion !== undefined && value.cryptoVersion !== 1) return false;
  if (!isRecord(value.crypto)) return false;

  return (
    value.crypto.algorithm === "AES-GCM" &&
    value.crypto.kdf === "PBKDF2-SHA-256" &&
    isPositiveIntegerAtMost(value.crypto.iterations, LEGACY_PBKDF2_MAX_ITERATIONS) &&
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
    isPositiveIntegerAtMost(value.kdf.params.memoryKiB, ARGON2ID_MAX_MEMORY_KIB) &&
    isPositiveIntegerAtMost(value.kdf.params.timeCost, ARGON2ID_MAX_TIME_COST) &&
    isPositiveIntegerAtMost(value.kdf.params.parallelism, ARGON2ID_MAX_PARALLELISM) &&
    value.kdf.params.outputLength === 32 &&
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
    const parsed = JSON.parse(decrypted) as unknown;
    assertPlainVault(parsed);
    return parsed;
  } catch {
    throw new Error("Senha mestra incorreta ou arquivo de cofre invalido.");
  }
}

export async function validateEncryptedVaultBackup(raw: string, masterPassword: string) {
  const file = parseEncryptedVault(raw);
  const plainVault = await decryptVault(file, masterPassword);

  return { file, plainVault };
}

export async function verifyEncryptedVaultBackup(raw: string, masterPassword: string) {
  return invoke<BackupVerificationReport>("verify_backup_payload", { raw, masterPassword });
}

export function parseEncryptedVault(raw: string): EncryptedVaultFile {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Arquivo de cofre invalido ou incompativel.");
  }

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
    actionHistory: [],
    settings: {
      autoLockMinutes: 10,
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
