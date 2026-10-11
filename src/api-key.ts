// Limit injection to secret variables, never loader/shell/runtime configuration.
export function validSecretIdentifier(identifier: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,63}_(API_KEY|TOKEN|SECRET)$/.test(identifier);
}

export function validateApiKey(secret: string, identifier: string): string | null {
  if (!secret.trim() || secret.includes("\0") || new TextEncoder().encode(secret).length > 16_384) {
    return "api.secretInvalid";
  }
  return validSecretIdentifier(identifier) ? null : "api.identifierInvalid";
}
