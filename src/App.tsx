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
import {
  LANGUAGES,
  getCategoryLabel,
  getDateLocale,
  getInitialLanguage,
  translate,
  translatePasswordLabel,
  translateValidationIssue,
  type AppLanguage,
} from "./i18n";

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
const APP_VERSION = "0.3.2";
const UPDATE_GITHUB_OWNER = "mnstechbr";
const UPDATE_GITHUB_REPO = "KPassword";
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

function formatDate(value?: string | number, language: AppLanguage = "pt") {
  if (!value) return "—";

  return new Intl.DateTimeFormat(getDateLocale(language), {
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

function LanguageSelector({
  language,
  onChange,
  label,
  compact = false,
}: {
  language: AppLanguage;
  onChange: (language: AppLanguage) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "languageSelect compact" : "languageSelect"}>
      <span>{compact ? "🌐" : label}</span>
      <select
        value={language}
        aria-label={label}
        onChange={(event) => onChange(event.target.value as AppLanguage)}
      >
        {LANGUAGES.map((item) => (
          <option key={item.code} value={item.code}>
            {compact ? item.shortLabel : item.label}
          </option>
        ))}
      </select>
    </label>
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
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(getInitialLanguage);

  const t = useCallback(
    (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
      translate(appLanguage, key, values),
    [appLanguage],
  );


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
    document.documentElement.lang = appLanguage;
    localStorage.setItem("kpassword:language", appLanguage);
  }, [appLanguage]);

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
        setMessage(t("errors.loadVault"));
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
        throw new Error(t("errors.masterPasswordUnavailable"));
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
      setMessage(t("errors.confirmPasswordMismatch"));
      return;
    }

    const confirmed = await askConfirmation({
      title: t("dialog.createVaultTitle"),
      message:
        t("dialog.createVaultMessage"),
      confirmText: t("dialog.createVaultConfirm"),
      cancelText: t("dialog.cancel"),
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
      setMessage(t("errors.createVault"));
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
      setMessage(t("errors.unlock"));
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
      title: t("dialog.reviewMasterTitle"),
      message:
        t("dialog.reviewMasterMessage"),
      confirmText: t("dialog.openSecurity"),
      cancelText: t("dialog.remindLater"),
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
      setMessage(t("errors.currentPasswordRequired"));
      return;
    }

    const issues = validateMasterPassword(newMasterPassword);

    if (issues.length > 0) {
      setMessage(issues.join(" "));
      return;
    }

    if (newMasterPassword !== newMasterConfirm) {
      setMessage(t("errors.newPasswordMismatch"));
      return;
    }

    const confirmed = await askConfirmation({
      title: t("dialog.changeMasterTitle"),
      message:
        t("dialog.changeMasterMessage"),
      confirmText: t("dialog.changeMasterConfirm"),
      cancelText: t("dialog.cancel"),
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
      setMessage(t("success.masterPasswordChanged"));
    } catch (error) {
      console.error(error);
      setMessage(t("errors.changeMaster"));
    } finally {
      setBusy(false);
    }
  }

  async function restoreBackupFromText(raw: string, password: string) {
    if (!password) {
      setMessage(t("errors.backupPasswordRequired"));
      return;
    }

    setMessage("");

    try {
      const parsed = parseEncryptedVault(raw);
      const restoredVault = normalizeVault(await decryptVault(parsed, password));

      const confirmed = await askConfirmation({
        title: t("dialog.restoreBackupTitle"),
        message:
          t("dialog.restoreBackupMessage"),
        confirmText: t("dialog.restoreBackupTitle"),
        cancelText: t("dialog.cancel"),
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
      setMessage(t("success.backupRestored"));
    } catch (error) {
      console.error(error);
      setMessage(t("errors.restoreBackup"));
    }
  }

  async function handleBackupFileInput(file: File | undefined | null, password: string) {
    if (!file) return;

    const raw = await file.text();
    await restoreBackupFromText(raw, password);
  }

  async function handleCheckUpdates() {
    setUpdateStatus(t("updates.checking"));

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");

      const update = await check();

      if (!update) {
        setUpdateStatus(t("updates.none", { version: APP_VERSION }));
        return;
      }

      setUpdateStatus(t("updates.found", { version: update.version }));

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setUpdateStatus(t("updates.started"));
          return;
        }

        if (event.event === "Progress") {
          const loaded = "data" in event && typeof event.data === "object" && event.data && "chunkLength" in event.data
            ? Number(event.data.chunkLength)
            : 0;

          if (loaded > 0) {
            setUpdateStatus(t("updates.progress"));
          }
          return;
        }

        if (event.event === "Finished") {
          setUpdateStatus(t("updates.finished"));
        }
      });

      setUpdateStatus(t("updates.restarting"));
      await relaunch();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setUpdateStatus(t("updates.error", { detail }));
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
      setMessage(t("errors.credentialNameRequired"));
      return;
    }

    if (!credentialForm.password.trim()) {
      setMessage(t("errors.credentialPasswordRequired"));
      return;
    }

    const confirmed = await askConfirmation({
      title: editingId ? t("dialog.saveEditTitle") : t("dialog.createCredentialTitle"),
      message: editingId
        ? t("dialog.saveEditMessage")
        : t("dialog.createCredentialMessage"),
      confirmText: editingId ? t("dialog.saveEditTitle") : t("dialog.createCredentialTitle"),
      cancelText: t("dialog.cancel"),
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
      setMessage(editingId ? t("success.credentialUpdated") : t("success.credentialCreated"));
    } catch (error) {
      console.error(error);
      setMessage(t("errors.saveCredential"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCredential(id: string) {
    if (!vault) return;

    const target = vault.credentials.find((credential) => credential.id === id);
    const confirmed = await askConfirmation({
      title: t("dialog.deleteCredentialTitle"),
      message: t("dialog.deleteCredentialMessage", { title: target?.title ?? t("dialog.selectedCredential") }),
      confirmText: t("dialog.delete"),
      cancelText: t("dialog.cancel"),
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

      setMessage(t("success.credentialDeleted"));
    } catch (error) {
      console.error(error);
      setMessage(t("errors.deleteCredential"));
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
            {confirmDialog.cancelText ?? t("dialog.cancel")}
          </button>
          <button
            className={confirmDialog.tone === "danger" ? "dangerConfirmButton" : "primaryButton"}
            onClick={() => closeConfirmDialog(true)}
          >
            {confirmDialog.confirmText ?? t("dialog.confirm")}
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
            <span>{t("restore.encryptedBackup")}</span>
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

        <p>{t("restore.description")}</p>

        <label>
          {t("restore.backupPassword")}
          <input
            type="password"
            value={restorePassword}
            onChange={(event) => setRestorePassword(event.target.value)}
            placeholder={t("restore.backupPasswordPlaceholder")}
            autoFocus
          />
        </label>

        <label className="fileImportButton inlineFileButton">
          {t("settings.selectBackup")}
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
            <div className="authLanguageRow">
              <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} compact />
            </div>
            <AppLogo size="lg" />
            <h1>KPassword</h1>
            <p>{t("status.loadingVault")}</p>
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
            <div className="authLanguageRow">
              <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} compact />
            </div>
            <AppLogo size="lg" />
            <p className="eyebrow">{t("auth.firstAccess")}</p>
            <h1>{t("auth.createMasterTitle")}</h1>
            <p>{t("auth.createMasterDescription")}</p>

            <form onSubmit={handleCreateVault} className="authForm">
              <label>
                {t("auth.masterPassword")}
                <input
                  type="password"
                  value={setupPassword}
                  onChange={(event) => setSetupPassword(event.target.value)}
                  placeholder={t("auth.masterPlaceholder")}
                  autoFocus
                />
              </label>

              <label>
                {t("auth.confirmMasterPassword")}
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder={t("auth.repeatPassword")}
                />
              </label>

              {setupPassword && (
                <div className="securityNotes">
                  {masterIssues.length === 0 ? (
                    <span>{t("auth.validMasterPassword")}</span>
                  ) : (
                    masterIssues.map((issue) => <span key={issue}>{translateValidationIssue(issue, appLanguage)}</span>)
                  )}
                </div>
              )}

              {message && <div className="message error">{message}</div>}

              <button disabled={busy} className="primaryButton">
                {busy ? t("auth.creatingVault") : t("auth.createEncryptedVault")}
              </button>
            </form>

            <button
              type="button"
              className="authTextButton"
              onClick={() => setRestorePopupOpen(true)}
            >
              {t("auth.restoreBackup")}
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
            <div className="authLanguageRow">
              <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} compact />
            </div>
            <AppLogo size="lg" />
            <p className="eyebrow">{t("auth.vaultLocked")}</p>
            <h1>{t("auth.unlockTitle")}</h1>
            <p>{t("auth.unlockDescription")}</p>

            <form onSubmit={handleUnlock} className="authForm">
              <label>
                {t("auth.masterPassword")}
                <input
                  type="password"
                  value={unlockPassword}
                  onChange={(event) => setUnlockPassword(event.target.value)}
                  placeholder={t("auth.unlockPlaceholder")}
                  autoFocus
                />
              </label>

              {message && <div className="message error">{message}</div>}

              <button disabled={busy} className="primaryButton">
                {busy ? t("auth.unlocking") : t("auth.unlock")}
              </button>
            </form>

            <button
              type="button"
              className="authTextButton"
              onClick={() => setRestorePopupOpen(true)}
            >
              {t("auth.restoreBackup")}
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
            title={sidebarExpanded ? t("nav.closeSidebar") : t("nav.openSidebar")}
            aria-label={sidebarExpanded ? t("nav.closeSidebar") : t("nav.openSidebar")}
          >
            <AppLogo size="md" />
          </button>

          <div className="brandText">
            <strong>KPassword</strong>
            <span>{t("app.localVault")}</span>
          </div>
        </div>

        <nav className="navList"><button
            className={screen === "credentials" ? "active" : ""}
            onClick={() => setScreen("credentials")}
            title={t("nav.credentials")}
            aria-label={t("nav.credentials")}
          >
            <span className="navIcon" aria-hidden="true">🔑</span>
            <span className="navLabel">{t("nav.credentials")}</span>
          </button>
          <button
            className={screen === "dashboard" ? "active" : ""}
            onClick={() => setScreen("dashboard")}
            title={t("nav.dashboard")}
            aria-label={t("nav.dashboard")}
          >
            <span className="navIcon" aria-hidden="true">📊</span>
            <span className="navLabel">{t("nav.dashboard")}</span>
          </button>
          <button
            className={screen === "settings" ? "active" : ""}
            onClick={() => setScreen("settings")}
            title={t("nav.securityBackup")}
            aria-label={t("nav.securityBackup")}
          >
            <span className="navIcon" aria-hidden="true">🛡️</span>
            <span className="navLabel">{t("nav.securityBackup")}</span>
          </button>
          <button
            className={screen === "preferences" ? "active" : ""}
            onClick={() => setScreen("preferences")}
            title={t("nav.preferences")}
            aria-label={t("nav.preferences")}
          >
            <span className="navIcon" aria-hidden="true">⚙️</span>
            <span className="navLabel">{t("nav.preferences")}</span>
          </button>
        </nav>

        <div className="sidebarFooter">
          <button className="lockButton" onClick={lockVault} title={t("nav.lockVault")} aria-label={t("nav.lockVault")}>
            <span className="navIcon" aria-hidden="true">🔒</span>
            <span className="navLabel">{t("nav.lockVault")}</span>
          </button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="topbarTitle">
            <AppLogo size="md" />
            <div>
              <p className="eyebrow">{t("topbar.localProtection")}</p>
              <h1>
                {screen === "credentials" && t("nav.credentials")}
                {screen === "dashboard" && t("topbar.vaultDashboard")}
                {screen === "settings" && t("nav.securityBackup")}
                {screen === "preferences" && t("nav.preferences")}
              </h1>
            </div>
          </div>

          <div className="topbarActions">
            <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} compact />
            <button className="primaryButton" onClick={openNewCredentialForm}>
              {t("topbar.addCredential")}
            </button>
          </div>
        </header>

        {message && <div className="message success">{message}</div>}

        {screen === "credentials" && (
          <>
            <div className="toolbar">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("search.placeholder")}
              />
              <span>{t("search.results", { count: filteredCredentials.length })}</span>
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
                    <span className="reorderControls" aria-label={t("credential.reorder")}>
                      <button
                        type="button"
                        disabled={!canMoveUp}
                        title={canReorderCredentials ? t("credential.moveUp") : t("credential.clearSearchToReorder")}
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
                        title={canReorderCredentials ? t("credential.moveDown") : t("credential.clearSearchToReorder")}
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
                      title={credential.favorite ? t("credential.removeFavorite") : t("credential.favorite")}
                    >
                      ★
                    </span>

                    <span className="rowMain">
                      <strong>{credential.title}</strong>
                      <small>{credential.username || t("credential.noUser")}</small>
                    </span>

                    <span className="rowPassword">{maskPassword(credential.password)}</span>

                    <span className="rowCategory">{getCategoryLabel(credential.category, appLanguage)}</span>

                    <span className="rowStrength">
                      {translatePasswordLabel(getPasswordLabel(passwordScore), appLanguage)} · {passwordScore}%
                    </span>

                    <span className="rowActions">
                      <button
                        type="button"
                        onClick={(event) => {
                          stopAction(event);
                          void copySecure(credential.username, `user-${credential.id}`);
                        }}
                      >
                        {copiedField === `user-${credential.id}` ? t("credential.copied") : t("credential.copyUser")}
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          stopAction(event);
                          void copySecure(credential.password, `pass-${credential.id}`);
                        }}
                      >
                        {copiedField === `pass-${credential.id}` ? t("credential.copiedFemale") : t("credential.copyPassword")}
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          stopAction(event);
                          openEditCredentialForm(credential);
                        }}
                      >
                        {t("credential.edit")}
                      </button>
                    </span>
                  </article>
                );
              })}

              {filteredCredentials.length === 0 && (
                <div className="emptyState">
                  <h2>{t("credential.emptyTitle")}</h2>
                  <p>{t("credential.emptyDescription")}</p>
                  <button className="primaryButton" onClick={openNewCredentialForm}>
                    {t("topbar.addCredential")}
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {screen === "dashboard" && (
          <div className="dashboardGrid">
            <article className="metricCard">
              <span>{t("dashboard.total")}</span>
              <strong>{stats.total}</strong>
              <small>{t("dashboard.savedCredentials")}</small>
            </article>
            <article className="metricCard">
              <span>{t("dashboard.favorites")}</span>
              <strong>{stats.favorites}</strong>
              <small>{t("dashboard.quickAccess")}</small>
            </article>
            <article className="metricCard warning">
              <span>{t("dashboard.weak")}</span>
              <strong>{stats.weak}</strong>
              <small>{t("dashboard.reviewNeeded")}</small>
            </article>
            <article className="metricCard warning">
              <span>{t("dashboard.repeated")}</span>
              <strong>{stats.repeated}</strong>
              <small>{t("dashboard.reuseRisk")}</small>
            </article>

            <article className="wideCard">
              <h2>{t("dashboard.protectionTitle")}</h2>
              <div className="securityGrid">
                <span>{t("security.aes")}</span>
                <span>{t("security.pbkdf2")}</span>
                <span>{t("security.salt")}</span>
                <span>{t("security.iv")}</span>
                <span>{t("security.encryptedBackups")}</span>
                <span>{t("security.autolock")}</span>
                <span>{t("security.clipboard")}</span>
                <span>{t("security.offline")}</span>
              </div>
            </article>

            <article className="wideCard">
              <h2>{t("dashboard.latestCredentials")}</h2>
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
                  <p className="emptyText">{t("dashboard.noCredentials")}</p>
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
                  <h2>{t("settings.localStorage")}</h2>
                  <p>{t("settings.localStorageDescription")}</p>
                </div>

                <button
                  className="secondaryButton"
                  onClick={() => {
                    setShowStoragePaths(true);
                    window.setTimeout(() => setShowStoragePaths(false), 30000);
                  }}
                >
                  {t("settings.show30s")}
                </button>
              </div>

              {showStoragePaths ? (
                <div className="pathGrid">
                  <div className="pathBox">
                    <span>{t("settings.encryptedVault")}</span>
                    <strong>{storageInfo?.vault_path ?? t("settings.loading")}</strong>
                  </div>
                  <div className="pathBox">
                    <span>{t("settings.encryptedBackups")}</span>
                    <strong>{storageInfo?.backup_dir ?? t("settings.loading")}</strong>
                  </div>
                </div>
              ) : (
                <div className="hiddenPathsBox">
                  <strong>{t("settings.hiddenPaths")}</strong>
                  <span>{t("settings.hiddenPathsDescription")}</span>
                </div>
              )}
            </article>

            <article className="wideCard">
              <h2>{t("settings.autoBackups")}</h2>
              <p>{t("settings.autoBackupsDescription")}</p>

              <div className="backupList">
                {backups.slice(0, 8).map((backup) => (
                  <div key={backup.filename}>
                    <strong>{backup.filename}</strong>
                    <span>
                      {formatDate(backup.modified_epoch_ms)} · {(backup.size_bytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ))}

                {backups.length === 0 && <p className="emptyText">{t("settings.noBackups")}</p>}
              </div>

              <button
                className="secondaryButton"
                onClick={() => {
                  if (!vault) return;

                  void askConfirmation({
                    title: "Criar backup",
                    message: "Criar um novo backup criptografado agora?",
                    confirmText: "Criar backup",
                    cancelText: t("dialog.cancel"),
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
              <h2>{t("settings.masterPasswordTitle")}</h2>
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
                    placeholder={t("auth.masterPlaceholder")}
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
                      <span>{t("settings.newPasswordValid")}</span>
                    ) : (
                      validateMasterPassword(newMasterPassword).map((issue) => <span key={issue}>{translateValidationIssue(issue, appLanguage)}</span>)
                    )}
                  </div>
                )}

                <button className="primaryButton" disabled={busy}>
                  Alterar senha mestra
                </button>
              </form>
            </article>

            <article className="wideCard securityActionCard">
              <h2>{t("settings.importBackup")}</h2>
              <p>
                Importe um arquivo .kpvault para restaurar o cofre. O arquivo continua exigindo a senha mestra usada quando o backup foi criado.
              </p>

              <label className="fileImportButton inlineFileButton">
                {t("settings.selectBackup")}
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
              <h2>{t("settings.securitySettings")}</h2>
              <div className="securityGrid">
                <span>{t("settings.autoLockMinutes", { minutes: vault?.settings.autoLockMinutes ?? 3 })}</span>
                <span>{t("settings.backupEvery", { hours: vault?.settings.backupIntervalHours ?? 4 })}</span>
                <span>{t("settings.ctrlVClear", { seconds: CLIPBOARD_CLEAR_SECONDS })}</span>
                <span>{t("settings.winV")}</span>
                <span>{t("settings.autostart")}</span>
                <span>{t("settings.tray")}</span>
                <span>{t("settings.singleInstance")}</span>
              </div>
            </article>
          </div>
        )}

        {screen === "preferences" && (
          <div className="preferencesGrid">
            <article className="wideCard preferenceCard">
              <h2>{t("language.title")}</h2>
              <p>{t("language.description")}</p>
              <div className="languagePreferenceBox">
                <span>{t("language.current")}</span>
                <LanguageSelector language={appLanguage} onChange={setAppLanguage} label={t("language.select")} />
              </div>
            </article>

            <article className="wideCard preferenceCard">
              <h2>{t("preferences.theme")}</h2>
              <p>{t("preferences.themeDescription")}</p>

              <div className="optionGrid">
                <button
                  className={appTheme === "dark" ? "optionButton active" : "optionButton"}
                  onClick={() => setAppTheme("dark")}
                >
                  <span>🌙</span>
                  <strong>{t("preferences.dark")}</strong>
                  <small>{t("preferences.darkDescription")}</small>
                </button>

                <button
                  className={appTheme === "light" ? "optionButton active" : "optionButton"}
                  onClick={() => setAppTheme("light")}
                >
                  <span>☀️</span>
                  <strong>{t("preferences.light")}</strong>
                  <small>{t("preferences.lightDescription")}</small>
                </button>

                <button
                  className={appTheme === "mixed" ? "optionButton active" : "optionButton"}
                  onClick={() => setAppTheme("mixed")}
                >
                  <span>🌓</span>
                  <strong>{t("preferences.mixed")}</strong>
                  <small>{t("preferences.mixedDescription")}</small>
                </button>
              </div>
            </article>

            <article className="wideCard preferenceCard">
              <h2>{t("preferences.accessibility")}</h2>
              <p>{t("preferences.accessibilityDescription")}</p>

              <div className="toggleList">
                <label className="toggleRow">
                  <span>
                    <strong>{t("preferences.largeFont")}</strong>
                    <small>{t("preferences.largeFontDescription")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={fontScale === "large"}
                    onChange={(event) => setFontScale(event.target.checked ? "large" : "normal")}
                  />
                </label>

                <label className="toggleRow">
                  <span>
                    <strong>{t("preferences.reduceMotion")}</strong>
                    <small>{t("preferences.reduceMotionDescription")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={reduceMotion}
                    onChange={(event) => setReduceMotion(event.target.checked)}
                  />
                </label>

                <label className="toggleRow">
                  <span>
                    <strong>{t("preferences.compactList")}</strong>
                    <small>{t("preferences.compactListDescription")}</small>
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
              <h2>{t("preferences.updates")}</h2>
              <p>{t("preferences.updatesDescription")}</p>

              <div className="updateSummary">
                <div>
                  <span>{t("preferences.installedVersion")}</span>
                  <strong>{APP_VERSION}</strong>
                </div>
                <div>
                  <span>{t("preferences.channel")}</span>
                  <strong>{UPDATE_GITHUB_OWNER && UPDATE_GITHUB_REPO ? t("preferences.githubReleases") : t("preferences.notConfigured")}</strong>
                </div>
              </div>

              <button className="secondaryButton" onClick={() => void handleCheckUpdates()}>
                {t("preferences.checkUpdate")}
              </button>

              {updateStatus && <div className="updateStatus">{updateStatus}</div>}
            </article>

            <article className="wideCard preferenceCard">
              <h2>{t("preferences.sensitiveActions")}</h2>
              <p>{t("preferences.sensitiveActionsDescription")}</p>

              <button
                className="dangerConfirmButton"
                onClick={() => {
                  void askConfirmation({
                    title: t("dialog.restoreAppearanceTitle"),
                    message: t("dialog.restoreAppearanceMessage"),
                    confirmText: t("dialog.restore"),
                    cancelText: t("dialog.cancel"),
                    tone: "danger",
                  }).then((confirmed) => {
                    if (!confirmed) return;

                    setAppTheme("dark");
                    setFontScale("normal");
                    setReduceMotion(false);
                    setCompactMode(false);
                    setMessage(t("success.appearanceRestored"));
                  });
                }}
              >
                {t("preferences.restoreAppearance")}
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
                <span>{t("detail.user")}</span>
                <strong>{detailCredential.username || "—"}</strong>
              </div>

              <div>
                <span>{t("detail.password")}</span>
                <strong>
                  {visiblePasswords[detailCredential.id]
                    ? detailCredential.password
                    : maskPassword(detailCredential.password)}
                </strong>
              </div>

              <div>
                <span>{t("detail.site")}</span>
                <strong>{detailCredential.url || "—"}</strong>
              </div>

              <div>
                <span>{t("detail.strength")}</span>
                <strong>
                  {translatePasswordLabel(getPasswordLabel(getPasswordScore(detailCredential.password)), appLanguage)} ·{" "}
                  {getPasswordScore(detailCredential.password)}%
                </strong>
              </div>

              <div>
                <span>{t("detail.createdAt")}</span>
                <strong>{formatDate(detailCredential.createdAt, appLanguage)}</strong>
              </div>

              <div>
                <span>{t("detail.updatedAt")}</span>
                <strong>{formatDate(detailCredential.updatedAt, appLanguage)}</strong>
              </div>
            </div>

            <div className="notesBox">
              <span>{t("detail.notes")}</span>
              <p>{detailCredential.notes || t("detail.noNotes")}</p>
            </div>

            <div className="detailActions">
              <button onClick={() => void copySecure(detailCredential.username, `user-${detailCredential.id}`)}>
                {copiedField === `user-${detailCredential.id}` ? t("credential.userCopied") : t("credential.copyUser")}
              </button>

              <button onClick={() => void copySecure(detailCredential.password, `pass-${detailCredential.id}`)}>
                {copiedField === `pass-${detailCredential.id}` ? t("credential.passwordCopied") : t("credential.copyPassword")}
              </button>

              <button
                onClick={() =>
                  setVisiblePasswords((current) => ({
                    ...current,
                    [detailCredential.id]: !current[detailCredential.id],
                  }))
                }
              >
                {visiblePasswords[detailCredential.id] ? t("credential.hidePassword") : t("credential.showPassword")}
              </button>

              <button onClick={() => void toggleFavorite(detailCredential.id)}>
                {detailCredential.favorite ? t("credential.removeFavorite") : t("credential.favorite")}
              </button>

              {detailCredential.url && (
                <button onClick={() => window.open(detailCredential.url, "_blank")}>
                  {t("credential.openSite")}
                </button>
              )}

              <button onClick={() => openEditCredentialForm(detailCredential)}>{t("credential.edit")}</button>

              <button
                className="dangerButton"
                onClick={() => void handleDeleteCredential(detailCredential.id)}
              >
                {t("credential.delete")}
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
                <p className="eyebrow">{editingId ? t("form.editing") : t("form.new")}</p>
                <h2>{editingId ? t("form.editCredential") : t("form.addCredential")}</h2>
              </div>
              <button type="button" className="iconButton" onClick={() => setFormOpen(false)}>
                ×
              </button>
            </div>

            <div className="formGrid">
              <label>
                {t("form.name")}
                <input
                  value={credentialForm.title}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder={t("form.namePlaceholder")}
                  autoFocus
                />
              </label>

              <label>
                {t("form.category")}
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
                    <option key={category} value={category}>{getCategoryLabel(category, appLanguage)}</option>
                  ))}
                </select>
              </label>

              <label>
                {t("form.userEmail")}
                <input
                  value={credentialForm.username}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, username: event.target.value }))
                  }
                  placeholder="usuario@email.com"
                />
              </label>

              <label>
                {t("form.site")}
                <input
                  value={credentialForm.url}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, url: event.target.value }))
                  }
                  placeholder="https://..."
                />
              </label>

              <label className="full">
                {t("form.password")}
                <div className="passwordInput">
                  <input
                    value={credentialForm.password}
                    onChange={(event) =>
                      setCredentialForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    placeholder={t("form.passwordPlaceholder")}
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
                    {t("form.generateStrong")}
                  </button>
                </div>
                <span className="strength">
                  {t("form.strength", { label: translatePasswordLabel(getPasswordLabel(score), appLanguage), score })}
                </span>
              </label>

              <label className="full">
                Observações
                <textarea
                  value={credentialForm.notes}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder={t("form.notesPlaceholder")}
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
                {t("form.markFavorite")}
              </label>
            </div>

            <div className="modalActions">
              <button type="button" className="ghostButton" onClick={() => setFormOpen(false)}>
                Cancelar
              </button>
              <button disabled={busy} className="primaryButton">
                {busy ? t("form.saving") : t("form.saveCredential")}
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


