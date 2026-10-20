//! Clipboard de segredos.
//!
//! Toda copia do cofre passa por aqui para:
//! - marcar o conteudo como sensivel (fora do historico Win+V/nuvem no
//!   Windows e do Klipper no KDE);
//! - limpar no backend, sem depender de timer do WebView nem de ler o
//!   clipboard de volta; so limpa se o conteudo ainda for o nosso;
//! - limpar tambem ao bloquear o cofre e ao encerrar o app.
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;

use tauri::{AppHandle, Manager, State};

/// Prova de que o clipboard ainda contem o que copiamos.
#[cfg(windows)]
type Ownership = u32;
#[cfg(target_os = "linux")]
type Ownership = std::sync::Arc<std::sync::atomic::AtomicBool>;
#[cfg(not(any(windows, target_os = "linux")))]
type Ownership = ();

#[derive(Default)]
pub struct SecureClipboard {
    generation: AtomicU64,
    owned: Mutex<Option<Ownership>>,
}

const MIN_CLEAR_SECONDS: u64 = 5;
const MAX_CLEAR_SECONDS: u64 = 600;

#[tauri::command]
pub async fn clipboard_write_secret(
    app: AppHandle,
    state: State<'_, SecureClipboard>,
    value: String,
    clear_after_seconds: u64,
) -> Result<(), String> {
    let value = zeroize::Zeroizing::new(value);
    let ownership = platform::write_secret(&app, &value).await?;
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *state
        .owned
        .lock()
        .map_err(|_| "error.clipboard.unavailable")? = Some(ownership);

    let delay =
        Duration::from_secs(clear_after_seconds.clamp(MIN_CLEAR_SECONDS, MAX_CLEAR_SECONDS));
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let state = app.state::<SecureClipboard>();
        // Uma copia mais nova assumiu o prazo de limpeza.
        if state.generation.load(Ordering::SeqCst) == generation {
            clear_now(&app);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn clipboard_clear_secret(app: AppHandle) {
    clear_now(&app);
}

/// Apaga o segredo se o clipboard ainda contiver o que o KPassword copiou.
/// Conteudo copiado depois pelo usuario, em outro app, nunca e apagado.
pub fn clear_now(app: &AppHandle) {
    let state = app.state::<SecureClipboard>();
    let ownership = state.owned.lock().ok().and_then(|mut owned| owned.take());
    if let Some(ownership) = ownership {
        platform::clear_if_owned(app, ownership);
    }
}

#[cfg(windows)]
mod platform {
    use super::Ownership;
    use std::ffi::c_void;
    use tauri::AppHandle;
    use zeroize::Zeroize;

    const CF_UNICODETEXT: u32 = 13;
    const GMEM_MOVEABLE: u32 = 0x0002;
    // Formatos documentados pela Microsoft para tirar o conteudo do historico
    // (Win+V), da sincronizacao em nuvem e de monitores de clipboard.
    const PRIVACY_FORMATS: [&str; 3] = [
        "ExcludeClipboardContentFromMonitorProcessing",
        "CanIncludeInClipboardHistory",
        "CanUploadToCloudClipboard",
    ];

    #[link(name = "User32")]
    extern "system" {
        fn OpenClipboard(hwnd_new_owner: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, memory: *mut c_void) -> *mut c_void;
        fn GetClipboardSequenceNumber() -> u32;
        fn RegisterClipboardFormatW(format: *const u16) -> u32;
    }

    #[link(name = "Kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
    }

    struct ClipboardGuard;

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    /// Outro processo pode estar com o clipboard aberto; tenta por ~0,5 s.
    fn open_clipboard() -> Result<ClipboardGuard, String> {
        for _ in 0..10 {
            if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                return Ok(ClipboardGuard);
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        Err("error.clipboard.busy".to_string())
    }

    /// Copia `bytes` para memoria global e entrega ao clipboard, que passa a
    /// ser o dono da memoria quando a chamada da certo.
    unsafe fn set_clipboard_bytes(format: u32, bytes: &[u8]) -> bool {
        let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
        if memory.is_null() {
            return false;
        }
        let locked = GlobalLock(memory) as *mut u8;
        if locked.is_null() {
            GlobalFree(memory);
            return false;
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), locked, bytes.len());
        GlobalUnlock(memory);
        if SetClipboardData(format, memory).is_null() {
            GlobalFree(memory);
            return false;
        }
        true
    }

    fn register_clipboard_format(name: &str) -> u32 {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe { RegisterClipboardFormatW(wide.as_ptr()) }
    }

    pub async fn write_secret(_app: &AppHandle, value: &str) -> Result<Ownership, String> {
        let mut wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
        let result = (|| {
            let guard = open_clipboard()?;
            unsafe {
                if EmptyClipboard() == 0 {
                    return Err("error.clipboard.prepare".to_string());
                }
                // Marcadores antes do texto: nenhum monitor ve o texto sem eles.
                for name in PRIVACY_FORMATS {
                    let format = register_clipboard_format(name);
                    if format != 0 {
                        let _ = set_clipboard_bytes(format, &0u32.to_ne_bytes());
                    }
                }
                let bytes = std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2);
                if !set_clipboard_bytes(CF_UNICODETEXT, bytes) {
                    return Err("error.clipboard.write".to_string());
                }
            }
            drop(guard);
            Ok(unsafe { GetClipboardSequenceNumber() })
        })();
        wide.zeroize();
        result
    }

    pub fn clear_if_owned(_app: &AppHandle, sequence: Ownership) {
        if unsafe { GetClipboardSequenceNumber() } != sequence {
            return;
        }
        if let Ok(_guard) = open_clipboard() {
            unsafe {
                let _ = EmptyClipboard();
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::Ownership;
    use gtk::{TargetEntry, TargetFlags};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use tauri::AppHandle;

    const TEXT_INFO: u32 = 0;
    const HINT_INFO: u32 = 1;
    // O Klipper (KDE) nao guarda no historico conteudo com esta dica.
    const KDE_PASSWORD_HINT: &str = "x-kde-passwordManagerHint";

    /// Marca a posse como perdida quando o GTK descarta nossos dados, isto e,
    /// quando outro app (ou uma nova copia) assume o clipboard.
    struct OwnershipGuard(Arc<AtomicBool>);

    impl Drop for OwnershipGuard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }

    fn clipboard() -> Option<gtk::Clipboard> {
        gtk::gdk::Display::default().and_then(|display| gtk::Clipboard::default(&display))
    }

    pub async fn write_secret(app: &AppHandle, value: &str) -> Result<Ownership, String> {
        let text = zeroize::Zeroizing::new(value.to_string());
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let result = (|| {
                let clipboard = clipboard().ok_or("error.clipboard.unavailable")?;
                let owned = Arc::new(AtomicBool::new(true));
                let guard = OwnershipGuard(owned.clone());
                let targets = [
                    TargetEntry::new("UTF8_STRING", TargetFlags::empty(), TEXT_INFO),
                    TargetEntry::new("text/plain;charset=utf-8", TargetFlags::empty(), TEXT_INFO),
                    TargetEntry::new("text/plain", TargetFlags::empty(), TEXT_INFO),
                    TargetEntry::new("STRING", TargetFlags::empty(), TEXT_INFO),
                    TargetEntry::new("TEXT", TargetFlags::empty(), TEXT_INFO),
                    TargetEntry::new(KDE_PASSWORD_HINT, TargetFlags::empty(), HINT_INFO),
                ];
                let stored = clipboard.set_with_data(&targets, move |_, selection, info| {
                    let _keep_until_ownership_is_lost = &guard;
                    if info == HINT_INFO {
                        selection.set(&selection.target(), 8, b"secret");
                    } else {
                        selection.set_text(&text);
                    }
                });
                if stored {
                    Ok(owned)
                } else {
                    Err("error.clipboard.write".to_string())
                }
            })();
            let _ = tx.send(result);
        })
        .map_err(|_| "error.clipboard.unavailable")?;
        tokio::time::timeout(std::time::Duration::from_secs(5), rx)
            .await
            .map_err(|_| "error.clipboard.timeout")?
            .map_err(|_| "error.clipboard.unavailable".to_string())?
    }

    pub fn clear_if_owned(app: &AppHandle, owned: Ownership) {
        let clear = move || {
            // gtk_clipboard_clear so e seguro enquanto ainda somos os donos.
            if owned.load(Ordering::SeqCst) {
                if let Some(clipboard) = clipboard() {
                    clipboard.clear();
                }
            }
        };
        // No encerramento ja estamos na thread do GTK e o loop nao roda mais.
        if gtk::is_initialized_main_thread() {
            clear();
        } else {
            let _ = app.run_on_main_thread(clear);
        }
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod platform {
    use super::Ownership;
    use tauri::AppHandle;

    pub async fn write_secret(_app: &AppHandle, _value: &str) -> Result<Ownership, String> {
        Err("error.clipboard.unsupported".to_string())
    }

    pub fn clear_if_owned(_app: &AppHandle, _owned: Ownership) {}
}
