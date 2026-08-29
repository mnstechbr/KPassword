import type { WindowsHelloRecordState, WindowsHelloStatus } from "./types";

/**
 * Politica de ciclo de vida do registro Windows Hello (formato v1).
 *
 * Modulo puro, sem IPC e sem React, para que as decisoes possam ser testadas
 * de forma deterministica e sem prompt real do Windows Hello.
 *
 * PROPRIEDADE FUNDAMENTAL desta fase:
 *
 *   uma falha do Windows Hello pode remover conveniencia,
 *   mas nunca pode bloquear o acesso ao cofre pela senha mestra.
 *
 * O que este modulo NAO faz: nao afirma vinculo criptografico entre o registro
 * e o cofre. O formato v1 nao oferece essa propriedade -- o registro guarda a
 * propria senha mestra sob DPAPI de escopo de usuario, e a verificacao do
 * Windows Hello nao participa da decifragem. Ver SECURITY.md.
 */

/** Plano da troca de senha mestra, derivado do estado do registro. */
export type MasterPasswordChangePlan = {
  /**
   * Remover o registro ANTES de persistir a senha nova.
   *
   * Necessario sempre que exista qualquer registro em disco: ele guarda a senha
   * mestra ANTIGA. Se o cofre passasse a usar a senha nova antes da remocao,
   * uma interrupcao deixaria em disco um segredo obsoleto que ainda abre
   * backups da epoca.
   */
  removeRecordFirst: boolean;
  /**
   * Recriar o registro depois de persistir. So faz sentido quando o usuario
   * tinha um Hello efetivamente utilizavel; registros orfaos ou invalidos nao
   * devem ser "restaurados".
   */
  recreateAfterPersist: boolean;
};

export function masterPasswordChangePlan(
  state: WindowsHelloRecordState,
): MasterPasswordChangePlan {
  return {
    removeRecordFirst: state !== "disabled",
    recreateAfterPersist: state === "configured",
  };
}

/**
 * Falhar ao remover o registro antigo ABORTA a troca de senha mestra.
 *
 * Preferimos manter tudo consistente (cofre com a senha atual, registro
 * intacto) a criar a janela em que o registro guarda uma senha que nao abre
 * mais o cofre.
 */
export const ABORT_MASTER_PASSWORD_CHANGE_IF_REMOVE_FAILS = true;

/**
 * Falhar ao RECRIAR o registro nao reverte nada: a senha nova ja e a senha do
 * cofre e continua valida. O Hello simplesmente fica desativado.
 */
export const REVERT_VAULT_IF_RECREATE_FAILS = false;

/** A interface so deve oferecer desbloqueio por Hello neste estado. */
export function canOfferHelloUnlock(
  status: Pick<WindowsHelloStatus, "available" | "state">,
): boolean {
  return status.available && status.state === "configured";
}

/** Registro presente cujo cofre correspondente nao existe. */
export function isOrphanRecord(state: WindowsHelloRecordState): boolean {
  return state === "stale";
}

/**
 * Criar um cofre exige que nao exista registro orfao com o mesmo nome.
 * Se a limpeza falhar, a criacao e abortada -- um cofre novo nunca deve nascer
 * associado implicitamente a um registro antigo.
 */
export const ABORT_VAULT_CREATION_IF_ORPHAN_CLEANUP_FAILS = true;

/**
 * Acao quando o segredo devolvido pelo Hello nao abre o cofre atual.
 *
 * "quarantine" = renomear o arquivo, NAO apagar. A remocao definitiva seria
 * destrutiva diante de uma causa possivelmente transitoria (por exemplo, um
 * `.kpvault` temporariamente ilegivel), e o objetivo aqui e apenas parar de
 * oferecer um Hello que comprovadamente nao funciona.
 */
export const STALE_RECORD_ACTION = "quarantine" as const;

/** Estados em que a interface deve parar de oferecer o Hello. */
export function shouldStopOfferingHello(state: WindowsHelloRecordState): boolean {
  return state !== "configured";
}
