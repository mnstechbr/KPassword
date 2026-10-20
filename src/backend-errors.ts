import { hasTranslation, translate, type AppLanguage } from "./i18n";

const ERROR_CODE = /^error\.[A-Za-z0-9_.]+$/;

/**
 * O backend devolve códigos estáveis: "error.area.motivo", opcionalmente
 * seguidos de ": detalhe" (outro código ou o erro do sistema). Devolve o texto
 * traduzido, ou undefined se o erro não começar por um código conhecido.
 */
export function translateBackendError(error: unknown, language: AppLanguage): string | undefined {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : undefined;
  if (!raw) return undefined;

  const messages: string[] = [];
  let rest = raw;
  while (rest) {
    const separator = rest.indexOf(": ");
    const head = separator === -1 ? rest : rest.slice(0, separator);
    if (!ERROR_CODE.test(head) || !hasTranslation(language, head)) break;
    messages.push(translate(language, head));
    rest = separator === -1 ? "" : rest.slice(separator + 2);
  }

  if (messages.length === 0) return undefined;
  return rest ? `${messages.join(" ")} (${rest})` : messages.join(" ");
}

/** Mensagem genérica da tela seguida do motivo informado pelo backend, quando houver. */
export function withBackendReason(message: string, error: unknown, language: AppLanguage) {
  const reason = translateBackendError(error, language);
  return reason && reason !== message ? `${message} ${reason}` : message;
}
