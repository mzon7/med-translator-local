/**
 * vad.ts — Energy-based Voice Activity Detection
 *
 * Pipeline position: audioCapture → VAD → ASR
 *
 * Algorithm:
 *   1. Split incoming PCM into 10 ms frames (160 samples @ 16 kHz).
 *   2. Compute RMS energy per frame.
 *   3. Maintain an adaptive noise floor (updated only during silence).
 *   4. Classify frames as speech/silence using a threshold =
 *        max(SPEECH_THRESHOLD_MIN, noiseFloor × SPEECH_THRESHOLD_MULT).
 *   5. Hysteresis:
 *        – Speech start:  minSpeechFrames (≈300 ms) consecutive speech frames
 *        – Speech end:    endSilenceFrames (≈600 ms) consecutive silence frames
 *   6. Pre-roll: keep a sliding window of the last ~100 ms so the start of an
 *        utterance is not clipped when the VAD finally commits.
 *   7. maxUtteranceMs cap (12 s): force-finalize even if speech continues,
 *        to bound buffer memory and ASR latency.
 *
 * Usage:
 *   const vad = createVAD({ onSpeechEnd: (audio) => sendToASR(audio) });
 *   // inside audioCapture.onPCMData:
 *   vad.processChunk(samples);   // samples = 16 kHz mono Float32Array
 *   // when done:
 *   vad.reset();
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const VAD_SAMPLE_RATE = 16_000;

/** Duration of one VAD analysis frame in milliseconds */
const FRAME_MS = 10;

/** Speed at which the noise floor tracks ambient level (0 = frozen, 1 = instant) */
const NOISE_FLOOR_ALPHA = 0.015;

/** Speech energy must be this many times above the noise floor to count */
const SPEECH_THRESHOLD_MULT = 3.5;

/**
 * Absolute RMS floor below which we never trigger speech,
 * even if the noise floor is near zero (e.g. dead silence or muted mic).
 */
const SPEECH_THRESHOLD_MIN = 0.004;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VadOptions {
  sampleRate?: number;
  /** Minimum consecutive speech duration before an utterance is committed (ms) */
  minSpeechMs?: number;
  /** Consecutive silence duration that ends an utterance (ms) */
  endSilenceMs?: number;
  /** Hard cap on utterance length — triggers forced segmentation (ms) */
  maxUtteranceMs?: number;
  /** Pre-roll prepended to utterance to avoid clipping the onset (ms) */
  preRollMs?: number;
  noiseFloorAlpha?: number;
  speechThresholdMult?: number;
  speechThresholdMin?: number;
}

export interface VadCallbacks {
  /** Fired when the VAD first commits to speech (after minSpeechMs confirmation) */
  onSpeechStart?: () => void;
  /**
   * Fired when speech ends (or maxUtteranceMs is reached).
   * `audio` is a 16 kHz mono Float32Array ready for ASR.
   * `forcedSegment` is true when the cap triggered the split.
   */
  onSpeechEnd: (audio: Float32Array, forcedSegment: boolean) => void;
}

export interface VadHandle {
  /**
   * Feed a chunk of 16 kHz mono PCM.
   * Chunks do not need to be frame-aligned — the VAD buffers residual samples.
   */
  processChunk: (samples: Float32Array) => void;
  /** Reset all state (noise floor, buffers, speaking flag) */
  reset: () => void;
  /** True while an utterance is being accumulated */
  readonly isSpeaking: boolean;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/** Root-mean-square energy of a Float32Array */
function computeRMS(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i];
  }
  return Math.sqrt(sum / frame.length);
}

