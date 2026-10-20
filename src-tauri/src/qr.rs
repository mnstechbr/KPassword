//! Leitura de QR Code (TOTP) a partir de imagens.
use super::*;

pub(crate) const MAX_QR_IMAGE_BYTES: usize = 12 * 1024 * 1024;
pub(crate) const MAX_QR_IMAGE_SIDE: u32 = 10_000;
pub(crate) const MAX_QR_IMAGE_PIXELS: u64 = 25_000_000;

pub(crate) fn first_non_empty_qr_payload(payloads: Vec<String>) -> Option<String> {
    payloads
        .into_iter()
        .map(|content| content.trim().to_string())
        .find(|content| !content.is_empty())
}

pub(crate) fn decode_qr_with_rqrr(gray_image: image::GrayImage) -> Option<String> {
    let mut prepared = rqrr::PreparedImage::prepare(gray_image);
    let grids = prepared.detect_grids();

    let mut payloads = Vec::new();
    for grid in grids {
        if let Ok((_meta, content)) = grid.decode() {
            payloads.push(content);
        }
    }

    first_non_empty_qr_payload(payloads)
}

pub(crate) fn decode_qr_with_quircs(gray_image: &image::GrayImage) -> Option<String> {
    let mut decoder = quircs::Quirc::default();
    let codes = decoder.identify(
        gray_image.width() as usize,
        gray_image.height() as usize,
        gray_image.as_raw(),
    );

    let mut payloads = Vec::new();
    for code in codes {
        let Ok(code) = code else {
            continue;
        };
        let Ok(decoded) = code.decode() else {
            continue;
        };
        if let Ok(content) = std::str::from_utf8(&decoded.payload) {
            payloads.push(content.to_string());
        }
    }

    first_non_empty_qr_payload(payloads)
}

pub(crate) fn validate_qr_image_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("error.qr.invalidImage".to_string());
    }

    let pixels = u64::from(width) * u64::from(height);

    if width > MAX_QR_IMAGE_SIDE || height > MAX_QR_IMAGE_SIDE || pixels > MAX_QR_IMAGE_PIXELS {
        return Err("error.qr.imageTooLarge".to_string());
    }

    Ok(())
}

pub(crate) fn read_qr_image_dimensions(image_bytes: &[u8]) -> Result<(u32, u32), String> {
    let reader = image::ImageReader::new(Cursor::new(image_bytes))
        .with_guessed_format()
        .map_err(|_| "error.qr.invalidImage".to_string())?;

    reader
        .into_dimensions()
        .map_err(|_| "error.qr.openImage".to_string())
}

pub(crate) fn threshold_qr_image(gray_image: &image::GrayImage, threshold: u8) -> image::GrayImage {
    let mut output = gray_image.clone();

    for pixel in output.pixels_mut() {
        let value = pixel[0];
        pixel[0] = if value < threshold { 0 } else { 255 };
    }

    output
}

pub(crate) fn qr_gray_variants(original: &image::GrayImage) -> Vec<image::GrayImage> {
    let mut variants = vec![
        original.clone(),
        threshold_qr_image(original, 110),
        threshold_qr_image(original, 145),
        threshold_qr_image(original, 180),
    ];

    let max_dimension = original.width().max(original.height());
    let mut add_scaled = |scale: u32| {
        let scaled_width = original.width().saturating_mul(scale);
        let scaled_height = original.height().saturating_mul(scale);

        if scaled_width == 0 || scaled_height == 0 {
            return;
        }

        let scaled = image::imageops::resize(
            original,
            scaled_width,
            scaled_height,
            image::imageops::FilterType::Nearest,
        );
        variants.push(scaled.clone());
        variants.push(threshold_qr_image(&scaled, 145));
    };

    if max_dimension < 450 {
        add_scaled(4);
    } else if max_dimension < 900 {
        add_scaled(3);
    } else if max_dimension < 1400 {
        add_scaled(2);
    }

    variants
}

pub(crate) fn decode_qr_from_gray_image(gray_image: &image::GrayImage) -> Option<String> {
    for variant in qr_gray_variants(gray_image) {
        if let Some(content) = decode_qr_with_quircs(&variant) {
            return Some(content);
        }

        if let Some(content) = decode_qr_with_rqrr(variant) {
            return Some(content);
        }
    }

    None
}

pub(crate) fn tile_starts(total: u32, tile: u32) -> Vec<u32> {
    if tile >= total {
        return vec![0];
    }

    let step = (tile / 2).max(160);
    let mut starts = vec![0];
    let mut current = step;

    while current + tile < total {
        starts.push(current);
        current = current.saturating_add(step);
    }

    starts.push(total - tile);
    starts.sort_unstable();
    starts.dedup();
    starts
}

