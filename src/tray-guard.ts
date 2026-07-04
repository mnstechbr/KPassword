import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type TrayReason = "inactive" | "minimize" | "close";

type TrayEventDetail = {
  reason?: TrayReason;
};

const TRAY_EVENT = "kpassword:protect-to-tray";
const DUPLICATE_GUARD_MS = 1_500;

let initialized = false;
let lastProtectionAt = 0;

function readFlag(key: string, fallback = true) {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "true";
  } catch {
    return fallback;
  }
}

function readLanguage() {
  try {
    return localStorage.getItem("kpassword:language") || "pt";
  } catch {
    return "pt";
  }
}

function getTrayMessage(reason: TrayReason) {
  const language = readLanguage();
  const messages = {
    pt: {
      title: "KPassword protegido",
      inactive: "Seu cofre foi bloqueado por inatividade e enviado para a bandeja.",
      minimize: "Seu cofre foi bloqueado e enviado para a bandeja.",
      close: "O KPassword continua protegido na bandeja.",
    },
    en: {
      title: "KPassword protected",
      inactive: "Your vault was locked after inactivity and sent to the tray.",
      minimize: "Your vault was locked and sent to the tray.",
      close: "KPassword is still protected in the tray.",
    },
    es: {
      title: "KPassword protegido",
      inactive: "Tu cofre se bloqueó por inactividad y se envió a la bandeja.",
      minimize: "Tu cofre se bloqueó y se envió a la bandeja.",
      close: "KPassword sigue protegido en la bandeja.",
    },
    tr: {
      title: "KPassword korundu",
      inactive: "Kasanız etkinlik olmadığı için kilitlendi ve tepsiye gönderildi.",
      minimize: "Kasanız kilitlendi ve tepsiye gönderildi.",
      close: "KPassword tepside korunmaya devam ediyor.",
    },
  } as const;

  const dictionary = messages[language as keyof typeof messages] ?? messages.pt;

  return {
    title: dictionary.title,
    body: dictionary[reason],
  };
}

async function playProtectionSound() {
  if (!readFlag("kpassword:tray-sound", true)) return;

  try {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = new AudioContextCtor();
    const masterGain = context.createGain();
    const compressor = context.createDynamicsCompressor();

    masterGain.gain.setValueAtTime(0.0001, context.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.92, context.currentTime + 0.018);
    masterGain.gain.setValueAtTime(0.82, context.currentTime + 0.26);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.62);

    compressor.threshold.setValueAtTime(-18, context.currentTime);
    compressor.knee.setValueAtTime(12, context.currentTime);
    compressor.ratio.setValueAtTime(4, context.currentTime);
    compressor.attack.setValueAtTime(0.003, context.currentTime);
    compressor.release.setValueAtTime(0.18, context.currentTime);

    const tones = [
      { frequency: 1320, type: "triangle" as OscillatorType, delay: 0 },
      { frequency: 990, type: "square" as OscillatorType, delay: 0.08 },
    ];

    tones.forEach((tone) => {
      const oscillator = context.createOscillator();
      const toneGain = context.createGain();
      const startAt = context.currentTime + tone.delay;
      const stopAt = startAt + 0.42;

      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(tone.frequency * 0.74, stopAt);

      toneGain.gain.setValueAtTime(0.0001, startAt);
      toneGain.gain.exponentialRampToValueAtTime(tone.type === "square" ? 0.22 : 0.58, startAt + 0.02);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

      oscillator.connect(toneGain);
      toneGain.connect(masterGain);
      oscillator.start(startAt);
      oscillator.stop(stopAt);
    });

    masterGain.connect(compressor);
    compressor.connect(context.destination);

    window.setTimeout(() => {
      void context.close().catch(() => undefined);
    }, 760);
  } catch {
    // O som é opcional. Falhas de áudio não devem interromper a proteção.
  }
}

async function protectToTray(reason: TrayReason) {
  const now = Date.now();
  if (now - lastProtectionAt < DUPLICATE_GUARD_MS) return;
  lastProtectionAt = now;

  const shouldNotify = readFlag("kpassword:tray-notifications", true);
  const message = getTrayMessage(reason);

  await playProtectionSound();

  try {
    await invoke("hide_to_tray", {
      reason,
      notify: shouldNotify,
      notificationTitle: message.title,
      notificationBody: message.body,
    });
  } catch {
    // Se a chamada nativa falhar, a janela continua aberta em vez de perder estado.
  }
}

export async function setupTrayGuard() {
  if (initialized) return;
  initialized = true;

  const appWindow = getCurrentWindow();

  const onProtectToTray = (event: Event) => {
    const reason = ((event as CustomEvent<TrayEventDetail>).detail?.reason ?? "minimize") as TrayReason;
    void protectToTray(reason);
  };

  window.addEventListener(TRAY_EVENT, onProtectToTray);

  await appWindow.onCloseRequested(async (event) => {
    if (!readFlag("kpassword:lock-on-close", true)) return;

    event.preventDefault();
    window.dispatchEvent(new CustomEvent("kpassword:lock"));
    await protectToTray("close");
  });
}
