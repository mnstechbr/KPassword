import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PasswordStrength } from "./password-strength";
import {
  DRAFT_DEBOUNCE_MS,
  createStrengthEngine,
  type StrengthEngine,
} from "./strength-engine";
import type { StrengthRequest, StrengthResponse } from "./strength-worker";

/**
 * Testes do motor de forca. O Worker real e substituido por um duble, de modo
 * que zxcvbn nunca e carregado aqui: o que se verifica e o protocolo, o cache,
 * a invalidacao por revisao, o descarte de respostas velhas e o ciclo de vida.
 *
 * Todos deterministicos, com temporizadores falsos.
 */

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<StrengthResponse>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: StrengthRequest[] = [];
  terminated = false;

  constructor(
    public readonly url: URL | string,
    public readonly options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(request: StrengthRequest) {
    this.sent.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  /** Simula a resposta do worker para uma requisicao ja enviada. */
  reply(requestId: number, guessesLog10: number) {
    const request = this.sent.find((item) => item.requestId === requestId);
    if (!request) throw new Error(`requestId ${requestId} nao foi enviado`);
    this.onmessage?.({
      data: { type: "result", requestId, key: request.key, guessesLog10 },
    } as MessageEvent<StrengthResponse>);
  }
}

const SENHA = "senha-de-teste-nao-real";

let engine: StrengthEngine;
let credentialResults: Array<{ id: string; strength: PasswordStrength }>;
let draftResults: Array<PasswordStrength | null>;

function worker(index = 0) {
  const instance = FakeWorker.instances[index];
  if (!instance) throw new Error("worker ainda nao foi criado");
  return instance;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  credentialResults = [];
  draftResults = [];
  vi.stubGlobal("Worker", FakeWorker);
  engine = createStrengthEngine({
    onCredentialResult: (id, strength) => credentialResults.push({ id, strength }),
    onDraftResult: (strength) => draftResults.push(strength),
  });
});

afterEach(() => {
  engine.destroy();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("criacao preguicosa do worker", () => {
  it("nao cria worker sem trabalho", () => {
    vi.runAllTimers();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("cria o worker como modulo de mesma origem no primeiro uso", () => {
    engine.analyzeVault([{ id: "a", updatedAt: "T1", password: SENHA }]);
    vi.runAllTimers();

    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker().options?.type).toBe("module");
    // URL de mesma origem produzida pelo Vite; nunca blob: nem data:
    expect(String(worker().url)).not.toMatch(/^blob:|^data:/);
  });
});

describe("protocolo com o worker", () => {
  it("envia chave derivada de id e revisao, nunca a senha", () => {
    engine.analyzeVault([{ id: "cred-1", updatedAt: "T1", password: SENHA }]);
    vi.runAllTimers();

    const request = worker().sent[0];
    expect(request.key).toBe("cred-1:T1");
    expect(request.key).not.toContain(SENHA);
  });

  it("respeita o limite de requisicoes em voo", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: `c${index}`,
      updatedAt: "T1",
      password: SENHA,
    }));
    engine.analyzeVault(items);
    vi.runAllTimers();

    // Backpressure: nao despeja as 10 mensagens de uma vez.
    expect(worker().sent.length).toBeLessThan(items.length);
    expect(worker().sent.length).toBeGreaterThan(0);
  });

  it("prossegue a fila conforme os resultados chegam", () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `c${index}`,
      updatedAt: "T1",
      password: SENHA,
    }));
    engine.analyzeVault(items);
    vi.runAllTimers();

    for (let guard = 0; guard < 50 && credentialResults.length < items.length; guard += 1) {
      const pending = worker().sent.filter(
        (request) => !credentialResults.some((r) => `${r.id}:T1` === request.key),
      );
      if (pending.length === 0) break;
      worker().reply(pending[0].requestId, 12);
      vi.runAllTimers();
    }

    expect(credentialResults).toHaveLength(items.length);
  });
});

