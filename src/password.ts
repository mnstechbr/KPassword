import { WORDS } from "./wordlist";

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMBERS = "23456789";
const SYMBOLS = "!@#$%&*()-_=+[]{};:,.?";
const AMBIGUOUS = "Il1O0o";

/** Digitos completos. PINs numericos nao devem excluir digitos por ambiguidade visual. */
const PIN_DIGITS = "0123456789";

/** Separadores possiveis entre palavras no modo memorizavel. */
const MEMORABLE_SEPARATORS = "-_.";
/** Simbolo final no modo memorizavel. Disjunto de MEMORABLE_SEPARATORS. */
const MEMORABLE_SYMBOLS = "!@#$%&*?";
/** Quantidade de digitos no sufixo do modo memorizavel. */
const MEMORABLE_DIGIT_COUNT = 2;

/**
 * Politica de entropia do gerador e da classificacao de forca.
 *
 * Os valores sao expressos em bits de entropia estimada, nao em comprimento
 * textual. Comprimento e classes de caracteres, isoladamente, superestimam
 * senhas baseadas em palavras de dicionario.
 *
 * Referencia de calibracao: 6 palavras Diceware (7776 palavras) ~= 77,5 bits.
 */
export const PASSWORD_POLICY = {
  /** Entropia minima que a configuracao padrao do modo memorizavel deve atingir. */
  memorableTargetBits: 72,
  /** Numero minimo de palavras no modo memorizavel, independente do comprimento pedido. */
  memorableMinWords: 5,

  /**
   * Piso de entropia REAL para considerar adequada uma configuracao de gerador
   * cuja distribuicao conhecemos. Nao se aplica a senhas arbitrarias: para
   * essas, ver STRENGTH_POLICY em password-strength.ts.
   */
  generatedStrongMinBits: 72,
} as const;

/** Alfabeto decimal completo. Exposto para permitir verificacao estrutural em teste. */
export const PIN_ALPHABET = PIN_DIGITS;

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

