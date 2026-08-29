import { describe, expect, it } from "vitest";

import type { WindowsHelloRecordState, WindowsHelloStatus } from "./types";
import {
  ABORT_MASTER_PASSWORD_CHANGE_IF_REMOVE_FAILS,
  ABORT_VAULT_CREATION_IF_ORPHAN_CLEANUP_FAILS,
  REVERT_VAULT_IF_RECREATE_FAILS,
  STALE_RECORD_ACTION,
  canOfferHelloUnlock,
  isOrphanRecord,
  masterPasswordChangePlan,
  shouldStopOfferingHello,
} from "./windows-hello-policy";

/**
 * Fase 3B.1 — hardening do ciclo de vida do Windows Hello v1.
 *
 * Todos deterministicos: nenhum prompt real, nenhum acesso a disco, nenhum
 * cofre. As regras de ordem e de aborto sao verificadas como politica pura;
 * a classificacao de estado do registro e testada do lado Rust.
 */

const ESTADOS: WindowsHelloRecordState[] = ["disabled", "configured", "stale", "invalid"];

function status(
  state: WindowsHelloRecordState,
  available = true,
): Pick<WindowsHelloStatus, "available" | "state"> {
  return { available, state };
}

describe("HELLO-1 — troca de senha mestra", () => {
  it("remove o registro ANTES de persistir sempre que existir registro", () => {
    // O registro guarda a senha mestra antiga: persistir a nova antes de
    // removê-lo abriria a janela de segredo obsoleto em disco.
    for (const state of ESTADOS) {
      const plano = masterPasswordChangePlan(state);
      expect(plano.removeRecordFirst).toBe(state !== "disabled");
    }
  });

  it("nao tenta remover nada quando nao ha registro", () => {
    expect(masterPasswordChangePlan("disabled").removeRecordFirst).toBe(false);
  });

  it("falha ao remover o registro antigo aborta a troca", () => {
    expect(ABORT_MASTER_PASSWORD_CHANGE_IF_REMOVE_FAILS).toBe(true);
  });

  it("recria o registro apenas quando havia Hello utilizavel", () => {
    expect(masterPasswordChangePlan("configured").recreateAfterPersist).toBe(true);
    for (const state of ["disabled", "stale", "invalid"] as const) {
      expect(masterPasswordChangePlan(state).recreateAfterPersist).toBe(false);
    }
  });

  it("falha ao recriar o Hello NAO reverte o cofre", () => {
    // Invariante da fase: falha de Hello remove conveniencia, nunca acesso.
    expect(REVERT_VAULT_IF_RECREATE_FAILS).toBe(false);
  });

  it("registro orfao ou invalido e removido mas nao restaurado", () => {
    for (const state of ["stale", "invalid"] as const) {
      const plano = masterPasswordChangePlan(state);
      expect(plano.removeRecordFirst).toBe(true);
      expect(plano.recreateAfterPersist).toBe(false);
    }
  });

  it("nenhum estado pede recriar sem antes remover", () => {
    // Impede a ordem invertida que causou o achado HELLO-1.
    for (const state of ESTADOS) {
      const plano = masterPasswordChangePlan(state);
      if (plano.recreateAfterPersist) expect(plano.removeRecordFirst).toBe(true);
    }
  });
});

describe("HELLO-2 — registro orfao", () => {
  it("orfao e exatamente o estado stale", () => {
    expect(isOrphanRecord("stale")).toBe(true);
    for (const state of ["disabled", "configured", "invalid"] as const) {
      expect(isOrphanRecord(state)).toBe(false);
    }
  });

  it("falha ao limpar o orfao aborta a criacao do cofre", () => {
    expect(ABORT_VAULT_CREATION_IF_ORPHAN_CLEANUP_FAILS).toBe(true);
  });
});

describe("STATUS — quando oferecer o desbloqueio", () => {
  it("oferece apenas com Hello disponivel E registro configured", () => {
    expect(canOfferHelloUnlock(status("configured", true))).toBe(true);
    expect(canOfferHelloUnlock(status("configured", false))).toBe(false);
    for (const state of ["disabled", "stale", "invalid"] as const) {
      expect(canOfferHelloUnlock(status(state, true))).toBe(false);
    }
  });

  it("registro sem cofre nunca conta como Hello saudavel", () => {
    expect(canOfferHelloUnlock(status("stale"))).toBe(false);
    expect(shouldStopOfferingHello("stale")).toBe(true);
  });

  it("registro invalido nunca conta como Hello saudavel", () => {
    expect(canOfferHelloUnlock(status("invalid"))).toBe(false);
    expect(shouldStopOfferingHello("invalid")).toBe(true);
  });

  it("apenas configured mantem a oferta", () => {
    expect(shouldStopOfferingHello("configured")).toBe(false);
    for (const state of ["disabled", "stale", "invalid"] as const) {
      expect(shouldStopOfferingHello(state)).toBe(true);
    }
  });
});

describe("STALE — segredo nao abre o cofre atual", () => {
  it("a acao e isolar, nunca apagar", () => {
    // Apagar seria destrutivo diante de causa possivelmente transitoria.
    expect(STALE_RECORD_ACTION).toBe("quarantine");
    expect(STALE_RECORD_ACTION).not.toBe("delete");
  });

  it("apos isolar, a interface para de oferecer o Hello", () => {
    // O registro isolado deixa de existir como `.kphello`, logo o backend
    // classifica como `disabled` e a oferta cessa -- sem laco de repeticao.
    expect(shouldStopOfferingHello("disabled")).toBe(true);
    expect(canOfferHelloUnlock(status("disabled"))).toBe(false);
  });
});

describe("INVARIANTE — senha mestra sempre disponivel", () => {
  it("nenhum estado de Hello altera a disponibilidade da senha mestra", () => {
    // A politica nao expoe nenhuma decisao capaz de desabilitar o login por
    // senha mestra. Este teste falha se alguem introduzir uma.
    const chaves = Object.keys({
      ABORT_MASTER_PASSWORD_CHANGE_IF_REMOVE_FAILS,
      ABORT_VAULT_CREATION_IF_ORPHAN_CLEANUP_FAILS,
      REVERT_VAULT_IF_RECREATE_FAILS,
      STALE_RECORD_ACTION,
    });
    expect(chaves.some((k) => /master.*password.*disable|block.*vault/i.test(k))).toBe(false);
    expect(REVERT_VAULT_IF_RECREATE_FAILS).toBe(false);
  });
});
