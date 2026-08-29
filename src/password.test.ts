import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PASSWORD_POLICY,
  PIN_ALPHABET,
  drawMemorableCasePattern,
  generatePassword,
  generateStrongPassword,
  isDegenerateCasePattern,
  memorableEntropyBits,
  memorableEntropyBreakdown,
  memorableWordCountForPolicy,
} from "./password";
import { WORDLIST_MIN_SIZE, WORDS } from "./wordlist";

/**
 * Testes de regressao para os achados da auditoria (Fase 2):
 *
 * - achado B: o modo memorizavel padrao produzia ~25,6 bits e a interface o
 *   classificava como "Forte" com pontuacao 100;
 * - achado C: generatePin excluia o digito "1" do alfabeto.
 *
 * Nenhum teste depende de sorteio. Onde o gerador e exercitado, a asseveracao
 * recai sobre propriedades estruturais validas para qualquer saida possivel, ou
 * o gerador de numeros aleatorios e substituido por uma sequencia fixa.
 */

/**
 * Substitui crypto.getRandomValues por uma sequencia deterministica.
 * randomIndex(n) devolve `values[k] % n`; com valores menores que n, devolve
 * exatamente `values[k]`, permitindo dirigir cada sorteio individualmente.
 */
function stubRandomSequence(values: readonly number[]) {
  let cursor = 0;
  return vi
    .spyOn(globalThis.crypto, "getRandomValues")
    .mockImplementation(((array: Uint32Array) => {
      array[0] = values[cursor % values.length];
      cursor += 1;
      return array;
    }) as typeof globalThis.crypto.getRandomValues);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wordlist", () => {
  it("atende ao tamanho minimo exigido pela politica", () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(WORDLIST_MIN_SIZE);
  });

  it("nao contem entradas duplicadas", () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });

  it("contem apenas letras minusculas sem acento, de 3 a 12 caracteres", () => {
    expect(WORDS.filter((word) => !/^[a-z]{3,12}$/.test(word))).toEqual([]);
  });
});

describe("alfabeto do PIN (achado C)", () => {
  it("a constante e exatamente o alfabeto decimal completo", () => {
    expect(PIN_ALPHABET).toBe("0123456789");
    expect(PIN_ALPHABET).toHaveLength(10);
    expect(new Set(PIN_ALPHABET).size).toBe(10);
  });

  it("todo digito de 0 a 9 pertence ao alfabeto", () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(PIN_ALPHABET.includes(String(digit))).toBe(true);
    }
  });

  it("generatePin percorre o alfabeto inteiro sob sorteio dirigido", () => {
    // Deterministico: cada indice sorteado e fixado em 0..9, portanto a saida
    // e exatamente o alfabeto na ordem. Isso prova que generatePin indexa o
    // alfabeto decimal completo. O alfabeto anterior era "234567890" e este
    // mesmo teste produziria "234567890" + repeticao, falhando.
    stubRandomSequence([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(generatePassword({ mode: "pin", length: 10 })).toBe("0123456789");
  });

  it("generatePin devolve o digito correspondente a cada indice sorteado", () => {
    for (let index = 0; index <= 9; index += 1) {
      stubRandomSequence([index]);
      expect(generatePassword({ mode: "pin", length: 4 })).toBe(
        String(index).repeat(4),
      );
      vi.restoreAllMocks();
    }
  });

  it("produz apenas digitos e respeita o comprimento pedido", () => {
    for (const length of [4, 6, 8, 16]) {
      const pin = generatePassword({ mode: "pin", length });
      expect(pin).toHaveLength(length);
      expect(pin).toMatch(/^[0-9]+$/);
    }
  });

  it("limita o comprimento a faixa suportada", () => {
    expect(generatePassword({ mode: "pin", length: 1 })).toHaveLength(4);
    expect(generatePassword({ mode: "pin", length: 99 })).toHaveLength(16);
  });
});

