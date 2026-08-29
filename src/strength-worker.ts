/// <reference lib="webworker" />

/**
 * Web Worker de analise de forca de senha.
 *
 * Este e o UNICO lugar do projeto que importa zxcvbn. Consequencias desejadas:
 *
 * - o custo pesado (dicionarios + casamento de padroes) sai da main thread;
 * - os dicionarios saem do bundle principal e vao para o chunk do worker,
 *   carregado sob demanda quando o worker e criado;
 * - o objeto bruto do zxcvbn -- que contem `password` e a `sequence` completa
 *   dos casamentos -- NUNCA atravessa a fronteira do worker. Somente o numero
 *   `guessesLog10` e enviado de volta.
 *
 * Tudo e local: zxcvbn faz casamento contra dicionarios embutidos, sem rede.
 */

import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as ptBr from "@zxcvbn-ts/language-pt-br";

export type StrengthRequest = {
  /** Identificador da requisicao, ecoado na resposta para descartar respostas velhas. */
  requestId: number;
  /** Chave opaca do chamador (id:updatedAt da credencial, ou "draft"). Nunca a senha. */
  key: string;
  password: string;
  /**
   * Contexto opcional (titulo, usuario, e-mail, dominio). A API do zxcvbn ja
   * aceita; a primeira integracao nao envia nada aqui.
   */
  userInputs?: string[];
};

export type StrengthResponse =
  | { type: "result"; requestId: number; key: string; guessesLog10: number }
  | { type: "error"; requestId: number; key: string };

let engine: ZxcvbnFactory | null = null;

/** Construcao preguicosa: o custo de montar os dicionarios so ocorre no primeiro uso. */
function getEngine() {
  if (!engine) {
    engine = new ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...ptBr.dictionary },
      graphs: common.adjacencyGraphs,
      translations: ptBr.translations,
    });
  }
  return engine;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<StrengthRequest>) => {
  const { requestId, key, password, userInputs } = event.data;

  try {
    // O resultado completo fica confinado a este escopo e e descartado ao sair.
    const result = getEngine().check(password, userInputs);
    const response: StrengthResponse = {
      type: "result",
      requestId,
      key,
      guessesLog10: result.guessesLog10,
    };
    scope.postMessage(response);
  } catch {
    // Nao registrar a senha nem o erro bruto.
    const response: StrengthResponse = { type: "error", requestId, key };
    scope.postMessage(response);
  }
};