function randomBoolean() {
  return randomIndex(2) === 1;
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

function capitalize(word: string) {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** Verdadeiro quando o padrao e "tudo minusculo" ou "tudo maiusculo". */
export function isDegenerateCasePattern(pattern: readonly boolean[]) {
  if (pattern.length === 0) return true;
  return pattern.every(Boolean) || !pattern.some(Boolean);
}

/**
 * Sorteia o padrao de capitalizacao das palavras por AMOSTRAGEM COM REJEICAO.
 *
 * Cada tentativa sorteia `wordCount` bits uniformes e independentes. Se o
 * resultado for degenerado (tudo minusculo ou tudo maiusculo), a tentativa e
 * inteiramente descartada e um novo sorteio e feito. Nenhuma posicao e
 * corrigida a posteriori.
 *
 * Isso garante que cada um dos 2^n - 2 padroes validos tenha probabilidade
 * exatamente 1/(2^n - 2): todos vem de tentativas aceitas, todas as tentativas
 * sao uniformes sobre 2^n, e a condicao de aceitacao nao depende de qual padrao
 * valido saiu. Logo log2(2^n - 2) e a entropia exata -- de Shannon e minima.
 *
 * A correcao a posteriori usada antes desta versao NAO produzia distribuicao
 * uniforme: para n = 6, os 12 padroes com exatamente uma maiuscula ou uma
 * minuscula recebiam probabilidade 7/384 e os outros 50 recebiam 6/384, o que
 * rebaixava a min-entropia de log2(62) = 5,954 para -log2(7/384) = 5,778 bits.
 *
 * Custo esperado: 2^n / (2^n - 2) tentativas -- 1,032 para n = 6.
 *
 * `drawBit` existe para permitir teste deterministico; em producao usa o
 * gerador criptografico.
 */
export function drawMemorableCasePattern(
  wordCount: number,
  drawBit: () => boolean = randomBoolean,
): boolean[] {
  if (wordCount < 2) {
    throw new Error("O padrao de capitalizacao exige ao menos duas palavras.");
  }

  for (;;) {
    const pattern = Array.from({ length: wordCount }, drawBit);
    if (!isDegenerateCasePattern(pattern)) return pattern;
  }
}

/** Bits por palavra no modo memorizavel, considerando a capitalizacao aleatoria por palavra. */
function memorableBitsPerWord() {
  return Math.log2(WORDS.length) + 1;
}

/**
 * Bits contribuidos pelas partes fixas do formato memorizavel:
 * separador escolhido + digitos do sufixo + simbolo final.
 */
function memorableExtraBits() {
  return (
    Math.log2(MEMORABLE_SEPARATORS.length) +
    MEMORABLE_DIGIT_COUNT * Math.log2(PIN_DIGITS.length) +
    Math.log2(MEMORABLE_SYMBOLS.length)
  );
}

/**
 * Numero de palavras necessario para que o modo memorizavel atinja a politica.
 * Recalculado a partir do tamanho real da lista, de modo que encolher a lista
 * aumente a contagem de palavras em vez de silenciosamente reduzir a entropia.
 */
export function memorableWordCountForPolicy(targetBits = PASSWORD_POLICY.memorableTargetBits) {
  const perWord = memorableBitsPerWord();
  const needed = Math.ceil((targetBits - memorableExtraBits()) / perWord);
  return Math.max(PASSWORD_POLICY.memorableMinWords, needed);
}

/**
 * Decomposicao da entropia de geracao do modo memorizavel, componente a componente.
 *
 * Cada parcela corresponde a uma variavel aleatoria independente efetivamente
 * sorteada pelo gerador. Nada deterministico entra na conta:
 *
 * - `words`      n sorteios uniformes com reposicao sobre a lista -> n * log2(W)
 * - `capitalization` sorteio por REJEICAO sobre os 2^n padroes, descartando as
 *                duas combinacoes degeneradas. Os 2^n - 2 padroes restantes sao
 *                equiprovaveis, logo log2(2^n - 2), nao n. Ver
 *                drawMemorableCasePattern para a prova de uniformidade.
 * - `separator`  UM sorteio, aplicado a todas as juntas -> log2(3), contado
 *                uma unica vez e nao uma vez por junta
 * - `digits`     2 sorteios uniformes sobre 10 digitos -> 2 * log2(10)
 * - `symbol`     1 sorteio uniforme sobre 8 simbolos -> log2(8)
 *
 * Nao ha nenhuma outra fonte de aleatoriedade no formato. O comprimento do texto
 * e a posicao das partes sao deterministicos e por isso valem 0 bits.
 */
export function memorableEntropyBreakdown(wordCount: number) {
  const words = wordCount * Math.log2(WORDS.length);
  const capitalization = Math.log2(Math.pow(2, wordCount) - 2);
  const separator = Math.log2(MEMORABLE_SEPARATORS.length);
  const digits = MEMORABLE_DIGIT_COUNT * Math.log2(PIN_DIGITS.length);
  const symbol = Math.log2(MEMORABLE_SYMBOLS.length);

  return {
    wordCount,
    wordlistSize: WORDS.length,
    words,
    capitalization,
    separator,
    digits,
    symbol,
    total: words + capitalization + separator + digits + symbol,
  };
}

/**
 * Entropia exata, em bits, de uma senha produzida pelo modo memorizavel com
 * `wordCount` palavras. Ver memorableEntropyBreakdown para a decomposicao.
 */
export function memorableEntropyBits(wordCount: number) {
  if (wordCount < 2) return 0;
  return memorableEntropyBreakdown(wordCount).total;
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
  const policyWordCount = memorableWordCountForPolicy();
  const requestedWordCount = Math.round((options.length ?? 24) / 6);
  // O comprimento pedido so pode aumentar a contagem de palavras, nunca reduzi-la
  // abaixo do minimo exigido pela politica de entropia.
  const wordCount = clamp(Math.max(policyWordCount, requestedWordCount), policyWordCount, 12);

  const drawn = Array.from(
    { length: wordCount },
    () => WORDS[pickIndex(WORDS.length)],
  );
  const casePattern = drawMemorableCasePattern(wordCount);
  const words = drawn.map((word, index) =>
    casePattern[index] ? capitalize(word) : word,
  );

  const separator = pick(MEMORABLE_SEPARATORS);
  let digits = "";
  for (let index = 0; index < MEMORABLE_DIGIT_COUNT; index += 1) {
    digits += pick(PIN_DIGITS);
  }
  const symbol = pick(MEMORABLE_SYMBOLS);

  return `${words.join(separator)}${separator}${digits}${symbol}`;
}

function generatePin(options: PasswordGeneratorOptions) {
  const length = clamp(options.length ?? 6, 4, 16);
  let pin = "";

  while (pin.length < length) {
    pin += pick(PIN_DIGITS);
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

