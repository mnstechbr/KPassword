import { useCallback, useRef, useState } from "react";
import { translateBackendError } from "../backend-errors";
import { encryptVaultWithSession } from "../crypto";
import { addActionHistoryEntries, createActionHistoryEntry } from "../features/action-history";
import type { AppLanguage, translate } from "../i18n";
import { secureLogError } from "../lib/log";
import type {
  ActionHistoryEntry,
  ActionHistoryType,
  BackupFile,
  EncryptedVaultFile,
  PlainVault,
  StorageInfo,
} from "../types";
import { saveVaultFile } from "../vault-storage";

type Translator = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => string;

type VaultSessionOptions = {
  activeVaultName: string;
  appLanguage: AppLanguage;
  t: Translator;
  // Setters de estado do App: estáveis entre renders.
  setStorageInfo: (info: StorageInfo) => void;
  setBackups: (backups: BackupFile[]) => void;
  setMessage: (message: string) => void;
};

/** Cofre aberto, arquivo cifrado e a fila de gravação. */
export function useVaultSession({
  activeVaultName,
  appLanguage,
  t,
  setStorageInfo,
  setBackups,
  setMessage,
}: VaultSessionOptions) {
  const [vault, setVault] = useState<PlainVault | null>(null);
  const [encryptedVault, setEncryptedVault] = useState<EncryptedVaultFile | null>(null);
  // Estado mais recente para a fila de gravação (os closures do React podem estar defasados).
  const vaultRef = useRef<PlainVault | null>(null);
  const encryptedVaultRef = useRef<EncryptedVaultFile | null>(null);
  vaultRef.current = vault;
  encryptedVaultRef.current = encryptedVault;
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Grava o cofre em fila: uma gravação só começa quando a anterior terminou,
   * e um `updater` recebe o cofre já salvo por ela. Sem isso, uma entrada de
   * histórico (ex.: cópia de senha) gravada durante o Argon2 de uma edição
   * podia terminar por último e apagar a edição.
   */
  const persistVault = useCallback(
    (
      next: PlainVault | ((current: PlainVault) => PlainVault),
      forceBackup = false,
    ): Promise<EncryptedVaultFile> => {
      const job = saveQueueRef.current.then(async () => {
        const current = vaultRef.current;

        if (!current) {
          throw new Error(t("errors.masterPasswordUnavailable"));
        }

        const nextVault = typeof next === "function" ? next(current) : next;
        // A senha fica na sessão do backend: aqui só vai o cofre a cifrar.
        const file = await encryptVaultWithSession(nextVault, activeVaultName, encryptedVaultRef.current);
        const info = await saveVaultFile(
          JSON.stringify(file, null, 2),
          activeVaultName,
          forceBackup,
          nextVault.settings.backupIntervalHours,
        );

        setStorageInfo(info);
        setBackups(info.backups);
        if (info.warning) setMessage(translateBackendError(info.warning, appLanguage) ?? info.warning);

        // Cofre bloqueado durante a gravação: o arquivo foi salvo, mas a tela não reabre.
        if (!vaultRef.current) return file;

        const saved = { ...nextVault, updatedAt: file.updatedAt };
        vaultRef.current = saved;
        encryptedVaultRef.current = file;
        setEncryptedVault(file);
        setVault(saved);

        return file;
      });
      saveQueueRef.current = job.catch(() => undefined);
      return job;
    },
    // `appLanguage` muda junto com `t`; os setters são estáveis.
    [activeVaultName, appLanguage, setBackups, setMessage, setStorageInfo, t],
  );

  const persistVaultWithHistory = useCallback(
    async (
      nextVault: PlainVault | ((current: PlainVault) => PlainVault),
      historyEntry?: ActionHistoryEntry | ActionHistoryEntry[],
      forceBackup = false,
    ) => persistVault(
      typeof nextVault === "function"
        ? (current) => addActionHistoryEntries(nextVault(current), historyEntry)
        : addActionHistoryEntries(nextVault, historyEntry),
      forceBackup,
    ),
    [persistVault],
  );

  const recordActionHistoryOnly = useCallback(
    async (type: ActionHistoryType, targetName?: string) => {
      if (!vaultRef.current) return;

      try {
        const entry = createActionHistoryEntry(type, targetName);
        await persistVaultWithHistory(
          (current) => ({ ...current, updatedAt: new Date().toISOString() }),
          entry,
        );
      } catch (error) {
        secureLogError("registrar histórico de ações", error);
      }
    },
    [persistVaultWithHistory],
  );

  return {
    vault,
    setVault,
    vaultRef,
    encryptedVault,
    setEncryptedVault,
    persistVault,
    persistVaultWithHistory,
    recordActionHistoryOnly,
  };
}
