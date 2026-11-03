import React from "react";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { I18nProvider } from "./i18n";

// Убираем StrictMode для совместимости с lightweight-charts v5
ReactDOM.createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <I18nProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </HelmetProvider>
);
