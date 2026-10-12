import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import BridgeApproval from "./BridgeApproval";
import "./App.css";
import "./design.css";
import { setupTrayGuard } from "./tray-guard";

const approvalWindow = (window as Window & { __KPASSWORD_BRIDGE_APPROVAL__?: boolean }).__KPASSWORD_BRIDGE_APPROVAL__ === true;

if (!approvalWindow) setupTrayGuard().catch((error) => {
  console.error("Erro ao iniciar proteção de bandeja do KPassword:", error);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {approvalWindow ? <BridgeApproval /> : <App />}
  </React.StrictMode>,
);
