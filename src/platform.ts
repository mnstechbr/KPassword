import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage } from "./i18n";

export async function writeClipboard(value: string, linux: boolean) {
  if (linux) await invoke("linux_clipboard", { value });
  else await navigator.clipboard.writeText(value);
}

export async function readClipboard(linux: boolean): Promise<string> {
  return linux ? invoke<string>("linux_clipboard", { value: null }) : navigator.clipboard.readText();
}

// Only Linux-specific adaptations. The existing Windows translations are intact.
const linuxText: Record<string, [string, string]> = {
  "windowsHello.title": ["Desbloqueio pelo sistema Linux", "Linux system unlock"],
  "windowsHello.description": ["Requer proteção de chave e autenticação local verificadas. Nesta versão, use a senha mestra.", "Requires verified key protection and local authentication. Use the master password in this version."],
  "windowsHello.unavailable": ["Desbloqueio do sistema indisponível; a senha mestra continua obrigatória.", "System unlock unavailable; the master password is required."],
  "windowsHello.enable": ["Desbloqueio do sistema indisponível", "System unlock unavailable"],
  "settings.startupWithWindows": ["Iniciar com a sessão Linux", "Start with the Linux session"],
  "settings.startupWithWindowsDescription": ["Ativa a inicialização automática pelo desktop Linux.", "Enable autostart through the Linux desktop."],
  "settings.startupRegistry": ["Entrada de autostart", "Autostart entry"],
  "settings.startupError": ["Não foi possível alterar o autostart Linux.", "Could not change Linux autostart."],
  "settings.notifyOnTrayDescription": ["Mostra aviso nativo do desktop.", "Show a native desktop notification."],
  "settings.winV": ["O histórico do clipboard depende do desktop Linux.", "Clipboard history is managed by the Linux desktop."],
  "settings.autostart": ["Autostart da sessão Linux", "Linux session autostart"],
  "totp.easy.selectScreenHint": ["O desktop pedirá autorização para capturar a área do QR.", "The desktop will ask permission to capture the QR area."],
  "totp.easy.screenIntroText": ["Deixe o QR visível e selecione a área no portal do desktop. O KPassword volta após a captura.", "Keep the QR visible and select its area in the desktop portal. KPassword returns after capture."],
  "totp.easy.screenIntroStep2": ["Autorize a captura e selecione a área do QR no desktop.", "Approve capture and select the QR area in the desktop."],
  "updates.checking": ["No Fedora, atualize o RPM com o gestor de pacotes: sudo dnf upgrade kpassword.", "On Fedora, update the RPM with your package manager: sudo dnf upgrade kpassword."],
  "appDiagnostics.updaterValue": ["Atualização RPM pelo gestor de pacotes", "RPM updates through the package manager"],
};

export function linuxTranslation(key: string, language: AppLanguage): string | undefined {
  const entry = linuxText[key];
  return entry?.[language === "pt" ? 0 : 1];
}