describe("formula de entropia do modo memorizavel", () => {
  it("a decomposicao soma exatamente o total", () => {
    const b = memorableEntropyBreakdown(6);
    expect(b.words + b.capitalization + b.separator + b.digits + b.symbol).toBeCloseTo(
      b.total,
      10,
    );
    expect(memorableEntropyBits(6)).toBeCloseTo(b.total, 10);
  });

  it("cada componente vale exatamente o previsto pela formula", () => {
    const n = 6;
    const b = memorableEntropyBreakdown(n);

    expect(b.words).toBeCloseTo(n * Math.log2(WORDS.length), 10);
    // log2(2^n - 2) e nao n: as duas combinacoes degeneradas sao corrigidas
    // pelo gerador apos o sorteio e por isso nao contam como entropia.
    expect(b.capitalization).toBeCloseTo(Math.log2(2 ** n - 2), 10);
    expect(b.capitalization).toBeLessThan(n);
    // O separador e sorteado UMA vez e reaplicado; conta uma unica vez.
    expect(b.separator).toBeCloseTo(Math.log2(3), 10);
    expect(b.digits).toBeCloseTo(2 * Math.log2(10), 10);
    expect(b.symbol).toBeCloseTo(Math.log2(8), 10);
  });

  it("a configuracao padrao atinge o limite minimo de entropia", () => {
    const wordCount = memorableWordCountForPolicy();
    expect(memorableEntropyBits(wordCount)).toBeGreaterThanOrEqual(
      PASSWORD_POLICY.memorableTargetBits,
    );
  });

  it("a contagem de palavras respeita o minimo da politica", () => {
    expect(memorableWordCountForPolicy()).toBeGreaterThanOrEqual(
      PASSWORD_POLICY.memorableMinWords,
    );
  });

  it("a configuracao anterior a correcao ficaria abaixo do limite", () => {
    // Achado B: 4 palavras de uma lista de 20, capitalizacao deterministica,
    // 2 digitos de 8 e 1 simbolo de 5 => ~25,6 bits.
    const legacyBits = 4 * Math.log2(20) + 0 + 2 * Math.log2(8) + Math.log2(5);
    expect(legacyBits).toBeLessThan(PASSWORD_POLICY.memorableTargetBits);
    expect(legacyBits).toBeLessThan(30);
  });

  it("um comprimento pedido menor nao reduz as palavras abaixo da politica", () => {
    const minimum = memorableWordCountForPolicy();
    for (const length of [1, 6, 12, 24]) {
      const words =
        generatePassword({ mode: "memorable", length }).match(/[A-Za-z]+/g) ?? [];
      expect(words.length).toBeGreaterThanOrEqual(minimum);
    }
  });
});

describe("uniformidade do padrao de capitalizacao", () => {
  /** Fonte de bits deterministica a partir de uma sequencia fixa. */
  function bitsFrom(sequence: readonly (0 | 1)[]) {
    let cursor = 0;
    return () => {
      const bit = sequence[cursor % sequence.length];
      cursor += 1;
      return bit === 1;
    };
  }

  it("rejeita e re-sorteia em vez de corrigir uma posicao", () => {
    // Sequencia: 4 bits tudo-zero (degenerado), 4 bits tudo-um (degenerado),
    // depois 0,1,0,1. Com rejeicao, o resultado tem de ser exatamente a
    // terceira tentativa. Com correcao a posteriori, seria a primeira
    // tentativa com uma posicao alterada.
    const pattern = drawMemorableCasePattern(
      4,
      bitsFrom([0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 1]),
    );
    expect(pattern).toEqual([false, true, false, true]);
  });

  it("aceita qualquer padrao nao degenerado sem alterar nenhum bit", () => {
    // Exaustivo para n = 4: os 14 padroes validos precisam ser devolvidos
    // exatamente como sorteados. Isso prova que cada padrao valido e imagem de
    // exatamente uma tentativa aceita, o que e a condicao de equiprobabilidade.
    let accepted = 0;
    for (let mask = 0; mask < 16; mask += 1) {
      const bits = [3, 2, 1, 0].map((shift) => ((mask >> shift) & 1) as 0 | 1);
      if (isDegenerateCasePattern(bits.map((bit) => bit === 1))) continue;
      accepted += 1;
      expect(drawMemorableCasePattern(4, bitsFrom(bits))).toEqual(
        bits.map((bit) => bit === 1),
      );
    }
    expect(accepted).toBe(2 ** 4 - 2);
  });

  it("identifica exatamente dois padroes degenerados por tamanho", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      let degenerate = 0;
      for (let mask = 0; mask < 2 ** n; mask += 1) {
        const bits = Array.from({ length: n }, (_, i) => ((mask >> i) & 1) === 1);
        if (isDegenerateCasePattern(bits)) degenerate += 1;
      }
      expect(degenerate).toBe(2);
    }
  });

  it("nunca devolve um padrao degenerado", () => {
    for (const n of [2, 4, 6, 8]) {
      for (let index = 0; index < 50; index += 1) {
        expect(isDegenerateCasePattern(drawMemorableCasePattern(n))).toBe(false);
      }
    }
  });

  it("a correcao a posteriori anterior nao era uniforme", () => {
    // Documenta por que a rejeicao e necessaria. Distribuicao analitica do
    // algoritmo antigo para n = 6, em unidades de 1/384:
    //   12 padroes (uma maiuscula ou uma minuscula): 1/64 + (1/64)(1/6) = 7/384
    //   50 padroes restantes:                        1/64               = 6/384
    const n = 6;
    const skewed = 7 / 384;
    const plain = 6 / 384;

    expect(12 * skewed + 50 * plain).toBeCloseTo(1, 12);
    expect(skewed).toBeGreaterThan(plain);

    // Min-entropia do algoritmo antigo, abaixo de log2(2^n - 2).
    const oldMinEntropy = -Math.log2(skewed);
    const uniform = Math.log2(2 ** n - 2);
    expect(oldMinEntropy).toBeLessThan(uniform);
    expect(uniform - oldMinEntropy).toBeCloseTo(0.1764, 3);

    // Com rejeicao, min-entropia e Shannon coincidem com log2(2^n - 2).
    expect(-Math.log2(1 / (2 ** n - 2))).toBeCloseTo(uniform, 12);
  });
});



