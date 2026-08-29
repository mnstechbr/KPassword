/**
 * Modelo de FORCA de senhas arbitrarias.
 *
 * Tres conceitos distintos convivem no KPassword e nao devem ser confundidos:
 *
 * A. generatedEntropyBits  (password.ts / memorableEntropyBreakdown)
 *    Bits de entropia REAIS. So existe quando conhecemos o algoritmo gerador e
 *    sua distribuicao. Unidade: bits.
 *
 * B. passwordGuessability  (este modulo, alimentado por zxcvbn)
 *    Estimativa de quantas tentativas um atacante precisaria. Aplica-se a
 *    senhas de origem desconhecida -- armazenadas ou digitadas. Unidade:
 *    log10(tentativas). NAO e entropia criptografica: nao conhecemos o processo
 *    que gerou a senha, apenas reconhecemos padroes nela.
 *
 * C. strengthScore  (este modulo)
 *    Representacao 0-100 para a interface, derivada de (B) por transformacao
 *    explicita e testada. Nao e bits nem tentativas.
 *
 * Este modulo e puro: nao importa zxcvbn e nao toca no worker. Isso o mantem
 * testavel isoladamente e mantem o custo de zxcvbn fora do bundle principal.
 */

export type StrengthLabel =
  | "Muito fraca"
  | "Fraca"
  | "Média"
  | "Forte"
  | "Muito forte";

/**
 * Limiares em log10(tentativas), calibrados sobre medicoes reais do zxcvbn
 * com os dicionarios common + pt-br (ver Fase 3A.2):
 *
 *   sequencias / teclado / repeticoes   0,3 - 2,4
 *   palavras comuns                     0,5 - 3,9
 *   datas                               1,3 - 4,7
 *   palavra + sufixo previsivel         4,1 - 6,2
 *   aleatorias curtas (6-8 chars)       6,0 - 7,0
 *   frases                              8,1 - 10,6
 *   aleatorias longas (24+ chars)       24  - 28
 *   memorizaveis do proprio gerador     34  - 37
 *
 * Os cortes ficam nas fronteiras naturais dessas faixas, nao em valores
 * escolhidos para preservar a numeracao anterior.
 */
export const STRENGTH_POLICY = {
  /** 10^6 tentativas: cai para ataque online sem limitacao de taxa. */
  weakMinLog10: 6,
  /** 10^8: cai trivialmente para ataque offline. */
  mediumMinLog10: 8,
  /** 10^10 */
  strongMinLog10: 10,
  /** 10^14: resistente a ataque offline com hashing rapido. */
  veryStrongMinLog10: 14,

  weakMinScore: 25,
  mediumMinScore: 50,
  strongMinScore: 75,
  veryStrongMinScore: 100,

  /**
   * O diagnostico do cofre marca como fraca toda senha com score ABAIXO deste
   * valor, isto e, menos de 10^8 tentativas estimadas.
   */
  vaultWeakMaxScore: 50,
} as const;

/** Resultado derivado. Nunca contem a senha nem o objeto bruto do zxcvbn. */
export type PasswordStrength = {
  /** log10(tentativas estimadas). Nao e entropia. */
  guessesLog10: number;
  /** Escala 0-100 da interface. */
  score: number;
  label: StrengthLabel;
};

/**
 * Converte log10(tentativas) na escala 0-100 da interface.
 *
 * Linear por partes, ancorada de modo que cada limiar em log10 caia exatamente
 * sobre o limiar correspondente em score:
 *
 *   log10  0 -> score   0
 *   log10  6 -> score  25
 *   log10  8 -> score  50
 *   log10 10 -> score  75
 *   log10 14 -> score 100
 *
 * Usa Math.floor: arredondar para cima permitiria que um valor logo abaixo de
 * um limiar alcancasse o score do limiar seguinte, quebrando a equivalencia
 * score >= strongMinScore <=> log10 >= strongMinLog10. Nas ancoras a razao e 0,
 * portanto o valor exato do limiar e preservado.
 */
export function guessesLog10ToStrengthScore(guessesLog10: number) {
  if (!Number.isFinite(guessesLog10) || guessesLog10 <= 0) return 0;

  const anchors: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [STRENGTH_POLICY.weakMinLog10, STRENGTH_POLICY.weakMinScore],
    [STRENGTH_POLICY.mediumMinLog10, STRENGTH_POLICY.mediumMinScore],
    [STRENGTH_POLICY.strongMinLog10, STRENGTH_POLICY.strongMinScore],
    [STRENGTH_POLICY.veryStrongMinLog10, STRENGTH_POLICY.veryStrongMinScore],
  ];

  const last = anchors[anchors.length - 1];
  if (guessesLog10 >= last[0]) return last[1];

  for (let index = 1; index < anchors.length; index += 1) {
    const [lowLog, lowScore] = anchors[index - 1];
    const [highLog, highScore] = anchors[index];
    if (guessesLog10 < highLog) {
      const ratio = (guessesLog10 - lowLog) / (highLog - lowLog);
      return Math.floor(lowScore + ratio * (highScore - lowScore));
    }
  }

  return last[1];
}

export function strengthLabelFromScore(score: number): StrengthLabel {
  if (score >= STRENGTH_POLICY.veryStrongMinScore) return "Muito forte";
  if (score >= STRENGTH_POLICY.strongMinScore) return "Forte";
  if (score >= STRENGTH_POLICY.mediumMinScore) return "Média";
  if (score >= STRENGTH_POLICY.weakMinScore) return "Fraca";
  return "Muito fraca";
}

/**
 * Adapter: converte a UNICA grandeza que atravessa a fronteira do worker no
 * resultado derivado usado pela aplicacao.
 *
 * O objeto ZxcvbnResult contem o campo `password` (eco da senha analisada) e a
 * `sequence` completa dos casamentos, que tambem carrega trechos da senha.
 * Nenhum dos dois sai do worker: o worker envia apenas `guessesLog10`.
 */
export function toPasswordStrength(guessesLog10: number): PasswordStrength {
  const score = guessesLog10ToStrengthScore(guessesLog10);
  return { guessesLog10, score, label: strengthLabelFromScore(score) };
}

/** Chave de cache de uma credencial. Derivada de identidade e revisao, nunca da senha. */
export function strengthCacheKey(credentialId: string, updatedAt: string) {
  return `${credentialId}:${updatedAt}`;
}

/** Verdadeiro quando o diagnostico do cofre deve marcar a senha como fraca. */
export function isWeakStrength(strength: PasswordStrength | null | undefined) {
  if (!strength) return false; // pendente/desconhecido nunca e tratado como fraco
  return strength.score < STRENGTH_POLICY.vaultWeakMaxScore;
}