pub(crate) fn centered_crop(
    gray_image: &image::GrayImage,
    width: u32,
    height: u32,
) -> image::GrayImage {
    let crop_width = width.min(gray_image.width());
    let crop_height = height.min(gray_image.height());
    let x = (gray_image.width() - crop_width) / 2;
    let y = (gray_image.height() - crop_height) / 2;

    image::imageops::crop_imm(gray_image, x, y, crop_width, crop_height).to_image()
}

pub(crate) fn decode_qr_from_large_gray_image(gray_image: &image::GrayImage) -> Option<String> {
    let width = gray_image.width();
    let height = gray_image.height();
    let max_dimension = width.max(height);

    // Primeiro tentamos recortes centrais. Na tela de configuração 2FA, o QR quase sempre
    // fica no centro da janela do navegador, como no cenário relatado pelo usuário.
    for size in [420, 560, 720, 900, 1100, 1400, 1700] {
        if size > max_dimension.saturating_add(200) {
            continue;
        }

        let crop = centered_crop(gray_image, size.min(width), size.min(height));
        if let Some(content) = decode_qr_from_gray_image(&crop) {
            return Some(content);
        }
    }

    // Depois varremos a tela com recortes sobrepostos. Isso evita pedir recorte manual e
    // resolve QR pequeno dentro de uma captura de desktop grande.
    for size in [420, 560, 720, 900, 1100, 1400] {
        let tile_width = size.min(width);
        let tile_height = size.min(height);

        if tile_width < 180 || tile_height < 180 {
            continue;
        }

        for y in tile_starts(height, tile_height) {
            for x in tile_starts(width, tile_width) {
                let crop =
                    image::imageops::crop_imm(gray_image, x, y, tile_width, tile_height).to_image();
                if let Some(content) = decode_qr_from_gray_image(&crop) {
                    return Some(content);
                }
            }
        }
    }

    None
}

pub(crate) fn decode_qr_from_dynamic_image(
    decoded_image: &image::DynamicImage,
) -> Result<String, String> {
    validate_qr_image_dimensions(decoded_image.width(), decoded_image.height())?;

    let gray_image = decoded_image.to_luma8();

    if let Some(content) = decode_qr_from_gray_image(&gray_image) {
        return Ok(content);
    }

    if gray_image.width().max(gray_image.height()) > 900 {
        if let Some(content) = decode_qr_from_large_gray_image(&gray_image) {
            return Ok(content);
        }
    }

    Err("error.qr.notFound".to_string())
}

pub(crate) fn encode_qr_capture_as_png_data_url(
    image: &image::DynamicImage,
) -> Result<String, String> {
    validate_qr_image_dimensions(image.width(), image.height())?;

    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|_| "error.capture.prepare".to_string())?;
    let bytes = cursor.into_inner();

    if bytes.len() > MAX_QR_IMAGE_BYTES.saturating_mul(2) {
        return Err(
            "A captura ficou grande demais. Deixe apenas o QR visível e tente novamente."
                .to_string(),
        );
    }

    Ok(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub(crate) async fn decode_qr_from_image_data_url(data_url: String) -> Result<String, String> {
    run_blocking(move || decode_qr_from_image_data_url_blocking(data_url)).await
}

pub(crate) fn decode_qr_from_image_data_url_blocking(data_url: String) -> Result<String, String> {
    let encoded = data_url
        .split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(data_url.as_str());

    let image_bytes = general_purpose::STANDARD
        .decode(encoded.as_bytes())
        .map_err(|_| "error.qr.invalidImage".to_string())?;

    if image_bytes.len() > MAX_QR_IMAGE_BYTES {
        return Err("error.qr.imageTooLarge".to_string());
    }

    let (width, height) = read_qr_image_dimensions(&image_bytes)?;
    validate_qr_image_dimensions(width, height)?;

    let decoded_image =
        image::load_from_memory(&image_bytes).map_err(|_| "error.qr.openImage".to_string())?;

    decode_qr_from_dynamic_image(&decoded_image)
}

#[cfg(test)]
mod qr_safety_tests {
    use super::*;

    #[test]
    fn qr_dimensions_accept_reasonable_image() {
        assert!(validate_qr_image_dimensions(1024, 1024).is_ok());
    }

    #[test]
    fn qr_dimensions_reject_oversized_side() {
        assert!(validate_qr_image_dimensions(MAX_QR_IMAGE_SIDE + 1, 512).is_err());
    }

    #[test]
    fn qr_dimensions_reject_oversized_pixel_count() {
        assert!(validate_qr_image_dimensions(5001, 5001).is_err());
    }
}
