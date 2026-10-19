import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppearance } from "./useAppearance";
import { UiIcon } from "./UiIcon";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Request = { requestId: string; keyId: string; keyLabel: string; application: string; entryScript: string | null; project: string; model: string; operation: string; provider: string; identity: string; timeoutMs: number; rememberAllowed: boolean };
export default function BridgeApproval() {
  useAppearance();
  const currentRequestId = useRef<string | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [remember, setRemember] = useState(false);
  const [remaining, setRemaining] = useState(30);
  const [busy, setBusy] = useState(false);
  const english = localStorage.getItem("kpassword:language") === "en";
  const text = (pt: string, en: string) => english ? en : pt;
  useEffect(() => {
    document.documentElement.dataset.platform = "linux";
    let disposed = false;
    let stop: (() => void) | undefined;
    const take = async () => {
      try {
        const next = await invoke<Request | null>("bridge_take_access_request");
        if (!disposed && next && next.requestId !== currentRequestId.current) { currentRequestId.current = next.requestId; setRequest(next); setRemember(false); setBusy(false); setRemaining(Math.ceil(next.timeoutMs / 1000)); }
      } catch { /* No payload logging. */ }
    };
    void listen("kpassword:bridge-access-request", take).then((unlisten) => { if (disposed) unlisten(); else { stop = unlisten; void take(); } });
    return () => { disposed = true; stop?.(); };
  }, []);
  useEffect(() => {
    if (!request) return;
    const deadline = Date.now() + request.timeoutMs;
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); setRemaining(seconds);
      if (!seconds) { setRequest(null); void getCurrentWindow().hide(); }
    }, 250);
    return () => window.clearInterval(timer);
  }, [request]);
  async function answer(approve: boolean) {
    if (!request || busy) return;
    setBusy(true);
    try { await invoke("bridge_answer_access_request", { requestId:request.requestId, approve, remember:approve && remember }); }
    catch { /* Expired/revoked requests stay denied. */ }
    finally {
      if (currentRequestId.current === request.requestId) { currentRequestId.current = null; setRequest(null); setBusy(false); }
    }
  }
  const filename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;
  return <main className="bridgeDesktopApproval">
    <header>
      <div className="bridgeBrand"><img src="/app-icon.png" alt="" /><strong>Secrets Bridge</strong></div>
      <span className={remaining <= 10 ? "bridgeCountdown urgent" : "bridgeCountdown"} role="timer" aria-label={text("Tempo restante", "Time remaining")}>{remaining} s</span>
    </header>
    <div className="bridgeTitle"><UiIcon name="shield" /><div>
      <h1>{text("Autorizar chamada de API", "Approve API call")}</h1>
      <p>{text("Uma aplicação solicita acesso a uma credencial do cofre.", "An application is requesting access to a vault credential.")}</p>
    </div></div>
    {request ? <>
      <section className="bridgeApprovalContent" aria-label={text("Pedido de acesso", "Access request")}>
        <dl className="bridgeRequestSummary">
          <dt>{text("Aplicação", "Application")}</dt><dd title={request.entryScript ?? request.application}>{filename(request.entryScript ?? request.application)}</dd>
          <dt>{text("Projeto", "Project")}</dt><dd title={request.project}>{filename(request.project)}</dd>
          <dt>{text("Credencial", "Credential")}</dt><dd>{request.keyLabel}</dd>
          <dt>{text("Provedor", "Provider")}</dt><dd>{request.provider}</dd>
          <dt>{text("Operação / modelo", "Operation / model")}</dt><dd>{request.operation} · {request.model}</dd>
        </dl>
        <div className="bridgePermissionControls">
          <label className="toggleRow"><span>{text("Permitir esta operação e modelo para este aplicativo e projeto até encerrar a ponte", "Allow this operation and model for this application and project until the bridge ends")}</span><input type="checkbox" checked={remember} disabled={!request.rememberAllowed} onChange={e => setRemember(e.target.checked)} /></label>
          {!request.rememberAllowed && <p>{text("Interpretador sem script identificável: somente aprovação única. Integre o conector ao projeto para autorizar uso contínuo.", "Interpreter without an identifiable script: one-time approval only. Integrate the connector into the project for continued access.")}</p>}

        </div>
        <details className="technicalDetails">
          <summary>{text("Identidade e caminhos completos", "Identity and full paths")}</summary>
          <dl>
            <dt>{text("Aplicação", "Application")}</dt><dd>{request.application}</dd>
            {request.entryScript && <><dt>Script</dt><dd>{request.entryScript}</dd></>}
            <dt>{text("Projeto / diretório", "Project / directory")}</dt><dd>{request.project}</dd>
            <dt>{text("ID da credencial", "Credential ID")}</dt><dd>{request.keyId}</dd>
            <dt>{text("Identidade observada pelo sistema", "System-observed identity")}</dt><dd>{request.identity}</dd>
          </dl>
        </details>
        <small>{text("Sem cota local por padrão. A permissão inclui aplicativo/script, diretório, credencial, operação e modelo e dura até encerrar a ponte; reconectar não exige nova aprovação.", "No local quota by default. Permission covers application/script, directory, credential, operation and model until the bridge ends; reconnecting does not require another approval.")}</small>
      </section>
      <div className="bridgeWarning"><span aria-hidden="true">!</span><p>{text("A chave fica no KPassword. A chamada envia dados ao provedor e pode gerar cobrança.", "The key stays in KPassword. The call sends data to the provider and may incur charges.")}</p></div>
      <footer>
        <small>{text("Fechar ou ignorar recusa o pedido.", "Closing or ignoring denies the request.")}</small>
        <div className="bridgeActions"><button className="secondaryButton" disabled={busy} onClick={() => void answer(false)}>{text("Recusar", "Deny")}</button><button className="primaryButton" disabled={busy} onClick={() => void answer(true)}>{remember ? text("Aprovar e continuar permitindo", "Approve and keep allowing") : text("Aprovar uma vez", "Approve once")}</button></div>
      </footer>
    </> : <p role="status">{text("Nenhum pedido pendente.", "No pending request.")}</p>}
  </main>;
}
