export type Screen = "credentials" | "dashboard" | "trash" | "settings" | "backups" | "preferences";

export type ConfirmDialog = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
  resolve: (confirmed: boolean) => void;
};
