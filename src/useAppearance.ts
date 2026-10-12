import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { appearanceKeys, readAppearance, resolveTheme, type Appearance } from "./appearance";

const CHANGE_EVENT = "kpassword:appearance-changed";

/** Shared by the main window and the separate Secrets Bridge approval WebView. */
export function useAppearance() {
  const [appearance, setAppearance] = useState(() => readAppearance(localStorage));

  useEffect(() => {
    const sync = () => setAppearance(readAppearance(localStorage));
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || Object.values(appearanceKeys).some((key) => key === event.key)) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, sync);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void listen(CHANGE_EVENT, sync).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      }).catch(() => {});
    }
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    const color = window.matchMedia("(prefers-color-scheme: dark)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let nativeDark: boolean | undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const apply = () => {
      if (disposed) return;
      const root = document.documentElement;
      root.dataset.theme = resolveTheme(appearance.theme, nativeDark ?? color.matches);
      root.dataset.fontScale = appearance.fontScale;
      root.dataset.motion = appearance.reduceMotion || motion.matches ? "reduced" : "normal";
      root.dataset.density = appearance.compactMode ? "compact" : "normal";
    };
    apply();
    color.addEventListener("change", apply);
    motion.addEventListener("change", apply);
    if (isTauri()) {
      const appWindow = getCurrentWindow();
      void appWindow.setTheme(appearance.theme === "system" ? null : appearance.theme)
        .then(() => appWindow.theme()).then((theme) => {
          if (theme !== null) nativeDark = theme === "dark";
          apply();
        }).catch(() => {});
      void appWindow.onThemeChanged(({ payload }) => {
        nativeDark = payload === "dark";
        apply();
      }).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      }).catch(() => {});
    }
    return () => {
      disposed = true;
      unlisten?.();
      color.removeEventListener("change", apply);
      motion.removeEventListener("change", apply);
    };
  }, [appearance]);

  function update<K extends keyof Appearance>(key: K, value: Appearance[K]) {
    localStorage.setItem(appearanceKeys[key], String(value));
    setAppearance(readAppearance(localStorage));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    if (isTauri()) void emit(CHANGE_EVENT).catch(() => {});
  }

  return {
    ...appearance,
    setTheme: (value: Appearance["theme"]) => update("theme", value),
    setFontScale: (value: Appearance["fontScale"]) => update("fontScale", value),
    setReduceMotion: (value: boolean) => update("reduceMotion", value),
    setCompactMode: (value: boolean) => update("compactMode", value),
  };
}
