import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  createEmptyVault,
  decryptVault,
  encryptVault,
  parseEncryptedVault,
  validateMasterPassword,
} from "./crypto";
import { generateStrongPassword, getPasswordLabel, getPasswordScore } from "./password";
import {
  getStorageInfo,
  listBackupFiles,
  loadVaultFile,
  saveVaultFile,
} from "./vault-storage";
import type {
  BackupFile,
  CredentialCategory,
  CredentialRecord,
  EncryptedVaultFile,
  PlainVault,
  StorageInfo,
} from "./types";

const EMPTY_FORM: Omit<CredentialRecord, "id" | "createdAt" | "updatedAt"> = {
  title: "",
  username: "",
  password: "",
  url: "",
  category: "Trabalho",
  notes: "",
  favorite: false,
};

const CATEGORIES: CredentialCategory[] = [
  "Trabalho",
  "Pessoal",
  "Banco",
  "E-mail",
  "Sistema",
  "Outro",
];

const CLIPBOARD_CLEAR_SECONDS = 60;
const APP_VERSION = "0.3.0";
const UPDATE_GITHUB_OWNER = "SEU_USUARIO_GITHUB";
const UPDATE_GITHUB_REPO = "SEU_REPO_GITHUB";
const PASSWORD_ROTATION_DAYS = 30;

type Screen = "credentials" | "dashboard" | "settings" | "preferences";

type AppTheme = "dark" | "light" | "mixed";
type FontScale = "normal" | "large";

type ConfirmDialog = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
  resolve: (confirmed: boolean) => void;
};

function createId() {
  return crypto.randomUUID();
}

function formatDate(value?: string | number) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function getEmptyCredential(): Omit<CredentialRecord, "id" | "createdAt" | "updatedAt"> {
  return { ...EMPTY_FORM };
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();

  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function maskPassword(password: string) {
  if (!password) return "—";
  return "••••••••••••";
}

function getOrderedCredentials(credentials: CredentialRecord[]) {
  return [...credentials].sort(
    (first, second) => Number(second.favorite) - Number(first.favorite),
  );
}

function getStoredValue<T extends string>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);

    if (!value) return fallback;

    return value as T;
  } catch {
    return fallback;
  }
}

function AppLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`appLogo ${size}`} aria-hidden="true">
      <img
        src="/app-icon.png"
        alt=""
        draggable={false}
        onError={(event) => {
          event.currentTarget.style.display = "none";
          event.currentTarget.nextElementSibling?.removeAttribute("hidden");
        }}
      />
      <span hidden>KP</span>
    </span>
  );
}

function stopAction(event: MouseEvent) {
  event.stopPropagation();
}

function daysBetween(startIso: string | undefined, end = new Date()) {
  if (!startIso) return 0;

  const start = new Date(startIso).getTime();

  if (Number.isNaN(start)) return 0;

  return Math.floor((end.getTime() - start) / (24 * 60 * 60 * 1000));
}

function normalizeVault(vault: PlainVault): PlainVault {
  const now = new Date().toISOString();

  return {
    ...vault,
    settings: {
      autoLockMinutes: vault.settings?.autoLockMinutes ?? 3,
      backupIntervalHours: vault.settings?.backupIntervalHours ?? 4,
      clipboardClearSeconds: CLIPBOARD_CLEAR_SECONDS,
      masterPasswordChangedAt:
        vault.settings?.masterPasswordChangedAt ?? vault.createdAt ?? now,
      lastPasswordRotationReminderAt: vault.settings?.lastPasswordRotationReminderAt,
    },
  };
}

