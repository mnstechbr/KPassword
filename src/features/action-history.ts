import type { ActionHistoryEntry, ActionHistoryType, PlainVault } from "../types";
import { getDateLocale, translate, type AppLanguage } from "../i18n";
import { createId } from "../lib/id";

export const ACTION_HISTORY_LIMIT = 200;
export type ActionHistoryFilter = "all" | "credentials" | "security" | "system";

export function formatActionHistoryTime(value: string, language: AppLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(getDateLocale(language), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getActionHistoryDateLabel(
  value: string,
  language: AppLanguage,
  translateText: (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => string,
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const key = getDateKey(value);
  if (key === getDateKey(today.toISOString())) return translateText("actionHistory.today");
  if (key === getDateKey(yesterday.toISOString())) return translateText("actionHistory.yesterday");

  return new Intl.DateTimeFormat(getDateLocale(language), { dateStyle: "medium" }).format(date);
}

export function normalizeActionHistory(entries: PlainVault["actionHistory"]): ActionHistoryEntry[] {
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((entry): entry is ActionHistoryEntry =>
      Boolean(
        entry &&
        typeof entry.id === "string" &&
        typeof entry.type === "string" &&
        typeof entry.createdAt === "string",
      ),
    )
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      targetName: typeof entry.targetName === "string" ? entry.targetName : undefined,
      createdAt: entry.createdAt,
    }))
    .sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime())
    .slice(0, ACTION_HISTORY_LIMIT);
}

export function createActionHistoryEntry(type: ActionHistoryType, targetName?: string): ActionHistoryEntry {
  return {
    id: createId(),
    type,
    targetName: targetName?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
}

export function addActionHistoryEntries(
  vault: PlainVault,
  entries: ActionHistoryEntry | ActionHistoryEntry[] | null | undefined,
): PlainVault {
  const safeEntries = Array.isArray(entries) ? entries : entries ? [entries] : [];
  if (safeEntries.length === 0) {
    return {
      ...vault,
      actionHistory: normalizeActionHistory(vault.actionHistory),
    };
  }

  return {
    ...vault,
    actionHistory: normalizeActionHistory([
      ...safeEntries,
      ...normalizeActionHistory(vault.actionHistory),
    ]).slice(0, ACTION_HISTORY_LIMIT),
  };
}

export function getActionHistoryCategory(type: ActionHistoryType): ActionHistoryFilter {
  if (
    type === "credential_created" ||
    type === "credential_updated" ||
    type === "credential_moved_to_trash" ||
    type === "credential_restored" ||
    type === "credential_deleted_forever" ||
    type === "trash_emptied" ||
    type === "password_copied" ||
    type === "username_copied" ||
    type === "totp_updated" ||
    type === "totp_removed" ||
    type === "attachment_added" ||
    type === "attachment_removed"
  ) {
    return "credentials";
  }

  if (
    type === "master_password_changed" ||
    type === "windows_hello_enabled" ||
    type === "windows_hello_disabled" ||
    type === "vault_unlocked" ||
    type === "vault_unlocked_windows_hello"
  ) {
    return "security";
  }

  return "system";
}

export function getFilteredActionHistory(entries: ActionHistoryEntry[], filter: ActionHistoryFilter) {
  if (filter === "all") return entries;
  return entries.filter((entry) => getActionHistoryCategory(entry.type) === filter);
}

export function groupActionHistoryEntries(entries: ActionHistoryEntry[]) {
  return entries.reduce<Array<{ key: string; createdAt: string; items: ActionHistoryEntry[] }>>((groups, entry) => {
    const key = getDateKey(entry.createdAt);
    const existing = groups.find((group) => group.key === key);

    if (existing) {
      existing.items.push(entry);
      return groups;
    }

    groups.push({ key, createdAt: entry.createdAt, items: [entry] });
    return groups;
  }, []);
}
