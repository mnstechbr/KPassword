//! Bandeja do sistema: menu traduzido e envio da janela para a bandeja.
use super::*;

#[cfg(windows)]
pub(crate) fn trim_current_process_working_set() {
    #[link(name = "Kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> *mut std::ffi::c_void;
        fn SetProcessWorkingSetSize(
            h_process: *mut std::ffi::c_void,
            minimum_working_set_size: usize,
            maximum_working_set_size: usize,
        ) -> i32;
    }

    unsafe {
        let process = GetCurrentProcess();
        let _ = SetProcessWorkingSetSize(process, usize::MAX, usize::MAX);
    }
}

#[cfg(not(windows))]
pub(crate) fn trim_current_process_working_set() {}

/// Itens da bandeja cujo texto acompanha o idioma escolhido no app.
pub(crate) struct TrayMenuItems {
    open: MenuItem<tauri::Wry>,
    revoke_bridge: Option<MenuItem<tauri::Wry>>,
    quit: MenuItem<tauri::Wry>,
}

#[derive(Default)]
pub(crate) struct TrayMenu(std::sync::Mutex<Option<TrayMenuItems>>);

pub(crate) fn tray_label(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).take(80).collect()
}

#[tauri::command]
pub(crate) fn set_tray_labels(
    state: tauri::State<'_, TrayMenu>,
    open: String,
    revoke_bridge: String,
    quit: String,
) -> Result<(), String> {
    let items = state.0.lock().map_err(|_| "error.task.interrupted")?;
    let Some(items) = items.as_ref() else {
        return Ok(());
    };
    let mut result = items.open.set_text(tray_label(&open));
    if let Some(item) = &items.revoke_bridge {
        result = result.and(item.set_text(tray_label(&revoke_bridge)));
    }
    result
        .and(items.quit.set_text(tray_label(&quit)))
        .map_err(|_| "error.tray.update".to_string())
}

#[tauri::command]
pub(crate) fn hide_to_tray(
    app: AppHandle,
    reason: String,
    notify: Option<bool>,
    notification_title: Option<String>,
    notification_body: Option<String>,
) {
    let _ = reason;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    // Ao ir para a bandeja, o cofre já foi bloqueado no frontend.
    // Este ajuste apenas pede ao Windows para reduzir o working set do processo principal.
    // Os processos filhos do WebView2 continuam sob controle do runtime do Windows.
    trim_current_process_working_set();

    if notify.unwrap_or(true) {
        let title = notification_title.unwrap_or_else(|| "KPassword protegido".to_string());
        let body = notification_body
            .unwrap_or_else(|| "O KPassword continua protegido na bandeja.".to_string());

        #[cfg(target_os = "linux")]
        {
            // The notification plugin itself spawns onto Tokio. Call the
            // blocking Linux backend directly on a regular thread instead.
            std::thread::spawn(move || {
                let _ = notify_rust::Notification::new()
                    .summary(&title)
                    .body(&body)
                    .show();
            });
        }
        #[cfg(not(target_os = "linux"))]
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

/// Cria o icone da bandeja. Os textos comecam em portugues e o frontend os
/// troca pelo idioma escolhido com `set_tray_labels`.
pub(crate) fn build(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Abrir restaura a janela como o usuario deixou (tamanho/maximizado).
    let open_item = MenuItem::with_id(app, "open", "Abrir KPassword", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    #[cfg(target_os = "linux")]
    let bridge_stop = MenuItem::with_id(
        app,
        "bridge_stop",
        "Revogar todos os acessos da ponte",
        true,
        None::<&str>,
    )?;
    #[cfg(target_os = "linux")]
    let bridge_separator = PredefinedMenuItem::separator(app)?;
    #[cfg(target_os = "linux")]
    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &separator,
            &bridge_stop,
            &bridge_separator,
            &quit_item,
        ],
    )?;
    #[cfg(not(target_os = "linux"))]
    let menu = Menu::with_items(app, &[&open_item, &separator, &quit_item])?;
    *app.state::<TrayMenu>()
        .0
        .lock()
        .map_err(|_| "error.task.interrupted")? = Some(TrayMenuItems {
        open: open_item.clone(),
        #[cfg(target_os = "linux")]
        revoke_bridge: Some(bridge_stop.clone()),
        #[cfg(not(target_os = "linux"))]
        revoke_bridge: None,
        quit: quit_item.clone(),
    });

    TrayIconBuilder::new()
        .tooltip("KPassword")
        .icon(Image::new(
            include_bytes!("../icons/tray-icon.rgba"),
            32,
            32,
        ))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                show_main_window(app);
            }
            "bridge_stop" => {
                secrets_bridge::close(app);
            }
            "quit" => {
                secure_clipboard::clear_now(app);
                secrets_bridge::close(app);
                app.exit(0);
            }
            _ => {
                println!("Item de menu nao tratado.");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                show_main_window(app);
            }
        })
        .build(app)?;
    Ok(())
}
