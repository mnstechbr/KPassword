export function getStoredValue<T extends string>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);

    if (!value) return fallback;

    return value as T;
  } catch {
    return fallback;
  }
}
