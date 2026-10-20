import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage } from "./i18n";

/** Copia um segredo fora do histórico do clipboard; o backend o apaga após `clearAfterSeconds`. */
export async function writeSecretToClipboard(value: string, clearAfterSeconds: number) {
  await invoke("clipboard_write_secret", { value, clearAfterSeconds });
}

/** Apaga o segredo copiado, se o clipboard ainda contiver o que o KPassword copiou. */
export function clearSecretClipboard() {
  void invoke("clipboard_clear_secret").catch(() => {});
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
  "settings.winV": ["Senhas copiadas são marcadas como sensíveis e ficam fora do histórico do Klipper.", "Copied secrets are marked sensitive and stay out of Klipper history."],
  "settings.autostart": ["Autostart da sessão Linux", "Linux session autostart"],
  "totp.easy.selectScreenHint": ["O desktop pedirá autorização para capturar a área do QR.", "The desktop will ask permission to capture the QR area."],
  "totp.easy.screenIntroText": ["Deixe o QR visível e selecione a área no portal do desktop. O KPassword volta após a captura.", "Keep the QR visible and select its area in the desktop portal. KPassword returns after capture."],
  "totp.easy.screenIntroStep2": ["Autorize a captura e selecione a área do QR no desktop.", "Approve capture and select the QR area in the desktop."],
  "preferences.checkUpdate": ["Abrir versões para Fedora", "Open Fedora releases"],
  "preferences.updatesDescription": ["Abra o GitHub Releases, baixe o RPM mais recente e instale pelo gestor de pacotes. A instalação requer sua autorização de administrador.", "Open GitHub Releases, download the latest RPM and install it with your package manager. Installation requires your administrator authorization."],
  "updates.checking": ["Abrindo GitHub Releases. Baixe o RPM e atualize com: sudo dnf upgrade ./arquivo.rpm", "Opening GitHub Releases. Download the RPM and update with: sudo dnf upgrade ./file.rpm"],
  "appDiagnostics.updaterValue": ["Atualização RPM pelo gestor de pacotes", "RPM updates through the package manager"],
  "appDiagnostics.settingsDescription": ["Confira versão, inicialização, bandeja, backups e integração com o desktop.", "Check version, startup, tray, backups and desktop integration."],
  "appDiagnostics.windowsHello": ["Desbloqueio pelo sistema", "System unlock"],
  "appDiagnostics.startup": ["Iniciar com a sessão Linux", "Start with the Linux session"],
  "appDiagnostics.startupName": ["Entrada de autostart", "Autostart entry"],
  "appDiagnostics.memoryValue": ["Gerenciada pelo desktop e pelo runtime WebKitGTK", "Managed by the desktop and WebKitGTK runtime"],
  "appDiagnostics.webview": ["Interface WebKitGTK", "WebKitGTK interface"],
  "appDiagnostics.webviewValue": ["Runtime usado para renderizar a interface no Linux", "Runtime used to render the interface on Linux"],
  "appDiagnostics.windowsProcessNoteTitle": ["Sobre a interface no Linux", "About the Linux interface"],
  "appDiagnostics.windowsProcessNote": ["No Linux, o KPassword usa Tauri e WebKitGTK. Bandeja, captura de QR e inicialização dependem da integração disponível no desktop.", "On Linux, KPassword uses Tauri and WebKitGTK. Tray, QR capture and startup depend on the desktop integration available."],
};

export function linuxTranslation(key: string, language: AppLanguage): string | undefined {
  const entry = linuxText[key];
  return entry?.[language === "pt" ? 0 : 1];
}
