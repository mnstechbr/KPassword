import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { setupTrayGuard } from "./tray-guard";

setupTrayGuard().catch((error) => {
  console.error("Erro ao iniciar proteção de bandeja do KPassword:", error);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
