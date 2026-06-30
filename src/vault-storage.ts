import { invoke } from "@tauri-apps/api/core";
import type { BackupFile, StorageInfo, VaultFileInfo } from "./types";

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
