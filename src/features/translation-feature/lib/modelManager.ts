/**
 * modelManager.ts — Local model lifecycle for the ASR + translation pipeline
 *
 * Runtime:  @huggingface/transformers  (Transformers.js v4)
 * Backend:  WebGPU (preferred) → WASM (fallback)
 *
 * Models loaded:
 *   ASR:         onnx-community/whisper-tiny   (~39 MB, multilingual)
 *   Translation: Xenova/nllb-200-distilled-600M (~600 MB quantised, 200 languages)
 *
 * TranslateGemma 4B note:
 *   The project targets TranslateGemma 4B as its eventual model. While a
 *   browser-optimised ONNX/WebGPU build of TranslateGemma is not yet publicly
 *   available, this module provides the same stable interfaces (transcribe /
 *   translate) backed by equivalent open-source models that run entirely
 *   locally. Swapping in TranslateGemma requires only replacing the model IDs
 *   below once an ONNX export is published.
 *
 * Usage:
 *   await loadModels(onProgress);   // call once; results cached in IndexedDB
 *   unloadModels();                 // free references (GC cleans up GPU memory)
 *   getModels()                     // { transcriber, translator } | null
 */

import { pipeline, env } from '@huggingface/transformers';

// ─── Model IDs ────────────────────────────────────────────────────────────────

/** Whisper-tiny: 39 MB, real-time multilingual ASR in-browser */
const ASR_MODEL_ID = 'onnx-community/whisper-tiny';

/**
 * NLLB-200-distilled-600M: 200-language multilingual translation.
 * Download ≈ 600 MB (quantised int8).  Cached in IndexedDB after first load.
 */
const TRANSLATE_MODEL_ID = 'Xenova/nllb-200-distilled-600M';

// ─── Runtime configuration ────────────────────────────────────────────────────

// Transformers.js uses IndexedDB for model caching by default in browsers.
// Do NOT set env.cacheDir in browser — it uses the browser FS abstraction.
env.allowLocalModels = false; // always fetch from HF Hub

// ─── WebGPU detection ─────────────────────────────────────────────────────────

/** Returns 'webgpu' if the browser exposes a usable GPU adapter, else 'wasm'. */
async function detectDevice(): Promise<'webgpu' | 'wasm'> {
  if (typeof navigator === 'undefined') return 'wasm';
  if (!('gpu' in navigator)) return 'wasm';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = await (navigator as any).gpu.requestAdapter();
    return adapter ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

// ─── SharedArrayBuffer / COOP+COEP check ─────────────────────────────────────

/** True when the page is cross-origin isolated (needed for WASM threading). */
function isCrossOriginIsolated(): boolean {
  return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
}

// ─── Types ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HFPipeline = Awaited<ReturnType<typeof pipeline>>;

export type DeviceType = 'webgpu' | 'wasm';

export interface ModelSet {
  transcriber: HFPipeline;
  translator: HFPipeline;
  device: DeviceType;
}

export interface ModelLoadPhase {
  /** Which model is currently downloading */
  phase: 'asr' | 'translation';
  /** Overall percentage for this phase, 0–100 */
  progress: number;
  /** Optional: name of the file currently being fetched */
  file?: string;
}

export type ProgressCallback = (info: ModelLoadPhase) => void;

// ─── Singleton state ──────────────────────────────────────────────────────────

let _models: ModelSet | null = null;
let _loading = false;

// ─── Progress aggregator ──────────────────────────────────────────────────────

/**
 * Transforms Transformers.js per-file progress events into a single rolling
 * percentage for each phase.  Files with unknown total size are assumed equal.
 */
function makeProgressTracker(phase: ModelLoadPhase['phase'], cb: ProgressCallback) {
  const fileProgress = new Map<string, number>(); // file → 0-100

  return function onHFProgress(data: Record<string, unknown>) {
    if (data.status !== 'progress') return;
    const file = String(data.file ?? data.name ?? '');
    const pct = typeof data.progress === 'number' ? data.progress : 0;
    fileProgress.set(file, pct);
    const entries = [...fileProgress.values()];
    const avg = entries.reduce((s, v) => s + v, 0) / entries.length;
    cb({ phase, progress: Math.round(avg), file });
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect compute backend, then download and initialise both pipelines.
 * Models are cached in IndexedDB — subsequent calls return immediately.
 *
 * @throws Error with a user-facing message when the device is unsupported.
 */
export async function loadModels(onProgress: ProgressCallback): Promise<void> {
  if (_models) return; // already loaded
  if (_loading) throw new Error('Model loading already in progress');
  _loading = true;

  try {
    const device = await detectDevice();

    // Warn about COOP/COEP if needed for WASM threading
    if (device === 'wasm' && !isCrossOriginIsolated()) {
      console.warn(
        '[modelManager] Page is not cross-origin isolated. ' +
        'WASM multi-threading disabled — inference will be slower.',
      );
    }

    // ── Load ASR model (Whisper-tiny) ────────────────────────────────────────
    const asrProgress = makeProgressTracker('asr', onProgress);
    const transcriber = await pipeline(
      'automatic-speech-recognition',
      ASR_MODEL_ID,
      {
        device,
        // Use fp16 on WebGPU for speed/memory; int8 on WASM for smaller footprint
        dtype: device === 'webgpu'
          ? { encoder_model: 'fp16', decoder_model_merged: 'q4' }
          : 'q8',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: asrProgress as any,
      },
    );

    // ── Load Translation model (NLLB-200-distilled-600M) ────────────────────
    const txProgress = makeProgressTracker('translation', onProgress);
    const translator = await pipeline(
      'translation',
      TRANSLATE_MODEL_ID,
      {
        device,
        dtype: device === 'webgpu' ? 'fp16' : 'q8',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: txProgress as any,
      },
    );

    _models = { transcriber, translator, device };
  } finally {
    _loading = false;
  }
}

/**
 * Returns the loaded model set, or null if loadModels() has not completed.
 */
export function getModels(): ModelSet | null {
  return _models;
}

/**
 * Releases references to the loaded pipelines.
 * Actual GPU/WASM memory is freed by the garbage collector.
 */
export function unloadModels(): void {
  _models = null;
}

/** True while loadModels() is in progress */
export function isLoading(): boolean {
  return _loading;
}
