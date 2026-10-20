import { getDateLocale, type AppLanguage } from "../i18n";

export function formatDate(value?: string | number, language: AppLanguage = "pt") {
  if (!value) return "—";

  return new Intl.DateTimeFormat(getDateLocale(language), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatBytes(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 KB";

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
}