function compareVersions(currentVersion: string, latestVersion: string) {
  const clean = (value: string) =>
    value
      .replace(/^v/i, "")
      .split(/[.-]/)
      .map((part) => Number.parseInt(part, 10) || 0);

  const current = clean(currentVersion);
  const latest = clean(latestVersion);
  const maxLength = Math.max(current.length, latest.length);

  for (let index = 0; index < maxLength; index += 1) {
    const currentPart = current[index] ?? 0;
    const latestPart = latest[index] ?? 0;

    if (latestPart > currentPart) return 1;
    if (latestPart < currentPart) return -1;
  }

  return 0;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("credentials");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [appTheme, setAppTheme] = useState<AppTheme>(() =>
    getStoredValue<AppTheme>("kpassword:theme", "dark"),
  );
  const [fontScale, setFontScale] = useState<FontScale>(() =>
    getStoredValue<FontScale>("kpassword:font-scale", "normal"),
  );
  const [reduceMotion, setReduceMotion] = useState(() =>
    getStoredValue<string>("kpassword:reduce-motion", "false") === "true",
  );
  const [compactMode, setCompactMode] = useState(() =>
    getStoredValue<string>("kpassword:compact-mode", "false") === "true",
  );
  const [vault, setVault] = useState<PlainVault | null>(null);
  const [encryptedVault, setEncryptedVault] = useState<EncryptedVaultFile | null>(null);
  const [masterPassword, setMasterPassword] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [mode, setMode] = useState<"loading" | "setup" | "locked" | "unlocked">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailCredentialId, setDetailCredentialId] = useState<string | null>(null);
  const [credentialForm, setCredentialForm] = useState(getEmptyCredential);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [showStoragePaths, setShowStoragePaths] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [copiedField, setCopiedField] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [currentMasterPassword, setCurrentMasterPassword] = useState("");
  const [newMasterPassword, setNewMasterPassword] = useState("");
  const [newMasterConfirm, setNewMasterConfirm] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [restorePopupOpen, setRestorePopupOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");


  const askConfirmation = useCallback(
    (options: Omit<ConfirmDialog, "resolve">) =>
      new Promise<boolean>((resolve) => {
        setConfirmDialog({
          ...options,
          resolve,
        });
      }),
    [],
  );

  function closeConfirmDialog(confirmed: boolean) {
    confirmDialog?.resolve(confirmed);
    setConfirmDialog(null);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = appTheme;
    document.documentElement.dataset.fontScale = fontScale;
    document.documentElement.dataset.motion = reduceMotion ? "reduced" : "normal";
    document.documentElement.dataset.density = compactMode ? "compact" : "normal";

    localStorage.setItem("kpassword:theme", appTheme);
    localStorage.setItem("kpassword:font-scale", fontScale);
    localStorage.setItem("kpassword:reduce-motion", String(reduceMotion));
    localStorage.setItem("kpassword:compact-mode", String(compactMode));
  }, [appTheme, fontScale, reduceMotion, compactMode]);

  const refreshStorageInfo = useCallback(async () => {
    try {
      const [info, backupFiles] = await Promise.all([getStorageInfo(), listBackupFiles()]);
      setStorageInfo(info);
      setBackups(backupFiles);
    } catch (error) {
      console.error("Erro ao carregar informações de armazenamento:", error);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setMessage("");
        const raw = await loadVaultFile();

        if (!raw) {
          setMode("setup");
          await refreshStorageInfo();
          return;
        }

        setEncryptedVault(parseEncryptedVault(raw));
        setMode("locked");
        await refreshStorageInfo();
      } catch (error) {
        console.error(error);
        setMessage("Não foi possível carregar o cofre local.");
        setMode("setup");
      }
    })();
  }, [refreshStorageInfo]);

  const lockVault = useCallback(() => {
    setVault(null);
    setMasterPassword("");
    setUnlockPassword("");
    setSetupPassword("");
    setConfirmPassword("");
    setVisiblePasswords({});
    setDetailCredentialId(null);
    setMessage("");
    setMode((current) => (current === "setup" ? "setup" : "locked"));
  }, []);

  useEffect(() => {
    const handler = () => lockVault();

    window.addEventListener("kpassword:lock", handler);

    return () => window.removeEventListener("kpassword:lock", handler);
  }, [lockVault]);

  const persistVault = useCallback(
    async (nextVault: PlainVault, passwordOverride?: string) => {
      const password = passwordOverride ?? masterPassword;

      if (!password) {
        throw new Error("Senha mestra indisponível.");
      }

      const file = await encryptVault(nextVault, password, encryptedVault);
      const info = await saveVaultFile(JSON.stringify(file, null, 2));

      setEncryptedVault(file);
      setVault({
        ...nextVault,
        updatedAt: file.updatedAt,
      });
      setStorageInfo(info);
      setBackups(info.backups);

      return file;
    },
    [encryptedVault, masterPassword],
  );

  useEffect(() => {
    if (!vault || mode !== "unlocked") {
      return;
    }

    const interval = window.setInterval(() => {
      void persistVault(vault).catch((error) => {
        console.error("Erro ao criar backup automático:", error);
      });
    }, vault.settings.backupIntervalHours * 60 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [mode, persistVault, vault]);

  async function handleCreateVault(event: FormEvent) {
    event.preventDefault();
    setMessage("");

    const issues = validateMasterPassword(setupPassword);

    if (issues.length > 0) {
      setMessage(issues.join(" "));
      return;
    }

    if (setupPassword !== confirmPassword) {
      setMessage("A confirmação não confere com a senha mestra.");
      return;
    }

    const confirmed = await askConfirmation({
      title: "Criar cofre local",
      message:
        "Criar o cofre local criptografado? Guarde bem a senha mestra, porque ela não poderá ser recuperada.",
      confirmText: "Criar cofre",
      cancelText: "Cancelar",
    });

    if (!confirmed) {
      return;
    }

    setBusy(true);

    try {
      const newVault = normalizeVault(createEmptyVault());
      const file = await encryptVault(newVault, setupPassword);
      const info = await saveVaultFile(JSON.stringify(file, null, 2));

      setEncryptedVault(file);
      setVault(newVault);
      setMasterPassword(setupPassword);
      setSetupPassword("");
      setConfirmPassword("");
      setStorageInfo(info);
      setBackups(info.backups);
      setScreen("credentials");
      setMode("unlocked");
      setMessage("");
    } catch (error) {
      console.error(error);
      setMessage("Erro ao criar o cofre.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock(event: FormEvent) {
    event.preventDefault();
    setMessage("");

    if (!encryptedVault) {
      setMode("setup");
      return;
    }

    setBusy(true);

    try {
      const plainVault = normalizeVault(await decryptVault(encryptedVault, unlockPassword));

      setVault(plainVault);
      setMasterPassword(unlockPassword);
      setUnlockPassword("");
      setScreen("credentials");
      setMode("unlocked");
      setMessage("");
      await refreshStorageInfo();
      void maybeShowPasswordRotationReminder(plainVault);
    } catch (error) {
      console.error(error);
      setMessage("Senha mestra incorreta ou cofre corrompido.");
    } finally {
      setBusy(false);
    }
  }

  async function maybeShowPasswordRotationReminder(currentVault: PlainVault) {
    const changedAt = currentVault.settings.masterPasswordChangedAt ?? currentVault.createdAt;
    const lastReminder = localStorage.getItem("kpassword:last-password-rotation-reminder");

    if (daysBetween(changedAt) < PASSWORD_ROTATION_DAYS) return;
    if (lastReminder && daysBetween(lastReminder) < PASSWORD_ROTATION_DAYS) return;

    localStorage.setItem("kpassword:last-password-rotation-reminder", new Date().toISOString());

    const confirmed = await askConfirmation({
      title: "Revisar senha mestra",
      message:
        "Já se passaram 30 dias ou mais desde a última alteração registrada da senha mestra. Não é obrigatório, mas é recomendado revisar e trocar a senha periodicamente.",
      confirmText: "Abrir segurança",
      cancelText: "Lembrar depois",
    });

    if (confirmed) {
      setScreen("settings");
    }
  }

  async function handleChangeMasterPassword(event: FormEvent) {
    event.preventDefault();
    setMessage("");

    if (!vault || !encryptedVault) return;

    if (!currentMasterPassword) {
      setMessage("Informe a senha mestra atual.");
      return;
    }

    const issues = validateMasterPassword(newMasterPassword);

    if (issues.length > 0) {
      setMessage(issues.join(" "));
      return;
    }

    if (newMasterPassword !== newMasterConfirm) {
      setMessage("A confirmação da nova senha não confere.");
      return;
    }

    const confirmed = await askConfirmation({
      title: "Alterar senha mestra",
      message:
        "Confirmar alteração da senha mestra? Todos os dados e backups futuros serão protegidos pela nova senha. Backups antigos continuam exigindo a senha usada na época em que foram criados.",
      confirmText: "Alterar senha",
      cancelText: "Cancelar",
    });

    if (!confirmed) return;

    setBusy(true);

    try {
      await decryptVault(encryptedVault, currentMasterPassword);

      const now = new Date().toISOString();
      const nextVault = normalizeVault({
        ...vault,
        updatedAt: now,
        settings: {
          ...vault.settings,
          masterPasswordChangedAt: now,
          lastPasswordRotationReminderAt: now,
        },
      });
      const file = await encryptVault(nextVault, newMasterPassword, null);
      const info = await saveVaultFile(JSON.stringify(file, null, 2));

      setEncryptedVault(file);
      setVault({ ...nextVault, updatedAt: file.updatedAt });
      setMasterPassword(newMasterPassword);
      setCurrentMasterPassword("");
      setNewMasterPassword("");
      setNewMasterConfirm("");
      setStorageInfo(info);
      setBackups(info.backups);
      setMessage("Senha mestra alterada com sucesso.");
    } catch (error) {
      console.error(error);
      setMessage("Senha atual incorreta ou erro ao alterar a senha mestra.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreBackupFromText(raw: string, password: string) {
    if (!password) {
      setMessage("Informe a senha mestra usada no backup.");
      return;
    }

    setMessage("");

    try {
      const parsed = parseEncryptedVault(raw);
      const restoredVault = normalizeVault(await decryptVault(parsed, password));

      const confirmed = await askConfirmation({
        title: "Restaurar backup",
        message:
          "Confirmar restauração deste backup? O cofre atual será substituído pelo conteúdo do arquivo selecionado. Um backup criptografado do estado atual será mantido na pasta de backups quando possível.",
        confirmText: "Restaurar backup",
        cancelText: "Cancelar",
        tone: "danger",
      });

      if (!confirmed) return;

      const info = await saveVaultFile(raw);

      setEncryptedVault(parsed);
      setVault(restoredVault);
      setMasterPassword(password);
      setRestorePassword("");
      setRestorePopupOpen(false);
      setStorageInfo(info);
      setBackups(info.backups);
      setScreen("credentials");
      setMode("unlocked");
      setMessage("Backup restaurado com sucesso.");
    } catch (error) {
      console.error(error);
      setMessage("Não foi possível restaurar o backup. Verifique o arquivo e a senha mestra.");
    }
  }

  async function handleBackupFileInput(file: File | undefined | null, password: string) {
    if (!file) return;

    const raw = await file.text();
    await restoreBackupFromText(raw, password);
  }

  async function handleCheckUpdates() {
    setUpdateStatus("Verificando atualizações...");

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");

      const update = await check();

      if (!update) {
        setUpdateStatus(`KPassword ${APP_VERSION}: nenhuma atualização encontrada.`);
        return;
      }

      setUpdateStatus(`Atualização ${update.version} encontrada. Baixando...`);

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setUpdateStatus("Download da atualização iniciado...");
          return;
        }

        if (event.event === "Progress") {
          const loaded = "data" in event && typeof event.data === "object" && event.data && "chunkLength" in event.data
            ? Number(event.data.chunkLength)
            : 0;

          if (loaded > 0) {
            setUpdateStatus("Baixando e instalando atualização...");
          }
          return;
        }

        if (event.event === "Finished") {
          setUpdateStatus("Download concluído. Instalando atualização...");
        }
      });

      setUpdateStatus("Atualização instalada. Reiniciando o KPassword...");
      await relaunch();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setUpdateStatus(`Falha ao verificar ou instalar atualização: ${detail}`);
    }
  }  function openNewCredentialForm() {
    setEditingId(null);
    setCredentialForm(getEmptyCredential());
    setFormOpen(true);
  }

  function openEditCredentialForm(credential: CredentialRecord) {
    setEditingId(credential.id);
    setCredentialForm({
      title: credential.title,
      username: credential.username,
      password: credential.password,
      url: credential.url,
      category: credential.category,
      notes: credential.notes,
      favorite: credential.favorite,
    });
    setFormOpen(true);
  }

  async function handleSaveCredential(event: FormEvent) {
    event.preventDefault();

    if (!vault) return;

    if (!credentialForm.title.trim()) {
      setMessage("Informe um nome para a credencial.");
      return;
    }

    if (!credentialForm.password.trim()) {
      setMessage("Informe ou gere uma senha.");
      return;
    }

    const confirmed = await askConfirmation({
      title: editingId ? "Salvar edição" : "Criar credencial",
      message: editingId
        ? "Confirmar a edição desta credencial?"
        : "Confirmar a criação desta nova credencial?",
      confirmText: editingId ? "Salvar edição" : "Criar credencial",
      cancelText: "Cancelar",
    });

    if (!confirmed) {
      return;
    }

    const now = new Date().toISOString();
    const cleanForm = {
      ...credentialForm,
      title: credentialForm.title.trim(),
      username: credentialForm.username.trim(),
      url: normalizeUrl(credentialForm.url),
      notes: credentialForm.notes.trim(),
    };

    const createdId = createId();

    const nextCredentials = editingId
      ? vault.credentials.map((credential) =>
          credential.id === editingId
            ? {
                ...credential,
                ...cleanForm,
                updatedAt: now,
              }
            : credential,
        )
      : [
          {
            id: createdId,
            ...cleanForm,
            createdAt: now,
            updatedAt: now,
          },
          ...vault.credentials,
        ];

    setBusy(true);

    try {
      await persistVault({
        ...vault,
        credentials: nextCredentials,
        updatedAt: now,
      });

      setFormOpen(false);
      setEditingId(null);
      setCredentialForm(getEmptyCredential());
      setDetailCredentialId(editingId ?? createdId);
      setScreen("credentials");
      setMessage(editingId ? "Credencial atualizada." : "Credencial criada.");
    } catch (error) {
      console.error(error);
      setMessage("Erro ao salvar a credencial.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCredential(id: string) {
    if (!vault) return;

    const target = vault.credentials.find((credential) => credential.id === id);
    const confirmed = await askConfirmation({
      title: "Excluir credencial",
      message: `Confirmar exclusão da credencial "${target?.title ?? "selecionada"}"? Esta ação não remove backups antigos.`,
      confirmText: "Excluir",
      cancelText: "Cancelar",
      tone: "danger",
    });

    if (!confirmed) return;

    setBusy(true);

    try {
      await persistVault({
        ...vault,
        credentials: vault.credentials.filter((credential) => credential.id !== id),
        updatedAt: new Date().toISOString(),
      });

      if (detailCredentialId === id) {
        setDetailCredentialId(null);
      }

      setMessage("Credencial excluída.");
    } catch (error) {
      console.error(error);
      setMessage("Erro ao excluir a credencial.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(id: string) {
    if (!vault) return;

    const nextCredentials = vault.credentials
      .map((credential) =>
        credential.id === id
          ? {
              ...credential,
              favorite: !credential.favorite,
              updatedAt: new Date().toISOString(),
            }
          : credential,
      )
      .sort((first, second) => Number(second.favorite) - Number(first.favorite));

    await persistVault({
      ...vault,
      credentials: nextCredentials,
      updatedAt: new Date().toISOString(),
    });
  }

  async function moveCredentialByOffset(id: string, offset: -1 | 1) {
    if (!vault || search.trim()) return;

    const orderedCredentials = getOrderedCredentials(vault.credentials);
    const sourceIndex = orderedCredentials.findIndex((credential) => credential.id === id);

    if (sourceIndex < 0) return;

    const targetIndex = sourceIndex + offset;

    if (targetIndex < 0 || targetIndex >= orderedCredentials.length) return;

    const source = orderedCredentials[sourceIndex];
    const target = orderedCredentials[targetIndex];

    if (source.favorite !== target.favorite) return;

    const reordered = [...orderedCredentials];
    const [removed] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, removed);

    await persistVault({
      ...vault,
      credentials: reordered,
      updatedAt: new Date().toISOString(),
    });
  }

  async function copySecure(value: string, label: string) {
    if (!value) return;

    await navigator.clipboard.writeText(value);
    setCopiedField(label);

    window.setTimeout(async () => {
      try {
        const current = await navigator.clipboard.readText();

        if (current === value) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        try {
          await navigator.clipboard.writeText("");
        } catch {
          // Ignora falha de limpeza em ambiente sem permissão de clipboard.
        }
      }

      setCopiedField("");
    }, CLIPBOARD_CLEAR_SECONDS * 1000);
  }

  const filteredCredentials = useMemo(() => {
    if (!vault) return [];

    const terms = search
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    return getOrderedCredentials(vault.credentials).filter((credential) => {
      if (terms.length === 0) return true;

      const searchable = [
        credential.title,
        credential.username,
        credential.url,
        credential.category,
        credential.notes,
        credential.password,
        credential.favorite ? "favorito favorita estrela" : "",
      ]
        .join(" ")
        .toLowerCase();

      return terms.every((term) => searchable.includes(term));
    });
  }, [search, vault]);

  const detailCredential = useMemo(() => {
    if (!vault || !detailCredentialId) return null;
    return vault.credentials.find((credential) => credential.id === detailCredentialId) ?? null;
  }, [detailCredentialId, vault]);

  const stats = useMemo(() => {
    const credentials = vault?.credentials ?? [];
    const repeatedPasswords = new Map<string, number>();

    credentials.forEach((credential) => {
      repeatedPasswords.set(
        credential.password,
        (repeatedPasswords.get(credential.password) ?? 0) + 1,
      );
    });

    const weak = credentials.filter(
      (credential) => getPasswordScore(credential.password) < 60,
    ).length;
    const repeated = credentials.filter(
      (credential) => (repeatedPasswords.get(credential.password) ?? 0) > 1,
    ).length;

    return {
      total: credentials.length,
      favorites: credentials.filter((credential) => credential.favorite).length,
      weak,
      repeated,
    };
  }, [vault]);

  const canReorderCredentials = search.trim().length === 0;
  const masterIssues = validateMasterPassword(setupPassword);
  const score = getPasswordScore(credentialForm.password);

  const confirmDialogElement = confirmDialog ? (
    <div className="confirmOverlay" onMouseDown={() => closeConfirmDialog(false)}>
      <section className="confirmCard" onMouseDown={(event) => event.stopPropagation()}>
        <div className={confirmDialog.tone === "danger" ? "confirmIcon danger" : "confirmIcon"}>
          {confirmDialog.tone === "danger" ? "!" : "✓"}
        </div>
        <div>
          <h2>{confirmDialog.title}</h2>
          <p>{confirmDialog.message}</p>
        </div>
        <div className="confirmActions">
          <button className="ghostButton" onClick={() => closeConfirmDialog(false)}>
            {confirmDialog.cancelText ?? "Cancelar"}
          </button>
          <button
            className={confirmDialog.tone === "danger" ? "dangerConfirmButton" : "primaryButton"}
            onClick={() => closeConfirmDialog(true)}
          >
            {confirmDialog.confirmText ?? "Confirmar"}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  const restoreBackupDialog = restorePopupOpen ? (
    <div
      className="popupOverlay"
      onMouseDown={() => {
        setRestorePopupOpen(false);
        setRestorePassword("");
      }}
    >
      <section className="restoreDialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="detailHeader">
          <div>
            <span>Backup criptografado</span>
            <h2>Restaurar backup</h2>
          </div>
          <button
            className="iconButton"
            onClick={() => {
              setRestorePopupOpen(false);
              setRestorePassword("");
            }}
          >
            ×
          </button>
        </div>

        <p>
          Selecione um arquivo .kpvault e digite a senha mestra usada naquele backup.
          Sem essa senha, o backup não pode ser recuperado.
        </p>

        <label>
          Senha mestra do backup
          <input
            type="password"
            value={restorePassword}
            onChange={(event) => setRestorePassword(event.target.value)}
            placeholder="Senha usada no backup"
            autoFocus
          />
        </label>

        <label className="fileImportButton inlineFileButton">
          Selecionar backup .kpvault
          <input
            type="file"
            accept=".kpvault,application/json"
            onChange={(event) => {
              void handleBackupFileInput(event.target.files?.[0], restorePassword);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </section>
    </div>
  ) : null;

  if (mode === "loading") {
    return (
      <>
        <main className="authShell">
          <section className="authCard">
            <AppLogo size="lg" />
            <h1>KPassword</h1>
            <p>Carregando cofre local...</p>
          </section>
        </main>
        {confirmDialogElement}
        {restoreBackupDialog}
      </>
    );
  }

  if (mode === "setup") {
    return (
      <>
        <main className="authShell">
          <section className="authCard">
            <AppLogo size="lg" />
            <p className="eyebrow">Primeiro acesso</p>
            <h1>Crie sua senha mestra</h1>
            <p>
              O cofre será salvo somente neste computador. A senha mestra não será
              armazenada e não poderá ser recuperada.
            </p>

            <form onSubmit={handleCreateVault} className="authForm">
              <label>
                Senha mestra
                <input
                  type="password"
                  value={setupPassword}
                  onChange={(event) => setSetupPassword(event.target.value)}
                  placeholder="Mínimo 12 caracteres"
                  autoFocus
                />
              </label>

              <label>
                Confirmar senha mestra
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repita a senha"
                />
              </label>

              {setupPassword && (
                <div className="securityNotes">
                  {masterIssues.length === 0 ? (
                    <span>Senha mestra atende aos requisitos.</span>
                  ) : (
                    masterIssues.map((issue) => <span key={issue}>{issue}</span>)
                  )}
                </div>
              )}

              {message && <div className="message error">{message}</div>}

              <button disabled={busy} className="primaryButton">
                {busy ? "Criando cofre..." : "Criar cofre criptografado"}
              </button>
            </form>

            <button
              type="button"
              className="authTextButton"
              onClick={() => setRestorePopupOpen(true)}
            >
              Restaurar backup
            </button>
          </section>
        </main>
        {confirmDialogElement}
        {restoreBackupDialog}
      </>
    );
  }

  if (mode === "locked") {
    return (
      <>
        <main className="authShell">
          <section className="authCard">
            <AppLogo size="lg" />
            <p className="eyebrow">Cofre bloqueado</p>
            <h1>Desbloquear KPassword</h1>
            <p>
              Digite sua senha mestra. Ela será usada apenas para descriptografar o
              cofre local.
            </p>

            <form onSubmit={handleUnlock} className="authForm">
              <label>
                Senha mestra
                <input
                  type="password"
                  value={unlockPassword}
                  onChange={(event) => setUnlockPassword(event.target.value)}
                  placeholder="Digite sua senha mestra"
                  autoFocus
                />
              </label>

              {message && <div className="message error">{message}</div>}

              <button disabled={busy} className="primaryButton">
                {busy ? "Desbloqueando..." : "Desbloquear"}
              </button>
            </form>

            <button
              type="button"
              className="authTextButton"
              onClick={() => setRestorePopupOpen(true)}
            >
              Restaurar backup
            </button>
          </section>
        </main>
        {confirmDialogElement}
        {restoreBackupDialog}
      </>
    );
  }

  return (
    <main className={sidebarExpanded ? "appShell sidebarOpen" : "appShell sidebarClosed"}>
      <aside className="sidebar">
        <div className="sidebarBrand">
          <button
            className="sidebarToggle"
            onClick={() => setSidebarExpanded((current) => !current)}
            title={sidebarExpanded ? "Fechar menu lateral" : "Abrir menu lateral"}
            aria-label={sidebarExpanded ? "Fechar menu lateral" : "Abrir menu lateral"}
          >
            <AppLogo size="md" />
          </button>

          <div className="brandText">
            <strong>KPassword</strong>
            <span>Cofre local</span>
          </div>
        </div>

        <nav className="navList"><button
            className={screen === "credentials" ? "active" : ""}
            onClick={() => setScreen("credentials")}
            title="Credenciais"
            aria-label="Credenciais"
          >
            <span className="navIcon" aria-hidden="true">🔑</span>
            <span className="navLabel">Credenciais</span>
          </button>
          <button
            className={screen === "dashboard" ? "active" : ""}
            onClick={() => setScreen("dashboard")}
            title="Dashboard"
            aria-label="Dashboard"
          >
            <span className="navIcon" aria-hidden="true">📊</span>
            <span className="navLabel">Dashboard</span>
          </button>
          <button
            className={screen === "settings" ? "active" : ""}
            onClick={() => setScreen("settings")}
            title="Segurança & backup"
            aria-label="Segurança & backup"
          >
            <span className="navIcon" aria-hidden="true">🛡️</span>
            <span className="navLabel">Segurança & backup</span>
          </button>
          <button
            className={screen === "preferences" ? "active" : ""}
            onClick={() => setScreen("preferences")}
            title="Configurações"
            aria-label="Configurações"
          >
            <span className="navIcon" aria-hidden="true">⚙️</span>
            <span className="navLabel">Configurações</span>
          </button>
        </nav>

        <div className="sidebarFooter">
          <button className="lockButton" onClick={lockVault} title="Bloquear cofre" aria-label="Bloquear cofre">
            <span className="navIcon" aria-hidden="true">🔒</span>
            <span className="navLabel">Bloquear cofre</span>
          </button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="topbarTitle">
            <AppLogo size="md" />
            <div>
              <p className="eyebrow">Proteção local</p>
              <h1>
                {screen === "credentials" && "Credenciais"}
                {screen === "dashboard" && "Painel do cofre"}
                {screen === "settings" && "Segurança & backup"}
                {screen === "preferences" && "Configurações"}
              </h1>
            </div>
          </div>

          <button className="primaryButton" onClick={openNewCredentialForm}>
            Adicionar nova credencial
          </button>
        </header>

        {message && <div className="message success">{message}</div>}

        {screen === "credentials" && (
          <>
            <div className="toolbar">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar em nome, usuário, senha, site, categoria, favorito ou observação..."
              />
              <span>{filteredCredentials.length} resultado(s)</span>
            </div>

            <section className="credentialRows">
              {filteredCredentials.map((credential, index) => {
                const passwordScore = getPasswordScore(credential.password);
                const previousCredential = filteredCredentials[index - 1];
                const nextCredential = filteredCredentials[index + 1];
                const canMoveUp =
                  canReorderCredentials && previousCredential?.favorite === credential.favorite;
                const canMoveDown =
                  canReorderCredentials && nextCredential?.favorite === credential.favorite;

                return (
                  <article
                    className="credentialRow"
                    key={credential.id}
                    onClick={() => setDetailCredentialId(credential.id)}
                    title="Clique para ver detalhes. Use as setas para reorganizar."
                  >
                    <span className="reorderControls" aria-label="Reordenar credencial">
                      <button
                        type="button"
                        disabled={!canMoveUp}
                        title={canReorderCredentials ? "Subir credencial" : "Limpe a busca para reorganizar"}
                        onClick={(event) => {
                          stopAction(event);
                          void moveCredentialByOffset(credential.id, -1);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={!canMoveDown}
                        title={canReorderCredentials ? "Descer credencial" : "Limpe a busca para reorganizar"}
                        onClick={(event) => {
                          stopAction(event);
                          void moveCredentialByOffset(credential.id, 1);
                        }}
                      >
                        ↓
                      </button>
                    </span>
                    <span
                      className={credential.favorite ? "rowStar active" : "rowStar"}
                      onClick={(event) => {
                        stopAction(event);
                        void toggleFavorite(credential.id);
                      }}
                      title={credential.favorite ? "Remover favorito" : "Favoritar"}
                    >
                      ★
                    </span>

                    <span className="rowMain">
                      <strong>{credential.title}</strong>
                      <small>{credential.username || "Sem usuário"}</small>
                    </span>

                    <span className="rowPassword">{maskPassword(credential.password)}</span>

                    <span className="rowCategory">{credential.category}</span>

                    <span className="rowStrength">
                      {getPasswordLabel(passwordScore)} · {passwordScore}%
                    </span>

                    <span className="rowActions">
                      <button
                        type="button"
                        onClick={(event) => {
                          stopAction(event);
                          void copySecure(credential.username, `user-${credential.id}`);
                        }}
                      >
                        {copiedField === `user-${credential.id}` ? "Copiado" : "Copiar usuário"}
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          stopAction(event);
                          void copySecure(credential.password, `pass-${credential.id}`);
                        }}
                      >
                        {copiedField === `pass-${credential.id}` ? "Copiada" : "Copiar senha"}
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          stopAction(event);
                          openEditCredentialForm(credential);
                        }}
                      >
                        Editar
                      </button>
                    </span>
                  </article>
                );
              })}

              {filteredCredentials.length === 0 && (
                <div className="emptyState">
                  <h2>Nenhuma credencial encontrada</h2>
                  <p>Cadastre sua primeira credencial para iniciar o cofre.</p>
                  <button className="primaryButton" onClick={openNewCredentialForm}>
                    Adicionar nova credencial
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {screen === "dashboard" && (
          <div className="dashboardGrid">
            <article className="metricCard">
              <span>Total</span>
              <strong>{stats.total}</strong>
              <small>credenciais salvas</small>
            </article>
            <article className="metricCard">
              <span>Favoritas</span>
              <strong>{stats.favorites}</strong>
              <small>acesso rápido</small>
            </article>
            <article className="metricCard warning">
              <span>Fracas</span>
              <strong>{stats.weak}</strong>
              <small>merecem revisão</small>
            </article>
            <article className="metricCard warning">
              <span>Repetidas</span>
              <strong>{stats.repeated}</strong>
              <small>risco de reutilização</small>
            </article>

            <article className="wideCard">
              <h2>Como o KPassword está protegido</h2>
              <div className="securityGrid">
                <span>Criptografia AES-GCM 256-bit</span>
                <span>Derivação PBKDF2-SHA-256 com 450.000 iterações</span>
                <span>Salt individual de 32 bytes</span>
                <span>IV novo em cada salvamento</span>
                <span>Backups locais criptografados</span>
                <span>Bloqueio ao minimizar, fechar ou ficar inativo</span>
                <span>Clipboard atual limpo após 1 minuto</span>
                <span>Sem servidor, sem nuvem e sem telemetria</span>
              </div>
            </article>

            <article className="wideCard">
              <h2>Últimas credenciais</h2>
              <div className="miniList">
                {filteredCredentials.slice(0, 6).map((credential) => (
                  <button
                    key={credential.id}
                    onClick={() => {
                      setDetailCredentialId(credential.id);
                      setScreen("credentials");
                    }}
                  >
                    <strong>{credential.title}</strong>
                    <span>{credential.username || credential.category}</span>
                  </button>
                ))}

                {filteredCredentials.length === 0 && (
                  <p className="emptyText">Nenhuma credencial cadastrada ainda.</p>
                )}
              </div>
            </article>
          </div>
        )}

        {screen === "settings" && (
          <div className="settingsGrid">
            <article className="wideCard storageCard">
              <div className="cardTitleRow">
                <div>
                  <h2>Armazenamento local</h2>
                  <p>
                    Os caminhos do cofre e dos backups ficam ocultos por padrão para não expor
                    informações locais na tela.
                  </p>
                </div>

                <button
                  className="secondaryButton"
                  onClick={() => {
                    setShowStoragePaths(true);
                    window.setTimeout(() => setShowStoragePaths(false), 30000);
                  }}
                >
                  Mostrar por 30s
                </button>
              </div>

              {showStoragePaths ? (
                <div className="pathGrid">
                  <div className="pathBox">
                    <span>Cofre criptografado</span>
                    <strong>{storageInfo?.vault_path ?? "Carregando..."}</strong>
                  </div>
                  <div className="pathBox">
                    <span>Backups criptografados</span>
                    <strong>{storageInfo?.backup_dir ?? "Carregando..."}</strong>
                  </div>
                </div>
              ) : (
                <div className="hiddenPathsBox">
                  <strong>Caminhos ocultos</strong>
                  <span>Clique em “Mostrar por 30s” apenas quando precisar conferir o local dos arquivos.</span>
                </div>
              )}
            </article>

            <article className="wideCard">
              <h2>Backups automáticos</h2>
              <p>
                O KPassword cria snapshots criptografados do cofre. Mesmo que alguém
                acesse os arquivos, o conteúdo continua protegido pela senha mestra.
              </p>

              <div className="backupList">
                {backups.slice(0, 8).map((backup) => (
                  <div key={backup.filename}>
                    <strong>{backup.filename}</strong>
                    <span>
                      {formatDate(backup.modified_epoch_ms)} · {(backup.size_bytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ))}

                {backups.length === 0 && <p className="emptyText">Nenhum backup criado ainda.</p>}
              </div>

              <button
                className="secondaryButton"
                onClick={() => {
                  if (!vault) return;

                  void askConfirmation({
                    title: "Criar backup",
                    message: "Criar um novo backup criptografado agora?",
                    confirmText: "Criar backup",
                    cancelText: "Cancelar",
                  }).then((confirmed) => {
                    if (!confirmed) return;

                    void persistVault(vault)
                      .then(() => refreshStorageInfo())
                      .then(() => setMessage("Backup criptografado atualizado."))
                      .catch(() => setMessage("Erro ao criar backup."));
                  });
                }}
              >
                Criar backup agora
              </button>
            </article>

            <article className="wideCard securityActionCard">
              <h2>Senha mestra</h2>
              <p>
                Não existe recuperação da senha mestra atual. Se ela for perdida, o cofre e os backups criptografados não podem ser descriptografados. Troque a senha periodicamente e guarde-a em local seguro.
              </p>

              <form className="changePasswordForm" onSubmit={handleChangeMasterPassword}>
                <label>
                  Senha atual
                  <input
                    type="password"
                    value={currentMasterPassword}
                    onChange={(event) => setCurrentMasterPassword(event.target.value)}
                    placeholder="Digite a senha atual"
                  />
                </label>
                <label>
                  Nova senha mestra
                  <input
                    type="password"
                    value={newMasterPassword}
                    onChange={(event) => setNewMasterPassword(event.target.value)}
                    placeholder="Mínimo 12 caracteres"
                  />
                </label>
                <label>
                  Confirmar nova senha
                  <input
                    type="password"
                    value={newMasterConfirm}
                    onChange={(event) => setNewMasterConfirm(event.target.value)}
                    placeholder="Repita a nova senha"
                  />
                </label>

                {newMasterPassword && (
                  <div className="securityNotes inlineNotes">
                    {validateMasterPassword(newMasterPassword).length === 0 ? (
                      <span>Nova senha atende aos requisitos.</span>
                    ) : (
                      validateMasterPassword(newMasterPassword).map((issue) => <span key={issue}>{issue}</span>)
                    )}
                  </div>
                )}

                <button className="primaryButton" disabled={busy}>
                  Alterar senha mestra
                </button>
              </form>
            </article>

            <article className="wideCard securityActionCard">
              <h2>Importar backup</h2>
              <p>
                Importe um arquivo .kpvault para restaurar o cofre. O arquivo continua exigindo a senha mestra usada quando o backup foi criado.
              </p>

              <label className="fileImportButton inlineFileButton">
                Selecionar backup .kpvault
                <input
                  type="file"
                  accept=".kpvault,application/json"
                  onChange={(event) => {
                    void handleBackupFileInput(event.target.files?.[0], masterPassword);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </article>

            <article className="wideCard">
              <h2>Configurações de segurança</h2>
              <div className="securityGrid">
                <span>Bloqueio por inatividade: {vault?.settings.autoLockMinutes ?? 3} min</span>
                <span>Backup automático: a cada {vault?.settings.backupIntervalHours ?? 4}h</span>
                <span>Limpeza do Ctrl+V: {CLIPBOARD_CLEAR_SECONDS}s</span>
                <span>Win+V: histórico controlado pelo Windows</span>
                <span>Autostart com Windows: ativo</span>
                <span>Bandeja do sistema: ativa</span>
                <span>Instância única: ativa</span>
              </div>
            </article>
          </div>
        )}

        {screen === "preferences" && (
          <div className="preferencesGrid">
            <article className="wideCard preferenceCard">
              <h2>Tema</h2>
              <p>Escolha uma aparência confortável. As cores de fundo, textos, campos e containers mudam juntas.</p>

              <div className="optionGrid">
                <button
                  className={appTheme === "dark" ? "optionButton active" : "optionButton"}
                  onClick={() => setAppTheme("dark")}
                >
                  <span>🌙</span>
                  <strong>Escuro</strong>
                  <small>Menos brilho e mais contraste.</small>
                </button>

                <button
                  className={appTheme === "light" ? "optionButton active" : "optionButton"}
                  onClick={() => setAppTheme("light")}
                >
                  <span>☀️</span>
                  <strong>Claro</strong>
                  <small>Fundo claro com letras escuras.</small>
                </button>

                <button
                  className={appTheme === "mixed" ? "optionButton active" : "optionButton"}
                  onClick={() => setAppTheme("mixed")}
                >
                  <span>🌓</span>
                  <strong>Misto</strong>
                  <small>Menu escuro e conteúdo mais claro.</small>
                </button>
              </div>
            </article>

            <article className="wideCard preferenceCard">
              <h2>Acessibilidade</h2>
              <p>Ajustes visuais para deixar o uso mais confortável sem pesar o app.</p>

              <div className="toggleList">
                <label className="toggleRow">
                  <span>
                    <strong>Fonte maior</strong>
                    <small>Aumenta levemente textos, botões e campos.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={fontScale === "large"}
                    onChange={(event) => setFontScale(event.target.checked ? "large" : "normal")}
                  />
                </label>

                <label className="toggleRow">
                  <span>
                    <strong>Reduzir animações</strong>
                    <small>Diminui transições e efeitos visuais.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={reduceMotion}
                    onChange={(event) => setReduceMotion(event.target.checked)}
                  />
                </label>

                <label className="toggleRow">
                  <span>
                    <strong>Lista compacta</strong>
                    <small>Reduz a altura das linhas para caber mais credenciais.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={compactMode}
                    onChange={(event) => setCompactMode(event.target.checked)}
                  />
                </label>
              </div>
            </article>

            <article className="wideCard preferenceCard">
              <h2>Procurar por atualizações</h2>
              <p>
                Quando o GitHub Releases estiver configurado, o KPassword verificará a última versão oficial publicada.
              </p>

              <div className="updateSummary">
                <div>
                  <span>Versão instalada</span>
                  <strong>{APP_VERSION}</strong>
                </div>
                <div>
                  <span>Canal</span>
                  <strong>{UPDATE_GITHUB_OWNER && UPDATE_GITHUB_REPO ? "GitHub Releases" : "Não configurado"}</strong>
                </div>
              </div>

              <button className="secondaryButton" onClick={() => void handleCheckUpdates()}>
                Verificar atualização
              </button>

              {updateStatus && <div className="updateStatus">{updateStatus}</div>}
            </article>

            <article className="wideCard preferenceCard">
              <h2>Ações sensíveis</h2>
              <p>Use apenas se quiser voltar a aparência do app para o padrão inicial.</p>

              <button
                className="dangerConfirmButton"
                onClick={() => {
                  void askConfirmation({
                    title: "Restaurar aparência",
                    message:
                      "Restaurar tema, fonte, animações e densidade para o padrão? Isso não altera suas credenciais.",
                    confirmText: "Restaurar",
                    cancelText: "Cancelar",
                    tone: "danger",
                  }).then((confirmed) => {
                    if (!confirmed) return;

                    setAppTheme("dark");
                    setFontScale("normal");
                    setReduceMotion(false);
                    setCompactMode(false);
                    setMessage("Configurações visuais restauradas.");
                  });
                }}
              >
                Restaurar aparência padrão
              </button>
            </article>
          </div>
        )}


      </section>

      {detailCredential && (
        <div className="popupOverlay" onMouseDown={() => setDetailCredentialId(null)}>
          <aside className="detailPopup" onMouseDown={(event) => event.stopPropagation()}>
            <div className="detailHeader">
              <div>
                <span>{detailCredential.category}</span>
                <h2>{detailCredential.title}</h2>
              </div>
              <button className="iconButton" onClick={() => setDetailCredentialId(null)}>
                ×
              </button>
            </div>

            <div className="detailGrid">
              <div>
                <span>Usuário</span>
                <strong>{detailCredential.username || "—"}</strong>
              </div>

              <div>
                <span>Senha</span>
                <strong>
                  {visiblePasswords[detailCredential.id]
                    ? detailCredential.password
                    : maskPassword(detailCredential.password)}
                </strong>
              </div>

              <div>
                <span>Site</span>
                <strong>{detailCredential.url || "—"}</strong>
              </div>

              <div>
                <span>Força</span>
                <strong>
                  {getPasswordLabel(getPasswordScore(detailCredential.password))} ·{" "}
                  {getPasswordScore(detailCredential.password)}%
                </strong>
              </div>

              <div>
                <span>Criada em</span>
                <strong>{formatDate(detailCredential.createdAt)}</strong>
              </div>

              <div>
                <span>Atualizada em</span>
                <strong>{formatDate(detailCredential.updatedAt)}</strong>
              </div>
            </div>

            <div className="notesBox">
              <span>Observações</span>
              <p>{detailCredential.notes || "Nenhuma observação cadastrada."}</p>
            </div>

            <div className="detailActions">
              <button onClick={() => void copySecure(detailCredential.username, `user-${detailCredential.id}`)}>
                {copiedField === `user-${detailCredential.id}` ? "Usuário copiado" : "Copiar usuário"}
              </button>

              <button onClick={() => void copySecure(detailCredential.password, `pass-${detailCredential.id}`)}>
                {copiedField === `pass-${detailCredential.id}` ? "Senha copiada" : "Copiar senha"}
              </button>

              <button
                onClick={() =>
                  setVisiblePasswords((current) => ({
                    ...current,
                    [detailCredential.id]: !current[detailCredential.id],
                  }))
                }
              >
                {visiblePasswords[detailCredential.id] ? "Ocultar senha" : "Mostrar senha"}
              </button>

              <button onClick={() => void toggleFavorite(detailCredential.id)}>
                {detailCredential.favorite ? "Remover favorito" : "Favoritar"}
              </button>

              {detailCredential.url && (
                <button onClick={() => window.open(detailCredential.url, "_blank")}>
                  Abrir site
                </button>
              )}

              <button onClick={() => openEditCredentialForm(detailCredential)}>Editar</button>

              <button
                className="dangerButton"
                onClick={() => void handleDeleteCredential(detailCredential.id)}
              >
                Excluir
              </button>
            </div>
          </aside>
        </div>
      )}

      {formOpen && (
        <div className="modalOverlay" onMouseDown={() => setFormOpen(false)}>
          <form className="credentialModal" onSubmit={handleSaveCredential} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <p className="eyebrow">{editingId ? "Editar" : "Nova"}</p>
                <h2>{editingId ? "Editar credencial" : "Adicionar credencial"}</h2>
              </div>
              <button type="button" className="iconButton" onClick={() => setFormOpen(false)}>
                ×
              </button>
            </div>

            <div className="formGrid">
              <label>
                Nome
                <input
                  value={credentialForm.title}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Ex: Portal Kyndryl"
                  autoFocus
                />
              </label>

              <label>
                Categoria
                <select
                  value={credentialForm.category}
                  onChange={(event) =>
                    setCredentialForm((current) => ({
                      ...current,
                      category: event.target.value as CredentialCategory,
                    }))
                  }
                >
                  {CATEGORIES.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>

              <label>
                Usuário / e-mail
                <input
                  value={credentialForm.username}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, username: event.target.value }))
                  }
                  placeholder="usuario@email.com"
                />
              </label>

              <label>
                Site
                <input
                  value={credentialForm.url}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, url: event.target.value }))
                  }
                  placeholder="https://..."
                />
              </label>

              <label className="full">
                Senha
                <div className="passwordInput">
                  <input
                    value={credentialForm.password}
                    onChange={(event) =>
                      setCredentialForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    placeholder="Digite ou gere uma senha"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setCredentialForm((current) => ({
                        ...current,
                        password: generateStrongPassword(24),
                      }))
                    }
                  >
                    Gerar forte
                  </button>
                </div>
                <span className="strength">
                  Força: {getPasswordLabel(score)} · {score}%
                </span>
              </label>

              <label className="full">
                Observações
                <textarea
                  value={credentialForm.notes}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder="Notas protegidas dentro do cofre criptografado"
                />
              </label>

              <label className="checkRow full">
                <input
                  type="checkbox"
                  checked={credentialForm.favorite}
                  onChange={(event) =>
                    setCredentialForm((current) => ({
                      ...current,
                      favorite: event.target.checked,
                    }))
                  }
                />
                Marcar como favorita
              </label>
            </div>

            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setFormOpen(false)}>
                Cancelar
              </button>
              <button disabled={busy} className="primaryButton">
                {busy ? "Salvando..." : "Salvar credencial"}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmDialogElement}
      {restoreBackupDialog}
    </main>
  );
}


