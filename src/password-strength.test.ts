import { describe, expect, it } from "vitest";

import {
  STRENGTH_POLICY,
  guessesLog10ToStrengthScore,
  isWeakStrength,
  strengthCacheKey,
  strengthLabelFromScore,
  toPasswordStrength,
} from "./password-strength";

/**
 * Modelo de guessability e escala de UI.
 *
 * Estes testes nao exercitam o zxcvbn: ele vive no worker. Aqui verificamos a
 * transformacao explicita log10(tentativas) -> score -> rotulo, o adapter e a
 * chave de cache. Todos deterministicos.
 */

describe("transformacao guessesLog10 -> strengthScore", () => {
  it("mapeia cada limiar em log10 sobre o limiar correspondente em score", () => {
    expect(guessesLog10ToStrengthScore(0)).toBe(0);
    expect(guessesLog10ToStrengthScore(STRENGTH_POLICY.weakMinLog10)).toBe(
      STRENGTH_POLICY.weakMinScore,
    );
    expect(guessesLog10ToStrengthScore(STRENGTH_POLICY.mediumMinLog10)).toBe(
      STRENGTH_POLICY.mediumMinScore,
    );
    expect(guessesLog10ToStrengthScore(STRENGTH_POLICY.strongMinLog10)).toBe(
      STRENGTH_POLICY.strongMinScore,
    );
    expect(guessesLog10ToStrengthScore(STRENGTH_POLICY.veryStrongMinLog10)).toBe(
      STRENGTH_POLICY.veryStrongMinScore,
    );
  });

  it("e monotonica, limitada a 0..100 e inteira", () => {
    let previous = -1;
    for (let tenths = 0; tenths <= 400; tenths += 1) {
      const score = guessesLog10ToStrengthScore(tenths / 10);
      expect(score).toBeGreaterThanOrEqual(previous);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
      previous = score;
    }
    expect(guessesLog10ToStrengthScore(1000)).toBe(100);
    expect(guessesLog10ToStrengthScore(-3)).toBe(0);
    expect(guessesLog10ToStrengthScore(Number.NaN)).toBe(0);
  });

  it("rotulo forte se e somente se log10 >= strongMinLog10", () => {
    // Requisito fundamental: nada abaixo do limiar pode receber "Forte"
    // nem "Muito forte". Varrido em toda a faixa util.
    for (let tenths = 0; tenths <= 400; tenths += 1) {
      const log10 = tenths / 10;
      const label = strengthLabelFromScore(guessesLog10ToStrengthScore(log10));
      const strong = label === "Forte" || label === "Muito forte";
      expect(strong).toBe(log10 >= STRENGTH_POLICY.strongMinLog10);
    }
  });
});

describe("rotulos", () => {
  it("seguem os limiares de score", () => {
    expect(strengthLabelFromScore(STRENGTH_POLICY.veryStrongMinScore)).toBe("Muito forte");
    expect(strengthLabelFromScore(STRENGTH_POLICY.strongMinScore)).toBe("Forte");
    expect(strengthLabelFromScore(STRENGTH_POLICY.strongMinScore - 1)).toBe("Média");
    expect(strengthLabelFromScore(STRENGTH_POLICY.mediumMinScore)).toBe("Média");
    expect(strengthLabelFromScore(STRENGTH_POLICY.mediumMinScore - 1)).toBe("Fraca");
    expect(strengthLabelFromScore(STRENGTH_POLICY.weakMinScore)).toBe("Fraca");
    expect(strengthLabelFromScore(STRENGTH_POLICY.weakMinScore - 1)).toBe("Muito fraca");
  });

  it("todos os rotulos produzidos tem traducao registrada em i18n", () => {
    // passwordLabelKeys em i18n.ts nao contem "Boa"; os rotulos atuais precisam
    // estar todos cobertos por aquele mapa.
    const traduzidos = new Set(["Muito fraca", "Fraca", "Média", "Forte", "Muito forte"]);
    for (let score = 0; score <= 100; score += 1) {
      expect(traduzidos.has(strengthLabelFromScore(score))).toBe(true);
    }
  });
});

