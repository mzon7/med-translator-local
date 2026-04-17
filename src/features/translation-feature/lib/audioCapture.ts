/**
 * audioCapture.ts
 *
 * Captures microphone audio and emits 16 kHz mono PCM Float32Array chunks.
 *
 * Pipeline:
 *   getUserMedia → AudioContext → AudioWorkletNode (PCMCaptureProcessor)
 *                                  └─ fallback: ScriptProcessorNode
 *                → resampleLinear (if native rate ≠ 16 kHz)
 *                → onPCMData(Float32Array)  // always 16 kHz mono
 *
 * Lifecycle:
 *   const handle = await startAudioCapture({ onPCMData, onError });
 *   handle.stop();   // stops tracks, closes AudioContext
 *
 * Guards:
 *   - Calling startAudioCapture() while one is already running calls stop() first.
 *   - AudioWorklet is preferred; ScriptProcessorNode is the fallback.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Target sample rate expected by the ASR / VAD pipeline */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Number of native-rate samples the worklet accumulates before posting.
 * 4096 @ 48 kHz ≈ 85 ms per chunk; @ 16 kHz ≈ 256 ms.
 */
const WORKLET_CHUNK_SIZE = 4096;

// ─── AudioWorklet source (inlined as blob to avoid public-file dependency) ───

const WORKLET_SOURCE = /* js */ `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this._buf = [];
    this._chunkSize =
      (options.processorOptions && options.processorOptions.chunkSize) || 4096;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      this._buf.push(ch[i]);
    }

    while (this._buf.length >= this._chunkSize) {
      const chunk = new Float32Array(this._buf.splice(0, this._chunkSize));
      // Transfer the buffer to avoid a copy on the main thread
      this.port.postMessage({ type: 'pcm', samples: chunk }, [chunk.buffer]);
    }

    return true; // keep alive
  }
}

registerProcessor('med-translator-pcm-capture', PCMCaptureProcessor);
`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AudioCaptureCallbacks {
  /**
   * Called with 16 kHz mono PCM chunks.
   * The Float32Array is a fresh allocation — caller may keep it.
   */
  onPCMData: (samples: Float32Array) => void;
  onError: (err: Error) => void;
}

export interface AudioCaptureHandle {
  /** Stops microphone tracks and closes the AudioContext. */
  stop: () => void;
  /** Always TARGET_SAMPLE_RATE (16 000 Hz) — output is resampled if needed. */
  readonly outputSampleRate: number;
}

// ─── Singleton guard ──────────────────────────────────────────────────────────

let _stream: MediaStream | null = null;
let _ctx: AudioContext | null = null;

function _cleanup(): void {
  if (_stream) {
    _stream.getTracks().forEach((t) => t.stop());
    _stream = null;
  }
  if (_ctx) {
    _ctx.close().catch(() => undefined);
    _ctx = null;
  }
}

// ─── Linear resampler ─────────────────────────────────────────────────────────

/**
 * Linearly interpolates `samples` from `fromRate` to `toRate`.
 * Fast enough for real-time use at moderate downsampling ratios (e.g. 48→16 kHz).
 */
function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.round(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = src - lo;
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
  }
  return out;
}

// ─── AudioWorklet path ────────────────────────────────────────────────────────

async function _startViaWorklet(
  ctx: AudioContext,
  stream: MediaStream,
  callbacks: AudioCaptureCallbacks,
): Promise<void> {
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const source = ctx.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(ctx, 'med-translator-pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { chunkSize: WORKLET_CHUNK_SIZE },
  });

  const nativeRate = ctx.sampleRate;
  workletNode.port.onmessage = (evt: MessageEvent) => {
    if (evt.data?.type !== 'pcm') return;
    const raw = evt.data.samples as Float32Array;
    const out = resampleLinear(raw, nativeRate, TARGET_SAMPLE_RATE);
    callbacks.onPCMData(out);
  };

  workletNode.onprocessorerror = (evt) => {
    callbacks.onError(new Error(`AudioWorklet error: ${(evt as ErrorEvent).message ?? 'unknown'}`));
  };

  source.connect(workletNode);
}

// ─── ScriptProcessorNode fallback ─────────────────────────────────────────────

function _startViaScriptProcessor(
  ctx: AudioContext,
  stream: MediaStream,
  callbacks: AudioCaptureCallbacks,
): void {
  const nativeRate = ctx.sampleRate;
  const source = ctx.createMediaStreamSource(stream);

  // bufferSize must be a power of two in [256, 16384]
  // Use 4096 to match the worklet chunk size
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const processor = ctx.createScriptProcessor(WORKLET_CHUNK_SIZE, 1, 1);

  processor.onaudioprocess = (evt) => {
    // getChannelData returns a live Float32Array — copy it before it's reused
    const raw = evt.inputBuffer.getChannelData(0).slice();
    const out = resampleLinear(raw, nativeRate, TARGET_SAMPLE_RATE);
    callbacks.onPCMData(out);
  };

  source.connect(processor);
  // ScriptProcessorNode must be connected to destination to remain active
  processor.connect(ctx.destination);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Requests microphone access and starts streaming 16 kHz mono PCM to `onPCMData`.
 *
 * Throws if the user denies microphone permission or if the browser does not
 * support the Web Audio API.
 *
 * Calling this while a capture is already running implicitly stops the previous one.
 */
export async function startAudioCapture(
  callbacks: AudioCaptureCallbacks,
): Promise<AudioCaptureHandle> {
  // Stop any existing capture first
  _cleanup();

  // 1. Request microphone
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        // Hint the browser; it may be ignored (we resample ourselves)
        sampleRate: TARGET_SAMPLE_RATE,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Microphone access failed: ${msg}`);
  }

  _stream = stream;

  // 2. Create AudioContext
  // Try hinting 16 kHz; browsers often clamp to device native rate instead.
  const ctx = new AudioContext({
    latencyHint: 'interactive',
    sampleRate: TARGET_SAMPLE_RATE,
  });
  _ctx = ctx;

  // Resume context on iOS/Safari (requires user-gesture context)
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  // 3. Wire audio graph — prefer AudioWorklet, fall back to ScriptProcessorNode
  const supportsWorklet =
    typeof AudioWorkletNode !== 'undefined' &&
    typeof ctx.audioWorklet?.addModule === 'function';

  if (supportsWorklet) {
    try {
      await _startViaWorklet(ctx, stream, callbacks);
    } catch (workletErr) {
      // Worklet failed (e.g. blob URL blocked by CSP) — fall back
      console.warn('AudioWorklet unavailable, falling back to ScriptProcessorNode:', workletErr);
      _startViaScriptProcessor(ctx, stream, callbacks);
    }
  } else {
    _startViaScriptProcessor(ctx, stream, callbacks);
  }

  return {
    stop: _cleanup,
    outputSampleRate: TARGET_SAMPLE_RATE,
  };
}

/**
 * Stops the active capture session (idempotent).
 * Equivalent to calling `handle.stop()`.
 */
export function stopAudioCapture(): void {
  _cleanup();
}

/**
 * Returns true if a capture session is currently active.
 */
export function isAudioCaptureActive(): boolean {
  return _stream !== null && _ctx !== null && _ctx.state !== 'closed';
}
