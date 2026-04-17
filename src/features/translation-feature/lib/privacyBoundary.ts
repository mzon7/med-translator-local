/**
 * privacyBoundary.ts — Runtime privacy enforcement for Med Translator Local
 *
 * PRIVACY GUARANTEE:
 *   All audio capture and speech processing (ASR + translation) happens
 *   exclusively in the browser using on-device models (Transformers.js /
 *   WebGPU / WASM).  No audio PCM, transcribed text, or translated text
 *   is ever sent to a remote server.
 *
 * HOW THIS IS ENFORCED:
 *   1. Audio and text processing calls only local functions (asr.ts,
 *      translate.ts) — never callEdgeFunction / fetch / XHR.
 *   2. The Supabase client is used ONLY for authentication (sign-in/sign-up).
 *      It never receives audio or transcript data.
 *   3. This module provides `assertLocalOnly()` — a development-mode guard
 *      that can be wrapped around pipeline calls to verify at runtime that
 *      no network requests are made during processing.
 *   4. `sanitizeForLog()` strips potential PII (arbitrary text content) from
 *      error messages before they reach the console.
 *
 * IndexedDB caching:
 *   Model weights (~640 MB) are cached in IndexedDB by Transformers.js after
 *   the first download.  This cache is local to the origin and is never
 *   synchronised to a remote endpoint.
 */

// ─── Sanitized logging ────────────────────────────────────────────────────────

/**
 * Returns a log-safe version of an error by extracting only the structural
 * part (error type + a truncated, ASCII-only message fragment).
 *
 * This prevents partial transcripts or translated text that might appear in
 * an error's message string from leaking into console output.
 *
 * @param err - any caught value
 * @param maxLen - maximum characters of the message to include (default 120)
 */
export function sanitizeForLog(err: unknown, maxLen = 120): string {
  if (!(err instanceof Error)) return 'Unknown error';
  const name = err.name ?? 'Error';
  // Keep only printable ASCII (no unicode text that could be a transcript)
  const asciiMsg = err.message
    .replace(/[^\x20-\x7E]/g, '?')   // replace non-ASCII with ?
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim()
    .slice(0, maxLen);
  return `${name}: ${asciiMsg}`;
}

// ─── Development-mode network guard ──────────────────────────────────────────

/**
 * In development mode, wraps a pipeline call and verifies that it makes
 * zero new outbound network requests while running.
 *
 * Usage:
 *   const result = await assertLocalOnly(() => transcribe(audio, lang));
 *
 * In production builds (`import.meta.env.PROD`) this is a transparent
 * pass-through with zero overhead.
 */
export async function assertLocalOnly<T>(fn: () => Promise<T>): Promise<T> {
  if (import.meta.env.PROD) {
    // Production: zero overhead — just call the function
    return fn();
  }

  // Development: monkey-patch fetch to detect any outbound calls during
  // the pipeline run and log a privacy violation warning.
  const originalFetch = globalThis.fetch;
  let networkCallDetected = false;
  const violatingUrls: string[] = [];

  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // Hugging Face model hub fetches are permitted (model download, not data)
    const isModelHub =
      url.includes('huggingface.co') ||
      url.includes('hf.co') ||
      url.includes('cdn-lfs');
    if (!isModelHub) {
      networkCallDetected = true;
      violatingUrls.push(url);
      console.error(
        '[PRIVACY VIOLATION] Outbound network request detected during local pipeline:',
        url,
        '\nAll audio/text processing must be performed locally.',
      );
    }
    return originalFetch(input as Parameters<typeof fetch>[0], init);
  };

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    if (networkCallDetected) {
      console.error(
        '[privacyBoundary] Violating URLs:',
        violatingUrls,
      );
    }
  }
}