describe("classificacao por categoria (calibracao medida do zxcvbn)", () => {
  // Os valores de log10 vem das medicoes registradas na Fase 3A.2 com os
  // dicionarios common + pt-br. Nao sao strings de senha: sao as FAIXAS
  // observadas por categoria, o que evita overfit a exemplos especificos.
  const categorias = [
    { nome: "sequencias / teclado", log10: [0.3, 0.7, 1.6, 2.4], maximo: "Muito fraca" },
    { nome: "palavras comuns", log10: [0.5, 2.0, 3.9], maximo: "Muito fraca" },
    { nome: "repeticoes", log10: [1.4, 2.3], maximo: "Muito fraca" },
    { nome: "datas", log10: [1.3, 3.0, 4.7], maximo: "Muito fraca" },
    { nome: "palavra + sufixo previsivel", log10: [4.1, 5.97, 6.2], maximo: "Fraca" },
    { nome: "aleatorias curtas", log10: [6.0, 7.0], maximo: "Fraca" },
    { nome: "leet de palavra comum", log10: [1.23, 8.87], maximo: "Média" },
    { nome: "frases", log10: [8.1, 10.6], maximo: "Forte" },
  ] as const;

  for (const { nome, log10, maximo } of categorias) {
    it(`"${nome}" nunca passa de "${maximo}"`, () => {
      const ordem = ["Muito fraca", "Fraca", "Média", "Forte", "Muito forte"];
      const teto = ordem.indexOf(maximo);
      for (const valor of log10) {
        const label = strengthLabelFromScore(guessesLog10ToStrengthScore(valor));
        expect(ordem.indexOf(label)).toBeLessThanOrEqual(teto);
      }
    });
  }

  it("senhas de alta guessability sao fortes ou muito fortes", () => {
    // Aleatorias longas (24-28) e memorizaveis do proprio gerador (34-37).
    for (const valor of [14, 19.72, 24, 28, 34.2, 37.2]) {
      const label = strengthLabelFromScore(guessesLog10ToStrengthScore(valor));
      expect(["Forte", "Muito forte"]).toContain(label);
    }
  });

  it("regressoes conhecidas nao sao classificadas como fortes", () => {
    // Medicoes reais: qwerty 0,70 | P@ssw0rd 1,23 | Senha123! 5,97 | Tr0ub4dor&3 8,87
    for (const valor of [0.7, 1.23, 5.97, 8.87]) {
      const label = strengthLabelFromScore(guessesLog10ToStrengthScore(valor));
      expect(label).not.toBe("Forte");
      expect(label).not.toBe("Muito forte");
    }
  });
});

describe("adapter", () => {
  it("devolve apenas grandezas derivadas, nunca a senha", () => {
    const strength = toPasswordStrength(9.5);
    expect(Object.keys(strength).sort()).toEqual(["guessesLog10", "label", "score"]);
    expect(JSON.stringify(strength)).not.toContain("password");
  });

  it("compoe score e rotulo coerentes com a politica", () => {
    const strength = toPasswordStrength(STRENGTH_POLICY.strongMinLog10);
    expect(strength.guessesLog10).toBe(STRENGTH_POLICY.strongMinLog10);
    expect(strength.score).toBe(STRENGTH_POLICY.strongMinScore);
    expect(strength.label).toBe("Forte");
  });
});

describe("chave de cache", () => {
  it("deriva de identidade e revisao, nunca da senha", () => {
    const key = strengthCacheKey("cred-1", "2026-08-29T10:00:00.000Z");
    expect(key).toBe("cred-1:2026-08-29T10:00:00.000Z");
    expect(key).not.toContain("senha");
  });

  it("muda quando a revisao muda", () => {
    expect(strengthCacheKey("cred-1", "A")).not.toBe(strengthCacheKey("cred-1", "B"));
  });

  it("senhas identicas em credenciais distintas geram chaves distintas", () => {
    // Consequencia de nao usar a senha como chave: nenhuma correlacao entre
    // credenciais que compartilham a mesma senha vaza pelo cache.
    expect(strengthCacheKey("a", "T")).not.toBe(strengthCacheKey("b", "T"));
  });
});

describe("classificacao de fraqueza no diagnostico do cofre", () => {
  it("pendente/desconhecido nunca e tratado como fraco", () => {
    expect(isWeakStrength(null)).toBe(false);
    expect(isWeakStrength(undefined)).toBe(false);
  });

  it("marca como fraco apenas abaixo do limiar da politica", () => {
    expect(isWeakStrength(toPasswordStrength(STRENGTH_POLICY.mediumMinLog10))).toBe(false);
    expect(isWeakStrength(toPasswordStrength(STRENGTH_POLICY.mediumMinLog10 - 0.5))).toBe(true);
    expect(isWeakStrength(toPasswordStrength(0.7))).toBe(true);
  });
});
