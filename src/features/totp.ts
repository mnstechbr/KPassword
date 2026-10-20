import { invoke } from "@tauri-apps/api/core";
import { decodeQrFromImageFile } from "../totp-qr-reader";
import { dataUrlToImageFile } from "../lib/files";

export const TOTP_PERIOD_SECONDS = 30;
export const MAX_TOTP_QR_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_TOTP_QR_IMAGE_PIXELS = 25_000_000;
export const MAX_TOTP_QR_IMAGE_SIDE = 10_000;
export type TotpSetupMode = "choice" | "manual" | "preview" | "screenIntro";
export type TotpSetupSource = "image" | "manual" | "screen";

export type TotpPreview = {
  secret: string;
  issuer: string;
  account: string;
  label: string;
  digits: number;
  period: number;
  algorithm: string;
  source: TotpSetupSource;
  currentCode: string;
};

export function parseTotpCandidate(value: string, fallbackIssuer = "", source: TotpSetupSource = "manual"): Omit<TotpPreview, "currentCode"> {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("totp.error.empty");
  }

  if (/^otpauth:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const secret = normalizeTotpSecret(url.searchParams.get("secret") ?? "");
      const rawLabel = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const [labelIssuer, ...accountParts] = rawLabel.split(":");
      const account = accountParts.join(":").trim();
      const issuer = (url.searchParams.get("issuer") ?? labelIssuer ?? fallbackIssuer).trim();
      const digits = Number(url.searchParams.get("digits") ?? 6);
      const period = Number(url.searchParams.get("period") ?? TOTP_PERIOD_SECONDS);
      const algorithm = (url.searchParams.get("algorithm") ?? "SHA1").replace(/[-_]/g, "").toUpperCase();

      if (!secret) {
        throw new Error("totp.error.noSecret");
      }

      return {
        secret,
        issuer,
        account,
        label: rawLabel,
        digits,
        period,
        algorithm,
        source,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("totp.error.")) {
        throw error;
      }
      throw new Error("totp.error.invalidUrl");
    }
  }

  const secret = normalizeTotpSecret(trimmed);

  if (!secret) {
    throw new Error("totp.error.noSecret");
  }

  return {
    secret,
    issuer: fallbackIssuer.trim(),
    account: "",
    label: fallbackIssuer.trim(),
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    algorithm: "SHA1",
    source,
  };
}

export function parseTotpInput(value: string, fallbackIssuer = "") {
  const trimmed = value.trim();

  if (!trimmed) {
    return { secret: "", issuer: fallbackIssuer };
  }

  try {
    const parsed = parseTotpCandidate(trimmed, fallbackIssuer, "manual");
    return { secret: parsed.secret, issuer: parsed.issuer };
  } catch {
    return { secret: normalizeTotpSecret(trimmed), issuer: fallbackIssuer };
  }
}

export function normalizeTotpSecret(secret: string) {
  return secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function isStandardTotp(candidate: Pick<TotpPreview, "digits" | "period" | "algorithm">) {
  return candidate.digits === 6 && candidate.period === TOTP_PERIOD_SECONDS && candidate.algorithm === "SHA1";
}

export function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = normalizeTotpSecret(value);
  let bits = "";

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];

  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return new Uint8Array(bytes);
}

export function counterToBytes(counter: number) {
  const bytes = new Uint8Array(8);
  let value = BigInt(counter);

  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }

  return bytes;
}

export async function generateTotp(secret: string, timestamp = Date.now()) {
  const keyBytes = decodeBase32(secret);

  if (keyBytes.length === 0) {
    throw new Error("Invalid TOTP secret.");
  }

  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterToBytes(counter)));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

export function getTotpRemainingSeconds(timestamp = Date.now()) {
  const elapsed = Math.floor(timestamp / 1000) % TOTP_PERIOD_SECONDS;
  return TOTP_PERIOD_SECONDS - elapsed;
}

export async function decodeQrFromDataUrlBestEffort(dataUrl: string) {
  try {
    const imageFile = await dataUrlToImageFile(dataUrl, "kpassword-screen-qr.png");
    return await decodeQrFromImageFile(imageFile);
  } catch {
    return await invoke<string>("decode_qr_from_image_data_url", { dataUrl });
  }
}
