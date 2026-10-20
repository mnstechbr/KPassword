import { invoke } from "@tauri-apps/api/core";

export function normalizeUrl(url: string) {
  const trimmed = url.trim();

  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export async function openExternalUrl(url: string) {
  const normalized = normalizeUrl(url);

  if (!normalized) {
    return false;
  }

  await invoke("open_external_url", { url: normalized });
  return true;
}
