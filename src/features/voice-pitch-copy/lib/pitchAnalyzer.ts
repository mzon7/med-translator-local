/**
 * pitchAnalyzer.ts — Extract fundamental frequency (F0) from utterance audio
 *
 * Uses normalised autocorrelation over a centred 1024-sample window,
 * identical in approach to speakerHeuristics.ts but exposed as a standalone
 * utility so the voice-pitch-copy feature can remain self-contained.
 *
 * Input assumption: 16 kHz mono PCM Float32Array (from audioCapture.ts).
 */

const SAMPLE_RATE = 16_000;
const PITCH_WINDOW = 1_024; // ~64 ms centred analysis window
const MIN_LAG = 40;         // ≈ 400 Hz (upper F0 bound for speech)
const MAX_LAG = 220;        // ≈ 72 Hz  (lower F0 bound for deep male voice)
const MIN_VOICED_CORR = 0.25; // Normalised autocorrelation threshold

/**
 * Estimates the fundamental frequency (F0) in Hz from 16 kHz mono PCM audio.
 *
 * Uses normalised autocorrelation with parabolic sub-sample refinement.
 * Returns 0 when the signal is unvoiced, silent, or too short to analyse.
 */
export function estimatePitchHz(audio: Float32Array): number {
  if (audio.length < MIN_LAG * 2) return 0;

  // Centre analysis window
  const half = PITCH_WINDOW >> 1;
  const start = Math.max(0, Math.floor(audio.length / 2) - half);
  const end = Math.min(audio.length, start + PITCH_WINDOW);
  const frame = audio.subarray(start, end);

  // Zero-lag autocorrelation (signal energy)
  let r0 = 0;
  for (let i = 0; i < frame.length; i++) r0 += frame[i] * frame[i];
  if (r0 < 1e-9) return 0; // silent

  // Find lag with maximum normalised autocorrelation
  let bestLag = 0;
  let bestCorr = MIN_VOICED_CORR;
  const maxLag = Math.min(MAX_LAG, frame.length - 1);

  for (let lag = MIN_LAG; lag <= maxLag; lag++) {
    let r = 0;
    const n = frame.length - lag;
    for (let i = 0; i < n; i++) r += frame[i] * frame[i + lag];
    const normR = r / r0;
    if (normR > bestCorr) {
      bestCorr = normR;
      bestLag = lag;
    }
  }

  if (bestLag === 0) return 0; // unvoiced

  // Parabolic interpolation for sub-sample refinement
  if (bestLag > MIN_LAG && bestLag < maxLag) {
    let rPrev = 0, rNext = 0;
    const nPrev = frame.length - (bestLag - 1);
    const nNext = frame.length - (bestLag + 1);
    for (let i = 0; i < nPrev; i++) rPrev += frame[i] * frame[i + bestLag - 1];
    for (let i = 0; i < nNext; i++) rNext += frame[i] * frame[i + bestLag + 1];
    rPrev /= r0;
    rNext /= r0;
    const denom = 2 * (2 * bestCorr - rPrev - rNext);
    if (Math.abs(denom) > 1e-6) {
      const refinedLag = bestLag + (rNext - rPrev) / denom;
      return refinedLag > 0 ? SAMPLE_RATE / refinedLag : 0;
    }
  }

  return SAMPLE_RATE / bestLag;
}

/**
 * Maps a speaker's fundamental frequency (Hz) to the Web Speech API pitch
 * scale (0–2, where 1.0 is the browser default).
 *
 * Mapping:
 *   75 Hz  → 0.50  (deep male voice)
 *  130 Hz  → 0.78  (average male voice)
 *  200 Hz  → 1.19  (average female voice)
 *  320 Hz  → 1.80  (high female voice)
 *
 * Returns 1.0 for unvoiced (0 Hz) input so TTS defaults to the browser voice.
 */
export function mapPitchToSynthScale(pitchHz: number): number {
  if (pitchHz <= 0) return 1.0;
  const MIN_HZ = 75, MAX_HZ = 320;
  const MIN_SCALE = 0.5, MAX_SCALE = 1.8;
  const scale =
    MIN_SCALE + ((pitchHz - MIN_HZ) / (MAX_HZ - MIN_HZ)) * (MAX_SCALE - MIN_SCALE);
  return Math.max(0.3, Math.min(1.9, scale));
}
