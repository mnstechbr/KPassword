export type AppTheme = "light" | "dark" | "system";
export type FontScale = "normal" | "large";
export type Appearance = {
  theme: AppTheme;
  fontScale: FontScale;
  reduceMotion: boolean;
  compactMode: boolean;
};

export const appearanceKeys = {
  theme: "kpassword:theme",
  fontScale: "kpassword:font-scale",
  reduceMotion: "kpassword:reduce-motion",
  compactMode: "kpassword:compact-mode",
} as const;

// Old mixed profiles follow the system; explicit light/dark choices are retained.
export function normalizeTheme(value: string | null): AppTheme {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(theme: AppTheme, systemDark: boolean): "light" | "dark" {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function readAppearance(storage: Pick<Storage, "getItem">): Appearance {
  return {
    theme: normalizeTheme(storage.getItem(appearanceKeys.theme)),
    fontScale: storage.getItem(appearanceKeys.fontScale) === "large" ? "large" : "normal",
    reduceMotion: storage.getItem(appearanceKeys.reduceMotion) === "true",
    compactMode: storage.getItem(appearanceKeys.compactMode) === "true",
  };
}
