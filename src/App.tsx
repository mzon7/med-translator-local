import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute, AuthCallback } from "@mzon7/zon-incubator-sdk/auth";
import { supabase } from "./lib/supabase";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import AppPage from "./pages/AppPage";

const PROJECT_PREFIX = "med_translator_local_";

/** Reports a caught error to the self-heal monitoring table. */
async function reportSelfHealError(opts: {
  category: string;
  source: string;
  errorMessage: string;
  errorStack?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await supabase.from("incubator_self_heal_errors").insert({
      category: opts.category,
      project_prefix: PROJECT_PREFIX,
      source: opts.source,
      error_message: opts.errorMessage.slice(0, 2000),
      error_stack: opts.errorStack?.slice(0, 5000) ?? null,
      metadata: opts.metadata ?? null,
      status: "open",
    });
  } catch {
    // Never throw from error reporting — swallow silently
  }
}

/** Installs window-level error and unhandledrejection handlers. Returns cleanup fn. */
function installFrontendErrorCapture(): () => void {
  const onError = (event: ErrorEvent) => {
    void reportSelfHealError({
      category: "frontend",
      source: event.filename ?? "window.onerror",
      errorMessage: event.message ?? "Unknown error",
      errorStack: event.error instanceof Error ? event.error.stack : undefined,
      metadata: { lineno: event.lineno, colno: event.colno },
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const err = event.reason;
    void reportSelfHealError({
      category: "frontend",
      source: "unhandledrejection",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

export default function App() {
  useEffect(() => {
    const cleanup = installFrontendErrorCapture();
    return cleanup;
  }, []);

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/auth/callback"
        element={<AuthCallback supabase={supabase} redirectTo="/app" />}
      />

      {/* Protected routes */}
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppPage />
          </ProtectedRoute>
        }
      />

      {/* Default redirect */}
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
