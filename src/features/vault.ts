import type { VaultFileInfo, PlainVault } from "../types";
import { CLIPBOARD_CLEAR_SECONDS, DEFAULT_VAULT_NAME } from "../constants";
import { normalizeActionHistory } from "./action-history";

export function getVaultDisplayName(vaultName: string, vaultFiles: VaultFileInfo[]) {
  const found = vaultFiles.find((item) => item.name === vaultName);

  if (found) return found.display_name;
  if (vaultName === DEFAULT_VAULT_NAME) return "Principal";

  return vaultName.replace(/[-_]+/g, " ");
}

export function normalizeVault(vault: PlainVault): PlainVault {
  const now = new Date().toISOString();

  return {
    ...vault,
    credentials: (vault.credentials ?? []).map((credential) => {
      const itemType = credential.itemType ?? "credential";

      return {
        ...credential,
        itemType,
        username: credential.username ?? "",
        password: credential.password ?? "",
        url: credential.url ?? "",
        notes: credential.notes ?? "",
        favorite: credential.favorite ?? false,
        passwordChangedAt:
          itemType === "credential"
            ? credential.passwordChangedAt ?? credential.updatedAt ?? credential.createdAt ?? now
            : credential.passwordChangedAt,
        passwordExpiresInDays: itemType === "credential" ? credential.passwordExpiresInDays ?? 0 : credential.passwordExpiresInDays ?? 0,
        passwordExpiryNoticeDays: itemType === "credential" ? credential.passwordExpiryNoticeDays ?? 15 : credential.passwordExpiryNoticeDays ?? 15,
        passwordHistory: Array.isArray(credential.passwordHistory) ? credential.passwordHistory : [],
        attachments: Array.isArray(credential.attachments) ? credential.attachments : [],
        totpSecret: credential.totpSecret ?? "",
        totpIssuer: credential.totpIssuer ?? "",
        cardholderName: credential.cardholderName ?? "",
        cardNumber: credential.cardNumber ?? "",
        cardExpiry: credential.cardExpiry ?? "",
        cardCvv: credential.cardCvv ?? "",
        cardIssuer: credential.cardIssuer ?? "",
        identityFullName: credential.identityFullName ?? "",
        identityDocument: credential.identityDocument ?? "",
        identityEmail: credential.identityEmail ?? "",
        identityPhone: credential.identityPhone ?? "",
        identityAddress: credential.identityAddress ?? "",
        licenseProduct: credential.licenseProduct ?? "",
        licenseKey: credential.licenseKey ?? "",
        licenseOwner: credential.licenseOwner ?? "",
        licenseExpiresAt: credential.licenseExpiresAt ?? "",
      };
    }),
    actionHistory: normalizeActionHistory(vault.actionHistory),
    settings: {
      autoLockMinutes: vault.settings?.autoLockMinutes ?? 10,
      backupIntervalHours: vault.settings?.backupIntervalHours ?? 4,
      clipboardClearSeconds: vault.settings?.clipboardClearSeconds ?? CLIPBOARD_CLEAR_SECONDS,
      masterPasswordChangedAt:
        vault.settings?.masterPasswordChangedAt ?? vault.createdAt ?? now,
      lastPasswordRotationReminderAt: vault.settings?.lastPasswordRotationReminderAt,
      lockOnMinimize: vault.settings?.lockOnMinimize ?? true,
      lockOnClose: vault.settings?.lockOnClose ?? true,
      lockOnInactive: vault.settings?.lockOnInactive ?? true,
      notifyOnTray: vault.settings?.notifyOnTray ?? true,
      soundOnTray: vault.settings?.soundOnTray ?? true,
      secretsBridgeEnabled: vault.settings?.secretsBridgeEnabled ?? false,
    },
  };
}
