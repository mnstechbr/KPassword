import type { EncryptedVaultFile, PlainVault } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const VAULT_AAD = encoder.encode("KPassword:Vault:v1");
const DEFAULT_ITERATIONS = 450_000;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveVaultKey(masterPassword: string, salt: Uint8Array, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptVault(
  vault: PlainVault,
  masterPassword: string,
  previousFile?: EncryptedVaultFile | null,
): Promise<EncryptedVaultFile> {
  const salt = previousFile ? base64ToBytes(previousFile.crypto.salt) : randomBytes(32);
  const iv = randomBytes(12);
  const iterations = previousFile?.crypto.iterations ?? DEFAULT_ITERATIONS;
  const key = await deriveVaultKey(masterPassword, salt, iterations);
  const updatedVault: PlainVault = {
    ...vault,
    updatedAt: new Date().toISOString(),
  };

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: VAULT_AAD,
      tagLength: 128,
    },
    key,
    encoder.encode(JSON.stringify(updatedVault)),
  );

  return {
    version: 1,
    app: "KPassword",
    crypto: {
      algorithm: "AES-GCM",
      kdf: "PBKDF2-SHA-256",
      iterations,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
    },
    createdAt: previousFile?.createdAt ?? updatedVault.createdAt,
    updatedAt: updatedVault.updatedAt,
    payload: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptVault(
  file: EncryptedVaultFile,
  masterPassword: string,
): Promise<PlainVault> {
  const salt = base64ToBytes(file.crypto.salt);
  const iv = base64ToBytes(file.crypto.iv);
  const payload = base64ToBytes(file.payload);
  const key = await deriveVaultKey(masterPassword, salt, file.crypto.iterations);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: VAULT_AAD,
      tagLength: 128,
    },
    key,
    payload,
  );

  return JSON.parse(decoder.decode(decrypted)) as PlainVault;
}

export function parseEncryptedVault(raw: string): EncryptedVaultFile {
  const parsed = JSON.parse(raw) as EncryptedVaultFile;

  if (
    parsed.version !== 1 ||
    parsed.app !== "KPassword" ||
    parsed.crypto?.algorithm !== "AES-GCM" ||
    parsed.crypto?.kdf !== "PBKDF2-SHA-256" ||
    !parsed.payload
  ) {
    throw new Error("Arquivo de cofre inválido ou incompatível.");
  }

  return parsed;
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
