import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@mzon7/zon-incubator-sdk/auth";
import { supabase } from "./lib/supabase";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider supabase={supabase}>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