describe("saida do modo memorizavel", () => {
  it("tem entropia real acima do piso de gerador forte", () => {
    // Aqui conhecemos o gerador, entao a afirmacao e sobre entropia REAL --
    // nao sobre guessability estimada, que e outro conceito (password-strength.ts).
    expect(memorableEntropyBits(memorableWordCountForPolicy())).toBeGreaterThanOrEqual(
      PASSWORD_POLICY.generatedStrongMinBits,
    );
  });

  it("contem ao menos uma palavra maiuscula e uma minuscula", () => {
    for (let index = 0; index < 60; index += 1) {
      const password = generatePassword({ mode: "memorable" });
      expect(/[a-z]/.test(password)).toBe(true);
      expect(/[A-Z]/.test(password)).toBe(true);
    }
  });

  it("usa apenas palavras do dicionario", () => {
    const dictionary = new Set(WORDS);
    for (let index = 0; index < 40; index += 1) {
      for (const word of generatePassword({ mode: "memorable" }).match(/[A-Za-z]+/g) ?? []) {
        expect(dictionary.has(word.toLowerCase())).toBe(true);
      }
    }
  });
});


describe("modo aleatorio (regressao de comportamento existente)", () => {
  it("respeita o comprimento pedido e seus limites", () => {
    expect(generatePassword({ mode: "random", length: 24 })).toHaveLength(24);
    expect(generatePassword({ mode: "random", length: 4 })).toHaveLength(8);
    expect(generatePassword({ mode: "random", length: 999 })).toHaveLength(96);
    expect(generateStrongPassword()).toHaveLength(24);
  });

  it("honra a exclusao de classes de caracteres", () => {
    for (let index = 0; index < 40; index += 1) {
      expect(
        generatePassword({
          mode: "random",
          length: 16,
          includeLowercase: false,
          includeUppercase: false,
          includeNumbers: true,
          includeSymbols: false,
        }),
      ).toMatch(/^[0-9]+$/);
    }
  });

  it("evita caracteres ambiguos quando solicitado", () => {
    for (let index = 0; index < 40; index += 1) {
      expect(
        generatePassword({ mode: "random", length: 32, avoidAmbiguous: true }),
      ).not.toMatch(/[Il1O0o]/);
    }
  });

  it("garante ao menos um caractere de cada classe habilitada", () => {
    // Propriedade estrutural garantida por construcao: generateRandomPassword
    // sorteia um caractere obrigatorio de cada grupo antes de preencher o resto.
    for (let index = 0; index < 40; index += 1) {
      const password = generateStrongPassword(24);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it("uma senha aleatoria de 24 caracteres tem todas as classes sob sorteio dirigido", () => {
    // Deterministico: o sorteio e fixado, portanto a saida e uma unica string.
    stubRandomSequence([0, 7, 3, 11, 5, 19, 2, 13, 8, 1, 17, 4, 9, 15, 6, 12]);
    const password = generateStrongPassword(24);
    expect(password).toHaveLength(24);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  it("nao retorna vazio quando todas as classes sao desabilitadas", () => {
    expect(
      generatePassword({
        mode: "random",
        length: 20,
        includeLowercase: false,
        includeUppercase: false,
        includeNumbers: false,
        includeSymbols: false,
      }),
    ).toHaveLength(20);
  });
});
