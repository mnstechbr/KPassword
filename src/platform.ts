import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage } from "./i18n";

/** Plataforma provável pelo user agent (WebView2 no Windows, WebKitGTK no Linux), até o backend confirmar. */
export function guessPlatform(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) return "linux";
  return "unknown";
}

/** Copia um segredo fora do histórico do clipboard; o backend o apaga após `clearAfterSeconds`. */
export async function writeSecretToClipboard(value: string, clearAfterSeconds: number) {
  await invoke("clipboard_write_secret", { value, clearAfterSeconds });
}

/** Apaga o segredo copiado, se o clipboard ainda contiver o que o KPassword copiou. */
export function clearSecretClipboard() {
  void invoke("clipboard_clear_secret").catch(() => {});
}

// Only Linux-specific adaptations. The existing Windows translations are intact.
const linuxText: Record<string, [pt: string, en: string, es: string, tr: string]> = {
  "windowsHello.title": ["Desbloqueio pelo sistema Linux", "Linux system unlock", "Desbloqueo del sistema Linux", "Linux sistem kilidi açma"],
  "windowsHello.description": ["Requer proteção de chave e autenticação local verificadas. Nesta versão, use a senha mestra.", "Requires verified key protection and local authentication. Use the master password in this version.", "Requiere protección de claves verificada y autenticación local. En esta versión, use la contraseña maestra.", "Doğrulanmış anahtar koruması ve yerel kimlik doğrulaması gerektirir. Bu sürümde ana parolayı kullanın."],
  "windowsHello.unavailable": ["Desbloqueio do sistema indisponível; a senha mestra continua obrigatória.", "System unlock unavailable; the master password is required.", "Desbloqueo del sistema no disponible; se requiere la contraseña maestra.", "Sistem kilidi açma kullanılamıyor; ana parola gereklidir."],
  "windowsHello.enable": ["Desbloqueio do sistema indisponível", "System unlock unavailable", "Desbloqueo del sistema no disponible", "Sistem kilidi açma kullanılamıyor"],
  "settings.startupWithWindows": ["Iniciar com a sessão Linux", "Start with the Linux session", "Iniciar con la sesión de Linux", "Linux oturumuyla başlat"],
  "settings.startupWithWindowsDescription": ["Ativa a inicialização automática pelo desktop Linux.", "Enable autostart through the Linux desktop.", "Active el inicio automático a través del escritorio Linux.", "Linux masaüstü üzerinden otomatik başlatmayı etkinleştirin."],
  "settings.startupRegistry": ["Entrada de autostart", "Autostart entry", "Entrada de inicio automático", "Otomatik başlatma girdisi"],
  "settings.startupError": ["Não foi possível alterar o autostart Linux.", "Could not change Linux autostart.", "No se pudo cambiar el inicio automático de Linux.", "Linux otomatik başlatma ayarı değiştirilemedi."],
  "settings.notifyOnTrayDescription": ["Mostra aviso nativo do desktop.", "Show a native desktop notification.", "Mostrar una notificación nativa del escritorio.", "Yerel bir masaüstü bildirimi göster."],
  "settings.winV": ["Senhas copiadas são marcadas como sensíveis e ficam fora do histórico do Klipper.", "Copied secrets are marked sensitive and stay out of Klipper history.", "Los secretos copiados se marcan como sensibles y quedan fuera del historial de Klipper.", "Kopyalanan gizli bilgiler hassas olarak işaretlenir ve Klipper geçmişinin dışında tutulur."],
  "settings.autostart": ["Autostart da sessão Linux", "Linux session autostart", "Inicio automático de la sesión Linux", "Linux oturumu otomatik başlatma"],
  "totp.easy.selectScreenHint": ["O desktop pedirá autorização para capturar a área do QR.", "The desktop will ask permission to capture the QR area.", "El escritorio pedirá permiso para capturar el área del QR.", "Masaüstü, QR alanını yakalamak için izin isteyecek."],
  "totp.easy.screenIntroText": ["Deixe o QR visível e selecione a área no portal do desktop. O KPassword volta após a captura.", "Keep the QR visible and select its area in the desktop portal. KPassword returns after capture.", "Mantenga el QR visible y seleccione su área en el portal del escritorio. KPassword vuelve tras la captura.", "QR kodunu görünür tutun ve masaüstü portalında alanını seçin. KPassword yakalamadan sonra geri döner."],
  "totp.easy.screenIntroStep2": ["Autorize a captura e selecione a área do QR no desktop.", "Approve capture and select the QR area in the desktop.", "Apruebe la captura y seleccione el área del QR en el escritorio.", "Yakalamayı onaylayın ve masaüstünde QR alanını seçin."],
  "preferences.checkUpdate": ["Abrir versões para Fedora", "Open Fedora releases", "Abrir versiones para Fedora", "Fedora sürümlerini aç"],
  "preferences.updatesDescription": ["Abra o GitHub Releases, baixe o RPM mais recente e instale pelo gestor de pacotes. A instalação requer sua autorização de administrador.", "Open GitHub Releases, download the latest RPM and install it with your package manager. Installation requires your administrator authorization.", "Abra GitHub Releases, descargue el RPM más reciente e instálelo con su gestor de paquetes. La instalación requiere su autorización de administrador.", "GitHub Releases'ı açın, en son RPM'yi indirin ve paket yöneticinizle yükleyin. Yükleme için yönetici yetkiniz gerekir."],
  "updates.checking": ["Abrindo GitHub Releases. Baixe o RPM e atualize com: sudo dnf upgrade ./arquivo.rpm", "Opening GitHub Releases. Download the RPM and update with: sudo dnf upgrade ./file.rpm", "Abriendo GitHub Releases. Descargue el RPM y actualice con: sudo dnf upgrade ./archivo.rpm", "GitHub Releases açılıyor. RPM'yi indirin ve şu komutla güncelleyin: sudo dnf upgrade ./dosya.rpm"],
  "appDiagnostics.updaterValue": ["Atualização RPM pelo gestor de pacotes", "RPM updates through the package manager", "Actualizaciones RPM mediante el gestor de paquetes", "Paket yöneticisi üzerinden RPM güncellemeleri"],
  "appDiagnostics.settingsDescription": ["Confira versão, inicialização, bandeja, backups e integração com o desktop.", "Check version, startup, tray, backups and desktop integration.", "Compruebe la versión, el inicio, la bandeja, las copias de seguridad y la integración con el escritorio.", "Sürümü, başlangıcı, tepsiyi, yedekleri ve masaüstü entegrasyonunu kontrol edin."],
  "appDiagnostics.windowsHello": ["Desbloqueio pelo sistema", "System unlock", "Desbloqueo del sistema", "Sistem kilidi açma"],
  "appDiagnostics.startup": ["Iniciar com a sessão Linux", "Start with the Linux session", "Iniciar con la sesión de Linux", "Linux oturumuyla başlat"],
  "appDiagnostics.startupName": ["Entrada de autostart", "Autostart entry", "Entrada de inicio automático", "Otomatik başlatma girdisi"],
  "appDiagnostics.memoryValue": ["Gerenciada pelo desktop e pelo runtime WebKitGTK", "Managed by the desktop and WebKitGTK runtime", "Gestionada por el escritorio y el entorno de ejecución de WebKitGTK", "Masaüstü ve WebKitGTK çalışma zamanı tarafından yönetilir"],
  "appDiagnostics.webview": ["Interface WebKitGTK", "WebKitGTK interface", "Interfaz WebKitGTK", "WebKitGTK arayüzü"],
  "appDiagnostics.webviewValue": ["Runtime usado para renderizar a interface no Linux", "Runtime used to render the interface on Linux", "Entorno de ejecución usado para mostrar la interfaz en Linux", "Linux'ta arayüzü işlemek için kullanılan çalışma zamanı"],
  "appDiagnostics.windowsProcessNoteTitle": ["Sobre a interface no Linux", "About the Linux interface", "Acerca de la interfaz en Linux", "Linux arayüzü hakkında"],
  "appDiagnostics.windowsProcessNote": ["No Linux, o KPassword usa Tauri e WebKitGTK. Bandeja, captura de QR e inicialização dependem da integração disponível no desktop.", "On Linux, KPassword uses Tauri and WebKitGTK. Tray, QR capture and startup depend on the desktop integration available.", "En Linux, KPassword usa Tauri y WebKitGTK. La bandeja, la captura de QR y el inicio dependen de la integración de escritorio disponible.", "Linux'ta KPassword, Tauri ve WebKitGTK kullanır. Tepsi, QR yakalama ve başlangıç, mevcut masaüstü entegrasyonuna bağlıdır."],
};

const LANGUAGE_INDEX: Record<AppLanguage, number> = { pt: 0, en: 1, es: 2, tr: 3 };

export function linuxTranslation(key: string, language: AppLanguage): string | undefined {
  const entry = linuxText[key];
  return entry?.[LANGUAGE_INDEX[language]];
}
