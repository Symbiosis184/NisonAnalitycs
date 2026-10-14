import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Убираем StrictMode для совместимости с lightweight-charts v5
ReactDOM.createRoot(document.getElementById("root")!).render(
  <App />
);
