import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./main.css"

if (import.meta.env.DEV) {
  import("@tauri-apps/api/core").then(({ invoke }) => {
    (window as any).invoke = invoke;
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
      <App />
  </React.StrictMode>,
);
