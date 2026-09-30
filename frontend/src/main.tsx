import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { queryClient } from "./lib/queryClient";
import { useAuth } from "./stores/auth";

import "./index.css";

useAuth.getState().bootstrap();

if (import.meta.env.DEV) {
  (window as unknown as { __auth: typeof useAuth }).__auth = useAuth;
  (window as unknown as { __rq: typeof queryClient }).__rq = queryClient;
  void import("./lib/api").then((m) => {
    (window as unknown as { __token: () => string | null }).__token = m.getAccessToken;
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