describe("cache por identidade + revisao", () => {
  it("nao reanalisa a mesma revisao", () => {
    const item = { id: "cred-1", updatedAt: "T1", password: SENHA };
    engine.analyzeVault([item]);
    vi.runAllTimers();
    worker().reply(worker().sent[0].requestId, 11);

    engine.analyzeVault([item]);
    vi.runAllTimers();

    expect(worker().sent).toHaveLength(1);
    expect(engine.get("cred-1", "T1")?.guessesLog10).toBe(11);
  });

  it("uma nova revisao invalida o resultado anterior", () => {
    engine.analyzeVault([{ id: "cred-1", updatedAt: "T1", password: SENHA }]);
    vi.runAllTimers();
    worker().reply(worker().sent[0].requestId, 11);

    // A senha mudou; App.tsx sempre atualiza updatedAt nesse caso.
    engine.analyzeVault([{ id: "cred-1", updatedAt: "T2", password: "outra" }]);
    vi.runAllTimers();

    expect(worker().sent).toHaveLength(2);
    expect(worker().sent[1].key).toBe("cred-1:T2");
    // O resultado antigo continua acessivel pela chave antiga, e a nova ainda
    // esta pendente -- nunca se reaproveita o veredito da revisao anterior.
    expect(engine.get("cred-1", "T2")).toBeNull();
  });

  it("get devolve null enquanto pendente", () => {
    engine.analyzeVault([{ id: "cred-1", updatedAt: "T1", password: SENHA }]);
    vi.runAllTimers();
    expect(engine.get("cred-1", "T1")).toBeNull();
  });

  it("ignora credenciais sem senha", () => {
    engine.analyzeVault([{ id: "cred-1", updatedAt: "T1", password: "" }]);
    vi.runAllTimers();
    expect(FakeWorker.instances).toHaveLength(0);
  });
});

describe("senha em edicao", () => {
  it("aplica debounce em vez de analisar a cada tecla", () => {
    engine.analyzeDraft("a");
    engine.analyzeDraft("ab");
    engine.analyzeDraft("abc");
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 1);
    expect(FakeWorker.instances).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(worker().sent).toHaveLength(1);
    expect(worker().sent[0].password).toBe("abc");
  });

  it("resposta antiga nao sobrescreve requisicao mais recente", () => {
    engine.analyzeDraft("primeira");
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    const antiga = worker().sent[0].requestId;

    engine.analyzeDraft("segunda");
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    const nova = worker().sent[1].requestId;

    // Chegam fora de ordem: a nova primeiro, depois a antiga.
    worker().reply(nova, 20);
    worker().reply(antiga, 2);

    expect(draftResults[draftResults.length - 1]?.guessesLog10).toBe(20);
    expect(draftResults.map((r) => r?.guessesLog10)).not.toContain(2);
  });

  it("senha vazia limpa o resultado sem chamar o worker", () => {
    engine.analyzeDraft("");
    vi.runAllTimers();
    expect(draftResults[draftResults.length - 1]).toBeNull();
    expect(FakeWorker.instances).toHaveLength(0);
  });
});

describe("ciclo de vida no lock", () => {
  it("destroy encerra o worker", () => {
    engine.analyzeVault([{ id: "cred-1", updatedAt: "T1", password: SENHA }]);
    vi.runAllTimers();
    const instance = worker();

    engine.destroy();

    expect(instance.terminated).toBe(true);
    expect(instance.onmessage).toBeNull();
  });

  it("destroy limpa o cache de resultados", () => {
    engine.analyzeVault([{ id: "cred-1", updatedAt: "T1", password: SENHA }]);
    vi.runAllTimers();
    worker().reply(worker().sent[0].requestId, 11);
    expect(engine.get("cred-1", "T1")).not.toBeNull();

    engine.destroy();

    expect(engine.get("cred-1", "T1")).toBeNull();
  });

  it("destroy esvazia a fila e nao envia mais nada", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: `c${index}`,
      updatedAt: "T1",
      password: SENHA,
    }));
    engine.analyzeVault(items);
    vi.runAllTimers();
    const enviadasAntes = worker().sent.length;

    engine.destroy();
    vi.runAllTimers();

    expect(worker().sent).toHaveLength(enviadasAntes);
  });

  it("apos destroy, novas solicitacoes sao ignoradas", () => {
    engine.destroy();
    engine.analyzeVault([{ id: "cred-1", updatedAt: "T1", password: SENHA }]);
    engine.analyzeDraft("qualquer");
    vi.runAllTimers();

    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("resultados que chegam apos destroy nao sao propagados", () => {
    engine.analyzeVault([{ id: "cred-1", updatedAt: "T1", password: SENHA }]);
    vi.runAllTimers();
    const instance = worker();
    const requestId = instance.sent[0].requestId;
    const handler = instance.onmessage;

    engine.destroy();

    handler?.({
      data: { type: "result", requestId, key: "cred-1:T1", guessesLog10: 11 },
    } as MessageEvent<StrengthResponse>);

    expect(credentialResults).toHaveLength(0);
  });
});
