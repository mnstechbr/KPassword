export const CLIPBOARD_CLEAR_SECONDS = 60;
export const DEFAULT_VAULT_NAME = "vault";
export const UPDATE_GITHUB_OWNER = "mnstechbr";
export const UPDATE_GITHUB_REPO = "KPassword";
export const PASSWORD_ROTATION_DAYS = 30;

export type StartupStatus = {
  enabled: boolean;
  registry_key: string;
  value_name: string;
  command_line: string;
  startup_argument: string;
};

export const DEFAULT_STARTUP_STATUS: StartupStatus = {
  enabled: false,
  registry_key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
  value_name: "KPassword",
  command_line: "",
  startup_argument: "--startup",
};
