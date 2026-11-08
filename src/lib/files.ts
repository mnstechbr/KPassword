export function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Erro ao ler arquivo."));
    reader.readAsText(file, "utf-8");
  });
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Erro ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}

// Decodifica localmente: a CSP não libera fetch() de URLs data:.
export async function dataUrlToImageFile(dataUrl: string, filename: string) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Imagem inválida.");
  const [, mimeType, base64, payload] = match;
  const bytes = base64
    ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload));
  return new File([bytes], filename, { type: mimeType || "image/png" });
}

export function downloadTextFile(filename: string, content: string, mimeType = "application/json;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Salva um anexo sempre como bytes opacos (application/octet-stream). Um anexo
 * HTML ou SVG nunca é aberto ou interpretado dentro da janela do app, mesmo se o
 * WebView decidir navegar em vez de baixar.
 */
export function downloadDataUrl(filename: string, dataUrl: string) {
  const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return;
  const [, base64, payload] = match;
  const bytes = base64
    ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeExportFilename(value: string) {
  const clean = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return clean || "kpassword";
}
