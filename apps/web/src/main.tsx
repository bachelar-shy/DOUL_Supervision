import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip";

import "./i18n/config";
import "./index.css";
import App from "./App.tsx";
import "./design-system.css";
import "./ui/resizable-workspace.css";
import "./site-mobile-readability.css";
import "./design/quiet-graphite-a.css";
import "./design/field-workspace-layout.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
