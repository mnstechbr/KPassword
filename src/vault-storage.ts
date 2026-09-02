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

export async function saveVaultFile(payload: string, vaultName = "vault", forceBackup = false) {
  return invoke<StorageInfo>("save_vault_file", { payload, vaultName, forceBackup });
}

/** Chave onde a identidade do cofre ativo e persistida (perfil do WebView2). */
export const ACTIVE_VAULT_STORAGE_KEY = "kpassword:active-vault";

/**
 * Le a identidade viva do cofre ativo.
 *
 * A identidade mora no localStorage, separada dos arquivos `.kpvault`. Os dois
 * podem dessincronizar, entao operacoes destrutivas nao devem confiar em estado
 * de React capturado antes de um dialogo -- leem daqui no momento da escrita.
 */
export function readActiveVaultName(): string | null {
  try {
    return localStorage.getItem(ACTIVE_VAULT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Resultado da restauracao segura: info de storage + backup criado antes da escrita. */
export type RestoreOutcome = {
  storage: StorageInfo;
  /** Nome do backup de seguranca. `null` apenas quando o cofre alvo nao existia. */
  safetyBackup: string | null;
};

/**
 * Restaura um backup sobre um cofre por uma UNICA operacao de backend.
 *
 * O backend cria a copia de seguranca do conteudo cifrado atual ANTES de
 * sobrescrever e aborta se ela falhar. Nao decifra nada, entao funciona
 * igualmente com o cofre bloqueado ou destravado.
 *
 * `expectedVaultName` e o alvo que o usuario confirmou: se o cofre ativo mudar
 * enquanto a confirmacao estiver pendente, o backend recusa a operacao.
 */
export async function restoreVaultFile(
  payload: string,
  vaultName = "vault",
  expectedVaultName?: string,
) {
  return invoke<RestoreOutcome>("restore_vault_file", { payload, vaultName, expectedVaultName });
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
export async function createPreArgon2Backup(payload: string, vaultName = "vault") {
  return invoke<StorageInfo>("create_pre_argon2_backup", { payload, vaultName });
}

export async function openVaultFolder(vaultName = "vault") {
  return invoke<void>("open_vault_folder", { vaultName });
}

export async function openBackupFolder(vaultName = "vault") {
  return invoke<void>("open_backup_folder", { vaultName });
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

/**
 * Remove um registro Hello orfao (estado `stale`) antes de criar um cofre novo
 * com o mesmo nome. Devolve `true` quando removeu algo. Nunca remove o registro
 * de um cofre existente — o backend recusa em qualquer outro estado.
 */
export async function discardOrphanWindowsHello(vaultName = "vault") {
  return withCommandTimeout(
    invoke<boolean>("discard_orphan_windows_hello", { vaultName }),
    WINDOWS_HELLO_DISABLE_TIMEOUT_MS,
    "Windows Hello orphan cleanup",
  );
}

/**
 * Isola (renomeia) o registro Hello quando o segredo recuperado nao abre o
 * cofre atual. Nao apaga: preserva o arquivo e interrompe o ciclo de oferecer
 * repetidamente um Hello que comprovadamente nao funciona.
 */
export async function quarantineWindowsHello(vaultName = "vault") {
  return withCommandTimeout(
    invoke<boolean>("quarantine_windows_hello", { vaultName }),
    WINDOWS_HELLO_DISABLE_TIMEOUT_MS,
    "Windows Hello quarantine",
  );
}

export async function unlockWithWindowsHello(vaultName = "vault", reason: string) {
  return withCommandTimeout(
    invoke<string>("unlock_with_windows_hello", { vaultName, reason }),
    WINDOWS_HELLO_ACTION_TIMEOUT_MS,
    "Windows Hello unlock",
  );
}
