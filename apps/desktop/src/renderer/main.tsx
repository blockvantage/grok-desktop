import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/i18n";
import { ErrorBoundary } from "@/components/error-boundary";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider delayDuration={280} skipDelayDuration={120}>
            <App />
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
