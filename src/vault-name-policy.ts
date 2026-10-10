// Regra unica de nome de cofre no frontend.
//
// O backend (`sanitize_vault_name`, src-tauri/src/lib.rs) so aceita
// [A-Za-z0-9_-] com no maximo 48 caracteres. `createVaultSlug` produz um
// subconjunto estrito disso, entao todo slug aprovado aqui atravessa o
// backend sem virar erro. Manter as duas pontas coerentes evita que uma
// criacao invalida chegue ao Rust.

export const VAULT_NAME_MAX_LENGTH = 48;

export type VaultNameErrorKey = "vault.invalidName" | "vault.alreadyExists";

export type VaultNameValidation =
  | { ok: true; slug: string }
  | { ok: false; errorKey: VaultNameErrorKey };

export function createVaultSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, VAULT_NAME_MAX_LENGTH);
}

export function validateNewVaultName(rawName: string, existingNames: string[]): VaultNameValidation {
  const slug = createVaultSlug(rawName);

  if (!slug) {
    return { ok: false, errorKey: "vault.invalidName" };
  }

  if (existingNames.includes(slug)) {
    return { ok: false, errorKey: "vault.alreadyExists" };
  }

  return { ok: true, slug };
}
