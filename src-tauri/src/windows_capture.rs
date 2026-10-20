//! Recorte de tela do Windows e leitura da imagem do clipboard.
#[allow(unused_imports)]
use super::*;

#[cfg(windows)]
mod windows_screen_snip_native {
    use super::{
        encode_qr_capture_as_png_data_url, validate_qr_image_dimensions, MAX_QR_IMAGE_BYTES,
    };
    use image::{DynamicImage, RgbaImage};
    use std::{ffi::c_void, mem, thread, time::Duration};

    const CF_DIB: u32 = 8;
    const CF_DIBV5: u32 = 17;
    const BI_BITFIELDS: u32 = 3;
    const BI_ALPHABITFIELDS: u32 = 6;
    const INPUT_KEYBOARD: u32 = 1;
    const KEYEVENTF_KEYUP: u32 = 0x0002;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MouseInput {
        dx: i32,
        dy: i32,
        mouse_data: u32,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct KeyboardInput {
        w_vk: u16,
        w_scan: u16,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct HardwareInput {
        u_msg: u32,
        w_param_l: u16,
        w_param_h: u16,
    }

    #[repr(C)]
    union InputUnion {
        mi: MouseInput,
        ki: KeyboardInput,
        hi: HardwareInput,
    }

    #[repr(C)]
    struct Input {
        input_type: u32,
        union: InputUnion,
    }

    #[link(name = "User32")]
    extern "system" {
        fn OpenClipboard(hwnd_new_owner: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn IsClipboardFormatAvailable(format: u32) -> i32;
        fn GetClipboardData(format: u32) -> *mut c_void;
        fn GetClipboardSequenceNumber() -> u32;
        fn RegisterClipboardFormatW(format: *const u16) -> u32;
        fn SendInput(c_inputs: u32, p_inputs: *const Input, cb_size: i32) -> u32;
    }

    #[link(name = "Kernel32")]
    extern "system" {
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
        fn GlobalSize(memory: *mut c_void) -> usize;
    }

    struct ClipboardGuard;

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    fn open_clipboard() -> Option<ClipboardGuard> {
        let opened = unsafe { OpenClipboard(std::ptr::null_mut()) } != 0;
        opened.then_some(ClipboardGuard)
    }

    fn clipboard_sequence_number() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    fn register_clipboard_format(name: &str) -> u32 {
        let mut wide: Vec<u16> = name.encode_utf16().collect();
        wide.push(0);
        unsafe { RegisterClipboardFormatW(wide.as_ptr()) }
    }

    fn read_clipboard_format_bytes(format: u32) -> Option<Vec<u8>> {
        if unsafe { IsClipboardFormatAvailable(format) } == 0 {
            return None;
        }

        let handle = unsafe { GetClipboardData(format) };
        if handle.is_null() {
            return None;
        }

        let size = unsafe { GlobalSize(handle) };
        if size == 0 || size > MAX_QR_IMAGE_BYTES.saturating_mul(10) {
            return None;
        }

        let locked = unsafe { GlobalLock(handle) };
        if locked.is_null() {
            return None;
        }

        let bytes = unsafe { std::slice::from_raw_parts(locked.cast::<u8>(), size).to_vec() };
        unsafe {
            let _ = GlobalUnlock(handle);
        }

        Some(bytes)
    }

    fn read_le_u16(bytes: &[u8], offset: usize) -> Option<u16> {
        let value = bytes.get(offset..offset + 2)?;
        Some(u16::from_le_bytes([value[0], value[1]]))
    }

    fn read_le_u32(bytes: &[u8], offset: usize) -> Option<u32> {
        let value = bytes.get(offset..offset + 4)?;
        Some(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
    }

    fn read_le_i32(bytes: &[u8], offset: usize) -> Option<i32> {
        let value = bytes.get(offset..offset + 4)?;
        Some(i32::from_le_bytes([value[0], value[1], value[2], value[3]]))
    }

    fn clipboard_dib_to_image(bytes: &[u8]) -> Option<DynamicImage> {
        let header_size = usize::try_from(read_le_u32(bytes, 0)?).ok()?;
        if header_size < 40 || bytes.len() < header_size {
            return None;
        }

        let width_i32 = read_le_i32(bytes, 4)?;
        let height_i32 = read_le_i32(bytes, 8)?;
        let planes = read_le_u16(bytes, 12)?;
        let bit_count = read_le_u16(bytes, 14)?;
        let compression = read_le_u32(bytes, 16)?;
        let colors_used = read_le_u32(bytes, 32).unwrap_or(0);

        if planes != 1 || width_i32 <= 0 || height_i32 == 0 {
            return None;
        }

        let width = u32::try_from(width_i32).ok()?;
        let height = height_i32.unsigned_abs();
        validate_qr_image_dimensions(width, height).ok()?;

        let mut pixel_offset = header_size;
        if bit_count <= 8 {
            let colors = if colors_used > 0 {
                colors_used
            } else {
                1u32.checked_shl(bit_count.into()).unwrap_or(0)
            };
            pixel_offset =
                pixel_offset.checked_add(usize::try_from(colors).ok()?.checked_mul(4)?)?;
        } else if header_size == 40
            && (compression == BI_BITFIELDS || compression == BI_ALPHABITFIELDS)
        {
            pixel_offset = pixel_offset.checked_add(if compression == BI_ALPHABITFIELDS {
                16
            } else {
                12
            })?;
        }

        let width_usize = usize::try_from(width).ok()?;
        let height_usize = usize::try_from(height).ok()?;
        let bottom_up = height_i32 > 0;
        let mut rgba = vec![0u8; width_usize.checked_mul(height_usize)?.checked_mul(4)?];

        match bit_count {
            32 => {
                let stride = width_usize.checked_mul(4)?;
                if bytes.len() < pixel_offset.checked_add(stride.checked_mul(height_usize)?)? {
                    return None;
                }

                for y in 0..height_usize {
                    let source_y = if bottom_up { height_usize - 1 - y } else { y };
                    let source_row = pixel_offset + source_y * stride;
                    let target_row = y * width_usize * 4;

                    for x in 0..width_usize {
                        let source = source_row + x * 4;
                        let target = target_row + x * 4;
                        rgba[target] = bytes[source + 2];
                        rgba[target + 1] = bytes[source + 1];
                        rgba[target + 2] = bytes[source];
                        rgba[target + 3] = 255;
                    }
                }
            }
            24 => {
                let stride = width_usize.checked_mul(3)?.checked_add(3)? & !3;
                if bytes.len() < pixel_offset.checked_add(stride.checked_mul(height_usize)?)? {
                    return None;
                }

                for y in 0..height_usize {
                    let source_y = if bottom_up { height_usize - 1 - y } else { y };
                    let source_row = pixel_offset + source_y * stride;
                    let target_row = y * width_usize * 4;

                    for x in 0..width_usize {
                        let source = source_row + x * 3;
                        let target = target_row + x * 4;
                        rgba[target] = bytes[source + 2];
                        rgba[target + 1] = bytes[source + 1];
                        rgba[target + 2] = bytes[source];
                        rgba[target + 3] = 255;
                    }
                }
            }
            _ => return None,
        }

        let image = RgbaImage::from_raw(width, height, rgba)?;
        Some(DynamicImage::ImageRgba8(image))
    }

    fn read_clipboard_image() -> Option<DynamicImage> {
        let _guard = open_clipboard()?;

        let png_format = register_clipboard_format("PNG");
        if png_format != 0 {
            if let Some(bytes) = read_clipboard_format_bytes(png_format) {
                if let Ok(image) = image::load_from_memory(&bytes) {
                    return Some(image);
                }
            }
        }

        for format in [CF_DIBV5, CF_DIB] {
            if let Some(bytes) = read_clipboard_format_bytes(format) {
                if let Some(image) = clipboard_dib_to_image(&bytes) {
                    return Some(image);
                }
            }
        }

        None
    }

    fn send_keyboard_input(vk: u16, flags: u32) -> Result<(), String> {
        let input = Input {
            input_type: INPUT_KEYBOARD,
            union: InputUnion {
                ki: KeyboardInput {
                    w_vk: vk,
                    w_scan: 0,
                    dw_flags: flags,
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        };

        let sent = unsafe { SendInput(1, &input as *const Input, mem::size_of::<Input>() as i32) };
        if sent == 0 {
            return Err("error.capture.snipShortcut".to_string());
        }

        Ok(())
    }

    pub fn launch_screen_snip() -> Result<(), String> {
        // Aciona o mesmo fluxo do atalho global Win + Shift + S.
        // SendInput é mais confiável que keybd_event para o atalho global do Windows.
        const VK_LWIN: u16 = 0x5B;
        const VK_SHIFT: u16 = 0x10;
        const VK_S: u16 = 0x53;

        send_keyboard_input(VK_LWIN, 0)?;
        thread::sleep(Duration::from_millis(45));
        send_keyboard_input(VK_SHIFT, 0)?;
        thread::sleep(Duration::from_millis(45));
        send_keyboard_input(VK_S, 0)?;
        thread::sleep(Duration::from_millis(80));
        send_keyboard_input(VK_S, KEYEVENTF_KEYUP)?;
        thread::sleep(Duration::from_millis(45));
        send_keyboard_input(VK_SHIFT, KEYEVENTF_KEYUP)?;
        thread::sleep(Duration::from_millis(45));
        send_keyboard_input(VK_LWIN, KEYEVENTF_KEYUP)?;

        Ok(())
    }

    pub fn clipboard_sequence() -> u32 {
        clipboard_sequence_number()
    }

    pub fn read_clipboard_image_png_data_url(after_sequence: u32) -> Result<String, String> {
        let current_sequence = clipboard_sequence_number();
        if after_sequence != 0 && current_sequence == after_sequence {
            return Err("error.capture.waitingForSnip".to_string());
        }

        let image = read_clipboard_image().ok_or_else(|| "error.capture.noImage".to_string())?;

        encode_qr_capture_as_png_data_url(&image)
    }
}

#[cfg(windows)]
pub(crate) fn get_windows_clipboard_sequence_number_impl() -> u32 {
    windows_screen_snip_native::clipboard_sequence()
}

#[cfg(not(windows))]
pub(crate) fn get_windows_clipboard_sequence_number_impl() -> u32 {
    0
}

#[tauri::command]
pub(crate) fn get_windows_clipboard_sequence_number() -> u32 {
    get_windows_clipboard_sequence_number_impl()
}

#[cfg(windows)]
pub(crate) fn start_windows_screen_snip_impl() -> Result<(), String> {
    windows_screen_snip_native::launch_screen_snip()
}

#[cfg(not(windows))]
pub(crate) fn start_windows_screen_snip_impl() -> Result<(), String> {
    Err("O recorte automático de QR está disponível apenas no Windows.".to_string())
}

#[tauri::command]
pub(crate) fn start_windows_screen_snip(window: tauri::Window) -> Result<(), String> {
    // Fazemos a preparação no backend para garantir que a janela suma antes do Win + Shift + S.
    // O frontend continua responsável por aguardar o novo recorte no clipboard e restaurar a janela.
    let _ = window.set_always_on_top(false);
    let _ = window.minimize();
    std::thread::sleep(std::time::Duration::from_millis(900));
    start_windows_screen_snip_impl()
}

#[tauri::command]
pub(crate) fn restore_main_window_after_screen_snip(window: tauri::Window) -> Result<(), String> {
    // Depois que o Windows copia o recorte para o clipboard, trazemos o KPassword de volta.
    // O pulso topmost ajuda quando o foco ainda fica preso no navegador ou na overlay de recorte.
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    std::thread::sleep(std::time::Duration::from_millis(220));
    let _ = window.set_focus();
    std::thread::sleep(std::time::Duration::from_millis(320));
    let _ = window.set_always_on_top(false);
    let _ = window.set_focus();
    Ok(())
}

#[cfg(windows)]
pub(crate) fn read_windows_clipboard_image_png_data_url_impl(
    after_sequence: u32,
) -> Result<String, String> {
    windows_screen_snip_native::read_clipboard_image_png_data_url(after_sequence)
}

#[cfg(not(windows))]
pub(crate) fn read_windows_clipboard_image_png_data_url_impl(
    _after_sequence: u32,
) -> Result<String, String> {
    Err("O recorte automático de QR está disponível apenas no Windows.".to_string())
}

#[tauri::command]
pub(crate) fn read_windows_clipboard_image_png_data_url(
    after_sequence: u32,
) -> Result<String, String> {
    read_windows_clipboard_image_png_data_url_impl(after_sequence)
}
