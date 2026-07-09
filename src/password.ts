const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMBERS = "23456789";
const SYMBOLS = "!@#$%&*()-_=+[]{};:,.?";
const AMBIGUOUS = "Il1O0o";

const WORDS = [
  "rio",
  "sol",
  "casa",
  "nuvem",
  "pedra",
  "vento",
  "foco",
  "luz",
  "trilha",
  "campo",
  "chave",
  "cofre",
  "ponte",
  "mapa",
  "porto",
  "verde",
  "azul",
  "forte",
  "rapido",
  "seguro",
];

export type PasswordGeneratorMode = "random" | "memorable" | "pin";

export type PasswordGeneratorOptions = {
  mode?: PasswordGeneratorMode;
  length?: number;
  includeLowercase?: boolean;
  includeUppercase?: boolean;
  includeNumbers?: boolean;
  includeSymbols?: boolean;
  avoidAmbiguous?: boolean;
};

function randomIndex(length: number) {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new Error("Invalid random range.");
  }

  const maxValid = Math.floor(0x100000000 / length) * length;
  const array = new Uint32Array(1);

  do {
    crypto.getRandomValues(array);
  } while (array[0] >= maxValid);

  return array[0] % length;
}

function pick(chars: string) {
  return chars[randomIndex(chars.length)];
}

function pickIndex(length: number) {
  return randomIndex(length);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function removeAmbiguous(chars: string) {
  return chars
    .split("")
    .filter((char) => !AMBIGUOUS.includes(char))
    .join("");
}

function shuffle(value: string[]) {
  const result = [...value];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }

  return result.join("");
}

function generateRandomPassword(options: PasswordGeneratorOptions) {
  const length = clamp(options.length ?? 24, 8, 96);
  const groups = [
    options.includeLowercase !== false ? LOWER : "",
    options.includeUppercase !== false ? UPPER : "",
    options.includeNumbers !== false ? NUMBERS : "",
    options.includeSymbols !== false ? SYMBOLS : "",
  ]
    .filter(Boolean)
    .map((group) => (options.avoidAmbiguous ? removeAmbiguous(group) : group))
    .filter(Boolean);

  const safeGroups = groups.length > 0 ? groups : [LOWER, UPPER, NUMBERS, SYMBOLS];
  const all = safeGroups.join("");
  const required = safeGroups.map((group) => pick(group));

  while (required.length < length) {
    required.push(pick(all));
  }

  return shuffle(required);
}

function generateMemorablePassword(options: PasswordGeneratorOptions) {
  const wordCount = clamp(Math.round((options.length ?? 24) / 6), 3, 8);
  const words: string[] = [];

  for (let index = 0; index < wordCount; index += 1) {
    const word = WORDS[pickIndex(WORDS.length)] ?? "seguro";
    words.push(index % 2 === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  }

  const suffix = `${pick(NUMBERS)}${pick(NUMBERS)}`;
  const symbol = options.includeSymbols === false ? "" : pick("-_+@#");

  return `${words.join("-")}${symbol}${suffix}`;
}

function generatePin(options: PasswordGeneratorOptions) {
  const length = clamp(options.length ?? 6, 4, 16);
  let pin = "";

  while (pin.length < length) {
    pin += pick(NUMBERS + "0");
  }

  return pin;
}

export function generatePassword(options: PasswordGeneratorOptions = {}) {
  if (options.mode === "memorable") return generateMemorablePassword(options);
  if (options.mode === "pin") return generatePin(options);
  return generateRandomPassword(options);
}

export function generateStrongPassword(length = 24) {
  return generatePassword({
    mode: "random",
    length,
    includeLowercase: true,
    includeUppercase: true,
    includeNumbers: true,
    includeSymbols: true,
    avoidAmbiguous: true,
  });
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
