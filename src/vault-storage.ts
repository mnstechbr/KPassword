import { invoke } from "@tauri-apps/api/core";
import type { BackupFile, StorageInfo } from "./types";

export async function loadVaultFile() {
  return invoke<string | null>("load_vault_file");
}

export async function saveVaultFile(payload: string) {
  return invoke<StorageInfo>("save_vault_file", { payload });
}

export async function getStorageInfo() {
  return invoke<StorageInfo>("get_storage_info");
}

export async function listBackupFiles() {
  return invoke<BackupFile[]>("list_backup_files");
}

export async function readBackupFile(filename: string) {
  return invoke<string>("read_backup_file", { filename });
}
