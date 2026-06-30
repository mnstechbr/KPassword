import { invoke } from "@tauri-apps/api/core";
import type { BackupFile, StorageInfo, VaultFileInfo, WindowsHelloStatus } from "./types";

const WINDOWS_HELLO_STATUS_TIMEOUT_MS = 8_000;
const WINDOWS_HELLO_ACTION_TIMEOUT_MS = 90_000;
const WINDOWS_HELLO_DISABLE_TIMEOUT_MS = 15_000;

function withCommandTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} demorou mais que o esperado.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}


export async function loadVaultFile(vaultName = "vault") {
  return invoke<string | null>("load_vault_file", { vaultName });
}

export async function saveVaultFile(payload: string, vaultName = "vault") {
  return invoke<StorageInfo>("save_vault_file", { payload, vaultName });
}

export async function getStorageInfo(vaultName = "vault") {
  return invoke<StorageInfo>("get_storage_info", { vaultName });
}

export async function listVaultFiles() {
  return invoke<VaultFileInfo[]>("list_vault_files");
}

export async function listBackupFiles(vaultName = "vault") {
  return invoke<BackupFile[]>("list_backup_files", { vaultName });
}

export async function readBackupFile(filename: string, vaultName = "vault") {
  return invoke<string>("read_backup_file", { filename, vaultName });
}


export async function getWindowsHelloStatus(vaultName = "vault") {
  return withCommandTimeout(
    invoke<WindowsHelloStatus>("windows_hello_status", { vaultName }),
    WINDOWS_HELLO_STATUS_TIMEOUT_MS,
    "Windows Hello status",
  );
}

export async function enableWindowsHello(vaultName = "vault", masterPassword: string, reason: string) {
  return withCommandTimeout(
    invoke<WindowsHelloStatus>("enable_windows_hello", { vaultName, masterPassword, reason }),
    WINDOWS_HELLO_ACTION_TIMEOUT_MS,
    "Windows Hello enable",
  );
}

export async function disableWindowsHello(vaultName = "vault") {
  return withCommandTimeout(
    invoke<WindowsHelloStatus>("disable_windows_hello", { vaultName }),
    WINDOWS_HELLO_DISABLE_TIMEOUT_MS,
    "Windows Hello disable",
  );
}

export async function unlockWithWindowsHello(vaultName = "vault", reason: string) {
  return withCommandTimeout(
    invoke<string>("unlock_with_windows_hello", { vaultName, reason }),
    WINDOWS_HELLO_ACTION_TIMEOUT_MS,
    "Windows Hello unlock",
  );
}
