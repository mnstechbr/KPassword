import { invoke } from "@tauri-apps/api/core";
import type { BackupFile, StorageInfo, VaultFileInfo, WindowsHelloStatus } from "./types";

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
  return invoke<WindowsHelloStatus>("windows_hello_status", { vaultName });
}

export async function enableWindowsHello(vaultName = "vault", masterPassword: string, reason: string) {
  return invoke<WindowsHelloStatus>("enable_windows_hello", { vaultName, masterPassword, reason });
}

export async function disableWindowsHello(vaultName = "vault") {
  return invoke<WindowsHelloStatus>("disable_windows_hello", { vaultName });
}

export async function unlockWithWindowsHello(vaultName = "vault", reason: string) {
  return invoke<string>("unlock_with_windows_hello", { vaultName, reason });
}
