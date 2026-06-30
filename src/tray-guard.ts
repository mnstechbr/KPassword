import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

const MINIMIZED_CHECK_INTERVAL_MS = 800;

type TrayReason = "minimized" | "closed" | "inactive";

let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let minimizedCheckTimer: ReturnType<typeof setInterval> | null = null;
let alreadySentToTray = false;
let notificationPermissionChecked = false;
let notificationAllowed = false;
let audioContext: AudioContext | null = null;
let audioUnlocked = false;

function getBooleanSetting(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "true";
  } catch {
    return fallback;
  }
}

function getNumberSetting(key: string, fallback: number, min: number, max: number) {
  try {
    const value = Number(localStorage.getItem(key));
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  } catch {
    return fallback;
  }
}

function getAutoLockLimitMs() {
  return getNumberSetting("kpassword:auto-lock-minutes", 3, 1, 120) * 60 * 1000;
}


function getNotificationBody(reason: TrayReason) {
  switch (reason) {
    case "minimized":
      return "KPassword foi minimizado e continua protegido na bandeja.";
    case "closed":
      return "KPassword continua em execução na bandeja.";
    case "inactive":
      return "KPassword ficou inativo por 3 minutos e foi enviado para a bandeja.";
    default:
      return "KPassword continua em execução na bandeja.";
  }
}

function getAudioContext() {
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  return audioContext;
}

async function unlockAudio() {
  if (audioUnlocked) {
    return;
  }

  const context = getAudioContext();

  if (!context) {
    return;
  }

  try {
    if (context.state === "suspended") {
      await context.resume();
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    gain.gain.setValueAtTime(0.0001, context.currentTime);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.01);

    audioUnlocked = true;
  } catch (error) {
    console.error("Erro ao liberar áudio do KPassword:", error);
  }
}

async function playMetroChime() {
  const context = getAudioContext();

  if (!context) {
    return;
  }

  try {
    if (context.state === "suspended") {
      await context.resume();
    }

    const now = context.currentTime;
    const notes = [
      { start: 0, duration: 0.11, frequency: 784 },
      { start: 0.15, duration: 0.11, frequency: 988 },
      { start: 0.3, duration: 0.2, frequency: 1318.5 },
    ];

    const masterGain = context.createGain();
    masterGain.gain.setValueAtTime(0.35, now);
    masterGain.connect(context.destination);

    notes.forEach((note) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, now + note.start);

      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(0.35, now + note.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);

      oscillator.connect(gain);
      gain.connect(masterGain);

      oscillator.start(now + note.start);
      oscillator.stop(now + note.start + note.duration + 0.03);
    });
  } catch (error) {
    console.error("Erro ao tocar som do KPassword:", error);
  }
}

async function ensureNotificationPermission() {
  if (notificationPermissionChecked) {
    return notificationAllowed;
  }

  notificationPermissionChecked = true;

  try {
    notificationAllowed = await isPermissionGranted();

    if (!notificationAllowed) {
      const permission = await requestPermission();
      notificationAllowed = permission === "granted";
    }
  } catch (error) {
    console.error("Erro ao verificar permissão de notificação:", error);
    notificationAllowed = false;
  }

  return notificationAllowed;
}

async function showTrayNotification(reason: TrayReason) {
  const allowed = await ensureNotificationPermission();

  if (!allowed) {
    return;
  }

  try {
    sendNotification({
      title: "KPassword",
      body: getNotificationBody(reason),
    });
  } catch (error) {
    console.error("Erro ao exibir notificação:", error);
  }
}

async function hideToTray(reason: TrayReason) {
  if (alreadySentToTray) {
    return;
  }

  alreadySentToTray = true;

  try {
    window.dispatchEvent(new CustomEvent("kpassword:lock"));
    if (getBooleanSetting("kpassword:tray-sound", true)) {
      await playMetroChime();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }

    await invoke("hide_to_tray", { reason });

    if (getBooleanSetting("kpassword:tray-notifications", true)) {
      await showTrayNotification(reason);
    }
  } catch (error) {
    console.error("Erro ao enviar KPassword para a bandeja:", error);
  }
}

function resetInactivityTimer() {
  alreadySentToTray = false;

  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }

  if (!getBooleanSetting("kpassword:lock-on-inactive", true)) {
    return;
  }

  inactivityTimer = setTimeout(() => {
    void hideToTray("inactive");
  }, getAutoLockLimitMs());
}

function startActivityListeners() {
  const events = [
    "mousemove",
    "mousedown",
    "keydown",
    "scroll",
    "touchstart",
    "click",
    "wheel",
  ];

  events.forEach((eventName) => {
    window.addEventListener(
      eventName,
      () => {
        void unlockAudio();
        resetInactivityTimer();
      },
      { passive: true },
    );
  });
}

async function startCloseProtection() {
  const appWindow = getCurrentWindow();

  await appWindow.onCloseRequested(async (event) => {
    if (!getBooleanSetting("kpassword:lock-on-close", true)) {
      return;
    }

    event.preventDefault();
    await hideToTray("closed");
  });
}

function startMinimizeProtection() {
  const appWindow = getCurrentWindow();
  let lockedForCurrentMinimize = false;

  if (minimizedCheckTimer) {
    clearInterval(minimizedCheckTimer);
  }

  minimizedCheckTimer = setInterval(() => {
    void (async () => {
      try {
        const minimized = await appWindow.isMinimized();

        if (!minimized) {
          lockedForCurrentMinimize = false;
          return;
        }

        if (lockedForCurrentMinimize || !getBooleanSetting("kpassword:lock-on-minimize", true)) {
          return;
        }

        lockedForCurrentMinimize = true;
        window.dispatchEvent(new CustomEvent("kpassword:lock"));
      } catch (error) {
        console.error("Erro ao verificar janela minimizada:", error);
      }
    })();
  }, MINIMIZED_CHECK_INTERVAL_MS);
}

async function startFocusProtection() {
  const appWindow = getCurrentWindow();

  await appWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      resetInactivityTimer();
    }
  });
}

export async function setupTrayGuard() {
  startActivityListeners();
  resetInactivityTimer();

  await startCloseProtection();
  startMinimizeProtection();
  await startFocusProtection();
}
