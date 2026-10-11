import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Request = { requestId: string; keyId: string; keyLabel: string; application: string; entryScript: string | null; project: string; model: string; operation: string; provider: string; identity: string; timeoutMs: number; rememberAllowed: boolean };
export default function BridgeApproval() {
  const [request, setRequest] = useState<Request | null>(null);
  const [remember, setRemember] = useState(false);
  const [maxCalls, setMaxCalls] = useState(10000);
  const [remaining, setRemaining] = useState(30);
  const [busy, setBusy] = useState(false);
  const english = localStorage.getItem("kpassword:language") === "en";
  const text = (pt: string, en: string) => english ? en : pt;
  useEffect(() => {
    if (remember) document.querySelector<HTMLInputElement>(".bridgeDesktopApproval input[type=number]")?.scrollIntoView({block:"nearest"});
  }, [remember]);
  useEffect(() => {
    document.documentElement.dataset.platform = "linux";
    let disposed = false;
    let stop: (() => void) | undefined;
    const take = async () => {
      try {
        const next = await invoke<Request | null>("bridge_take_access_request");
        if (!disposed && next) { setRequest(next); setRemember(false); setBusy(false); setRemaining(Math.ceil(next.timeoutMs / 1000)); }
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
    try { await invoke("bridge_answer_access_request", { requestId:request.requestId, approve, remember:approve && remember, maxCalls }); }
    catch { /* Expired/revoked requests stay denied. */ }
    finally { setRequest(null); setBusy(false); await getCurrentWindow().hide(); }
  }
  return <main className="bridgeDesktopApproval">
    <header><strong>KPassword · Secrets Bridge</strong><span>{remaining}s</span></header>
    <h1>{text("Autorizar chamada de API", "Approve API call")}</h1>
    {request ? <>
      <section className="bridgeApprovalContent">
      <dl><dt>{text("Aplicação", "Application")}</dt><dd>{request.entryScript ?? request.application}</dd>
      <dt>{text("Projeto / diretório", "Project / directory")}</dt><dd>{request.project}</dd>
      <dt>{text("Credencial", "Credential")}</dt><dd>{request.keyLabel}<small>ID: {request.keyId}</small></dd>
      <dt>{text("Provedor · operação · modelo", "Provider · operation · model")}</dt><dd>{request.provider} · {request.operation} · {request.model}</dd></dl>
      <details><summary>{text("Identidade verificada pelo sistema", "System-observed identity")}</summary><p>{request.application}</p><p>{request.identity}</p></details>
      <p>{text("A chave fica no KPassword. A chamada envia dados ao provedor e pode gerar cobrança.", "The key stays in KPassword. The call sends data to the provider and may incur charges.")}</p>
      <label><input type="checkbox" checked={remember} disabled={!request.rememberAllowed} onChange={e => setRemember(e.target.checked)} />{text("Continuar permitindo durante a sessão da ponte", "Keep allowing during this Bridge session")}</label>
      {!request.rememberAllowed && <p>{text("Interpretador sem script identificável: somente aprovação única. Integre o conector ao projeto para autorizar uso contínuo.", "Interpreter without an identifiable script: one-time approval only. Integrate the connector into the project for continued access.")}</p>}
      {remember && <label>{text("Limite de chamadas nesta permissão", "Call limit for this permission")}<input type="number" min={1} max={100000} value={maxCalls} onChange={e=>setMaxCalls(Math.max(1,Math.min(100000,Number(e.target.value)||1)))} /></label>}
      <small>{text("Máximo de 60 chamadas/minuto. Fechar ou ignorar recusa. A permissão inclui script, diretório, credencial, operação e modelo; não isola malware da sua conta.", "Maximum 60 calls/minute. Closing or ignoring denies. Permission includes script, directory, credential, operation and model; it does not isolate malware under your account.")}</small>
      </section>
      <footer><button disabled={busy} onClick={()=>void answer(false)}>{text("Recusar", "Deny")}</button><button className="primaryButton" disabled={busy} onClick={()=>void answer(true)}>{remember ? text("Aprovar e continuar permitindo", "Approve and keep allowing") : text("Aprovar uma vez", "Approve once")}</button></footer>
    </> : <p>{text("Nenhum pedido pendente.", "No pending request.")}</p>}
  </main>;
}