/** Concatenate an array of Float32Arrays into one */
function concatFloat32(chunks: Float32Array[]): Float32Array {
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function createVAD(callbacks: VadCallbacks, options: VadOptions = {}): VadHandle {
  const {
    sampleRate = VAD_SAMPLE_RATE,
    minSpeechMs = 300,
    endSilenceMs = 600,
    maxUtteranceMs = 12_000,
    preRollMs = 100,
    noiseFloorAlpha = NOISE_FLOOR_ALPHA,
    speechThresholdMult = SPEECH_THRESHOLD_MULT,
    speechThresholdMin = SPEECH_THRESHOLD_MIN,
  } = options;

  const frameSize = Math.round((sampleRate * FRAME_MS) / 1_000);
  const minSpeechFrames = Math.ceil(minSpeechMs / FRAME_MS);    // 30
  const endSilenceFrames = Math.ceil(endSilenceMs / FRAME_MS);  // 60
  const maxUtteranceFrames = Math.ceil(maxUtteranceMs / FRAME_MS); // 1200
  const preRollFrames = Math.ceil(preRollMs / FRAME_MS);          // 10

  // ── Mutable state ──────────────────────────────────────────────────────────
  let noiseFloor = 0.01;
  let _isSpeaking = false;

  /** Consecutive speech frames seen while NOT yet committed (pre-confirmation) */
  let preSpeechCount = 0;
  /** Consecutive silent frames seen while speaking (post-confirmation) */
  let silenceCount = 0;
  /** Total frames accumulated in the current utterance buffer */
  let utteranceFrameCount = 0;

  /**
   * Samples that did not fill a complete frame from the last processChunk call.
   * Carried over to the next call.
   */
  let residual = new Float32Array(0);

  /**
   * Sliding pre-roll ring buffer.
   * Holds the last `preRollFrames` frames of audio *before* speech is confirmed.
   * Flushed into utteranceBuffer when speech starts.
   */
  const preRoll: Float32Array[] = [];

  /**
   * Candidate buffer: frames accumulated during the confirmation window
   * (before we have minSpeechFrames — we keep them so we can include them
   * in the utterance if speech is confirmed).
   */
  const candidateBuffer: Float32Array[] = [];

  /** Confirmed utterance frames (after speech start is committed) */
  const utteranceBuffer: Float32Array[] = [];

  // ── Internal helpers ───────────────────────────────────────────────────────

  function _finalizeUtterance(forced: boolean): void {
    if (utteranceBuffer.length === 0) return;
    const audio = concatFloat32(utteranceBuffer);
    utteranceBuffer.length = 0;
    candidateBuffer.length = 0;
    utteranceFrameCount = 0;
    _isSpeaking = false;
    preSpeechCount = 0;
    silenceCount = 0;
    callbacks.onSpeechEnd(audio, forced);
  }

  function _processFrame(frame: Float32Array): void {
    const rms = computeRMS(frame);
    const threshold = Math.max(speechThresholdMin, noiseFloor * speechThresholdMult);
    const isSpeechFrame = rms >= threshold;

    if (!_isSpeaking) {
      // ── Not yet in an utterance ──────────────────────────────────────────

      if (!isSpeechFrame) {
        // Silent frame — update noise floor and advance pre-roll
        noiseFloor = noiseFloor * (1 - noiseFloorAlpha) + rms * noiseFloorAlpha;
        preSpeechCount = 0;
        candidateBuffer.length = 0;

        // Maintain pre-roll ring buffer
        preRoll.push(frame.slice());
        if (preRoll.length > preRollFrames) preRoll.shift();
      } else {
        // Speech candidate frame
        preSpeechCount++;
        candidateBuffer.push(frame.slice());

        if (preSpeechCount >= minSpeechFrames) {
          // ── Commit: speech confirmed ─────────────────────────────────────
          _isSpeaking = true;
          silenceCount = 0;
          utteranceFrameCount = 0;
          callbacks.onSpeechStart?.();

          // Flush pre-roll + candidate into utterance buffer
          for (const f of preRoll) {
            utteranceBuffer.push(f);
            utteranceFrameCount++;
          }
          preRoll.length = 0;

          for (const f of candidateBuffer) {
            utteranceBuffer.push(f);
            utteranceFrameCount++;
          }
          candidateBuffer.length = 0;
        }
      }
    } else {
      // ── Currently in an utterance ────────────────────────────────────────

      utteranceBuffer.push(frame.slice());
      utteranceFrameCount++;

      if (!isSpeechFrame) {
        silenceCount++;
        if (silenceCount >= endSilenceFrames) {
          // End of speech — trim trailing silence before finalizing
          const trimFrames = Math.min(silenceCount, utteranceBuffer.length);
          utteranceBuffer.splice(utteranceBuffer.length - trimFrames, trimFrames);
          _finalizeUtterance(false);
          return;
        }
      } else {
        silenceCount = 0;
        // Noise floor slowly adapts even during speech (helps with loud rooms)
        // Use a much slower rate so speech doesn't inflate the floor
        noiseFloor = noiseFloor * (1 - noiseFloorAlpha * 0.1) + rms * noiseFloorAlpha * 0.1;
      }

      // Hard cap — force segment to keep buffer memory bounded
      if (utteranceFrameCount >= maxUtteranceFrames) {
        _finalizeUtterance(true);
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function processChunk(samples: Float32Array): void {
    // Prepend any leftover samples from the previous call
    let chunk: Float32Array;
    if (residual.length > 0) {
      chunk = new Float32Array(residual.length + samples.length);
      chunk.set(residual);
      chunk.set(samples, residual.length);
      residual = new Float32Array(0);
    } else {
      chunk = samples;
    }

    let offset = 0;
    while (offset + frameSize <= chunk.length) {
      _processFrame(chunk.subarray(offset, offset + frameSize) as Float32Array);
      offset += frameSize;
    }

    // Keep leftover samples for next call
    if (offset < chunk.length) {
      residual = chunk.slice(offset);
    }
  }

  function reset(): void {
    noiseFloor = 0.01;
    _isSpeaking = false;
    preSpeechCount = 0;
    silenceCount = 0;
    utteranceFrameCount = 0;
    residual = new Float32Array(0);
    preRoll.length = 0;
    candidateBuffer.length = 0;
    utteranceBuffer.length = 0;
  }

  return {
    processChunk,
    reset,
    get isSpeaking() {
      return _isSpeaking;
    },
  };
}
