import {
  type PasswordStrength,
  strengthCacheKey,
  toPasswordStrength,
} from "./password-strength";
import type { StrengthRequest, StrengthResponse } from "./strength-worker";

/**
 * Motor de analise de forca na main thread.
 *
 * Responsabilidades:
 * - criar o worker PREGUICOSAMENTE (nada de zxcvbn no startup do app);
 * - enfileirar as credenciais do cofre com backpressure, para nao despejar
 *   centenas de mensagens de uma vez;
 * - guardar apenas RESULTADOS DERIVADOS, indexados por identidade + revisao;
 * - descartar respostas obsoletas por requestId;
 * - destruir tudo no lock do cofre.
 *
 * O cache NUNCA guarda a senha, nem hash, nem qualquer impressao digital
 * derivada da senha. A chave e `${credential.id}:${credential.updatedAt}`, que
 * muda sempre que a senha muda (verificado nos quatro caminhos de escrita de
 * senha do App.tsx).
 */

/** Quantas analises ficam em voo simultaneamente. */
const MAX_IN_FLIGHT = 2;
/** Espera entre lotes, para devolver a main thread ao navegador. */
const BATCH_IDLE_MS = 0;
/** Debounce da senha em digitacao. */
export const DRAFT_DEBOUNCE_MS = 350;
/** Chave reservada da senha em edicao. */
const DRAFT_KEY = "draft";

export type CredentialStrengthInput = {
  id: string;
  updatedAt: string;
  password: string;
};

export type StrengthEngine = {
  /** Enfileira as credenciais do cofre que ainda nao tem resultado. */
  analyzeVault: (items: readonly CredentialStrengthInput[]) => void;
  /** Analisa a senha em edicao, com debounce e descarte de respostas velhas. */
  analyzeDraft: (password: string) => void;
  /** Resultado ja conhecido para uma credencial, ou null se ainda pendente. */
  get: (id: string, updatedAt: string) => PasswordStrength | null;
  /** Encerra worker, fila, cache e temporizadores. */
  destroy: () => void;
};

export type StrengthEngineHandlers = {
  onCredentialResult: (id: string, strength: PasswordStrength) => void;
  onDraftResult: (strength: PasswordStrength | null) => void;
};

export function createStrengthEngine(
  handlers: StrengthEngineHandlers,
): StrengthEngine {
  /** Cache de resultados derivados. Chave: `${id}:${updatedAt}`. */
  const cache = new Map<string, PasswordStrength>();
  /** Fila de trabalho. Guarda a senha apenas enquanto o item aguarda envio. */
  let queue: CredentialStrengthInput[] = [];
  /** Chaves ja enfileiradas ou em voo, para nao duplicar trabalho. */
  const scheduled = new Set<string>();
  /** Mapa de requisicoes em voo: requestId -> id da credencial. */
  const inFlight = new Map<number, string>();

  let worker: Worker | null = null;
  let destroyed = false;
  let nextRequestId = 1;
  /** requestId da ultima analise de rascunho pedida. Respostas anteriores sao ignoradas. */
  let draftRequestId = 0;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;

  function getWorker() {
    if (destroyed) return null;
    if (!worker) {
      // Padrao suportado pelo Vite: o worker vira um chunk separado servido da
      // mesma origem. Nao usa blob: nem eval, logo satisfaz `script-src 'self'`.
      worker = new Worker(new URL("./strength-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<StrengthResponse>) =>
        handleResponse(event.data);
      worker.onerror = () => {
        // Falha do worker nao pode derrubar a aplicacao: a UI simplesmente
        // permanece sem resultado de forca.
        inFlight.clear();
        queue = [];
      };
    }
    return worker;
  }

  function handleResponse(response: StrengthResponse) {
    if (destroyed) return;

    const credentialId = inFlight.get(response.requestId);
    inFlight.delete(response.requestId);

    if (response.type === "result") {
      const strength = toPasswordStrength(response.guessesLog10);

      if (response.key === DRAFT_KEY) {
        // Descarta resposta antiga: so a ultima requisicao de rascunho vale.
        if (response.requestId === draftRequestId) handlers.onDraftResult(strength);
      } else {
        cache.set(response.key, strength);
        if (credentialId) handlers.onCredentialResult(credentialId, strength);
      }
    }

    pump();
  }

  function pump() {
    if (destroyed) return;
    if (pumpTimer !== null) return;
    if (queue.length === 0) return;
    if (inFlight.size >= MAX_IN_FLIGHT) return;

    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      if (destroyed) return;

      const active = getWorker();
      if (!active) return;

      while (queue.length > 0 && inFlight.size < MAX_IN_FLIGHT) {
        const item = queue.shift();
        if (!item) break;

        const key = strengthCacheKey(item.id, item.updatedAt);
        if (cache.has(key)) {
          scheduled.delete(key);
          continue;
        }

        const requestId = nextRequestId;
        nextRequestId += 1;
        inFlight.set(requestId, item.id);

        const request: StrengthRequest = {
          requestId,
          key,
          password: item.password,
        };
        active.postMessage(request);
      }

      if (queue.length > 0) pump();
    }, BATCH_IDLE_MS);
  }

  return {
    analyzeVault(items) {
      if (destroyed) return;

      for (const item of items) {
        if (!item.password) continue;
        const key = strengthCacheKey(item.id, item.updatedAt);
        if (cache.has(key) || scheduled.has(key)) continue;
        scheduled.add(key);
        queue.push(item);
      }

      pump();
    },

    analyzeDraft(password) {
      if (destroyed) return;

      if (draftTimer !== null) clearTimeout(draftTimer);

      if (!password) {
        draftRequestId = nextRequestId;
        nextRequestId += 1;
        handlers.onDraftResult(null);
        return;
      }

      draftTimer = setTimeout(() => {
        draftTimer = null;
        if (destroyed) return;

        const active = getWorker();
        if (!active) return;

        const requestId = nextRequestId;
        nextRequestId += 1;
        draftRequestId = requestId;

        const request: StrengthRequest = {
          requestId,
          key: DRAFT_KEY,
          password,
        };
        active.postMessage(request);
      }, DRAFT_DEBOUNCE_MS);
    },

    get(id, updatedAt) {
      return cache.get(strengthCacheKey(id, updatedAt)) ?? null;
    },

    destroy() {
      destroyed = true;

      if (draftTimer !== null) clearTimeout(draftTimer);
      if (pumpTimer !== null) clearTimeout(pumpTimer);
      draftTimer = null;
      pumpTimer = null;

      // Solta as referencias as senhas ainda enfileiradas antes de terminar.
      queue = [];
      scheduled.clear();
      inFlight.clear();
      cache.clear();

      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        worker = null;
      }
    },
  };
}
