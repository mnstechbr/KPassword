import { useEffect } from "react";

/** Keep keyboard focus inside the topmost overlay, while leaving the wide-screen
 * credential detail panel as an ordinary region of the workspace. */
export function useDialogFocus() {
  useEffect(() => {
    let active: HTMLElement | null = null;
    const returnFocus = new WeakMap<HTMLElement, HTMLElement>();
    const previousRoles = new WeakMap<HTMLElement, [string | null, string | null]>();
    const focusable = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
    )).filter((element) => element.getClientRects().length > 0);
    const restoreRole = (dialog: HTMLElement) => {
      const previous = previousRoles.get(dialog);
      if (!previous) return;
      for (const [index, name] of ["role", "aria-modal"].entries()) {
        if (previous[index] === null) dialog.removeAttribute(name);
        else dialog.setAttribute(name, previous[index]!);
      }
    };
    const sync = () => {
      const overlays = Array.from(document.querySelectorAll<HTMLElement>(".popupOverlay, .modalOverlay, .confirmOverlay"))
        .filter((element) => getComputedStyle(element).position === "fixed" && element.getClientRects().length > 0)
        .sort((a, b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0));
      const dialog = overlays[overlays.length - 1]?.firstElementChild as HTMLElement | undefined;
      if ((dialog ?? null) === active) return;
      if (active) {
        restoreRole(active);
        const previous = returnFocus.get(active);
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      }
      active = dialog ?? null;
      if (!active) return;
      if (document.activeElement instanceof HTMLElement) returnFocus.set(active, document.activeElement);
      previousRoles.set(active, [active.getAttribute("role"), active.getAttribute("aria-modal")]);
      active.setAttribute("role", "dialog");
      active.setAttribute("aria-modal", "true");
      if (!active.hasAttribute("tabindex")) active.tabIndex = -1;
      if (!active.contains(document.activeElement)) (focusable(active)[0] ?? active).focus({ preventScroll: true });
    };
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !active) return;
      const elements = focusable(active);
      const first = elements[0] ?? active;
      const last = elements[elements.length - 1] ?? active;
      if (!active.contains(document.activeElement) || (!event.shiftKey && (document.activeElement === last || document.activeElement === active))) {
        event.preventDefault(); first.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === active)) {
        event.preventDefault(); last.focus();
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", sync);
    document.addEventListener("keydown", handleTab);
    sync();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("keydown", handleTab);
      if (active) restoreRole(active);
    };
  }, []);
}
