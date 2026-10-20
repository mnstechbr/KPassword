import type { WindowsHelloStatus } from "../types";
import type { AppLanguage } from "../i18n";
import { DEFAULT_VAULT_NAME } from "../constants";

export const DEFAULT_WINDOWS_HELLO_STATUS: WindowsHelloStatus = {
  available: false,
  enabled: false,
  state: "disabled",
  reason: "",
  vault_name: DEFAULT_VAULT_NAME,
};

export function getPinUnlockLabel(language: AppLanguage) {
  const labels: Record<AppLanguage, string> = {
    pt: "Acessar com Windows Hello",
    en: "Unlock with Windows Hello",
    es: "Acceder con Windows Hello",
    tr: "Windows Hello ile ac",
  };

  return labels[language];
}
