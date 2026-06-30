const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMBERS = "23456789";
const SYMBOLS = "!@#$%&*()-_=+[]{};:,.?";

function pick(chars: string) {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return chars[array[0] % chars.length];
}

function shuffle(value: string[]) {
  const result = [...value];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const target = array[0] % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }

  return result.join("");
}

export function generateStrongPassword(length = 24) {
  const all = LOWER + UPPER + NUMBERS + SYMBOLS;
  const required = [pick(LOWER), pick(UPPER), pick(NUMBERS), pick(SYMBOLS)];

  while (required.length < length) {
    required.push(pick(all));
  }

  return shuffle(required);
}

export function getPasswordScore(password: string) {
  let score = 0;

  if (password.length >= 12) score += 25;
  if (password.length >= 18) score += 20;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 20;
  if (/[0-9]/.test(password)) score += 15;
  if (/[^A-Za-z0-9]/.test(password)) score += 20;

  return Math.min(score, 100);
}

export function getPasswordLabel(score: number) {
  if (score >= 85) return "Forte";
  if (score >= 60) return "Boa";
  if (score >= 35) return "Fraca";
  return "Muito fraca";
}
