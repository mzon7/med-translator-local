/**
 * speakerHeuristics.ts — Per-utterance speaker attribution via audio features
 *
 * Pipeline position: VAD → speakerHeuristics → ASR
 *
 * Per-utterance features extracted:
 *   • Fundamental frequency (F0)  — autocorrelation-based pitch estimator
 *   • Spectral centroid (Hz)      — DFT magnitude weighted average
 *   • Average RMS energy
 *
 * Two speaker profiles (left / right) are maintained as exponential moving
 * averages of the per-utterance features.
 *
 * Initialisation:
 *   Utterance 1 → assigned to 'left', left profile created.
 *   Utterance 2 → if feature distance from left profile exceeds
 *                 SAME_SPEAKER_THRESHOLD, assigned to 'right' and right
 *                 profile is created; otherwise reassigned to 'left'.
 *   Utterance N → assigned to nearest profile (normalised weighted Euclidean).
 *
 * Uncertainty:
 *   When both profiles exist but the assignment ratio is below
 *   UNCERTAINTY_RATIO_MIN the utterance is marked 'unknown' and the caller
 *   should fall back to lastSpeakerSide for conversation flow continuity.
 *   Confidence is always returned so the UI can show a warning.
 */

import type { SpeakerSide } from '../../../lib/types';

// ─── Tunable parameters ───────────────────────────────────────────────────────

const SAMPLE_RATE = 16_000;

// Pitch estimation — autocorrelation over a centred 1 024-sample window
const PITCH_WINDOW = 1_024; // ~64 ms
const MIN_LAG = 40;         // ≈ 400 Hz (upper F0 bound for speech)
const MAX_LAG = 220;        // ≈ 72 Hz  (lower F0 bound for male voice)
const MIN_VOICED_CORR = 0.25; // normalised autocorr threshold; below = unvoiced → pitch 0

// Spectral centroid — 256-point DFT on the first 256 samples, Hann-windowed
const DFT_SIZE = 256;
const MAX_CENTROID_HZ = 4_000; // only integrate up to this frequency

// Feature normalisation (defines the scale of the distance metric)
const NORM_PITCH = 350;     // Hz — typical F0 spread across speakers
const NORM_CENTROID = 3_500; // Hz — centroid spread
const NORM_ENERGY = 0.06;   // RMS — energy spread

// Feature weights [pitch, centroid, energy] — pitch is most speaker-discriminative
const FEAT_WEIGHTS = [2.5, 1.0, 0.5] as const;

// New utterance contributes this fraction to the profile EMA
// Decreases towards 0.1 as more utterances are seen (trust early data less)
const PROFILE_ALPHA_INIT = 0.5;
const PROFILE_ALPHA_MIN = 0.1;

// Second utterance must be this far from the left profile to create a right profile
const SAME_SPEAKER_THRESHOLD = 0.20;

// For assignment to be 'certain', the winning profile must be this many times
// closer than the other (dist_winner / dist_loser < 1 / UNCERTAINTY_RATIO_MIN)
const UNCERTAINTY_RATIO_MIN = 1.35;

// ─── Types ────────────────────────────────────────────────────────────────────

interface UtteranceFeatures {
  pitch: number;    // Hz (0 = unvoiced / silent)
  centroid: number; // Hz
  energy: number;   // RMS
}

interface SpeakerProfile {
  pitch: number;
  centroid: number;
  energy: number;
  count: number;
}

export interface SpeakerAssignment {
  /** Determined speaker side; 'unknown' when confidence is below threshold */
  side: SpeakerSide;
  /** 0 = equidistant / no profiles yet; 1 = unambiguously one speaker */
  confidence: number;
}

export interface SpeakerHeuristicsHandle {
  /**
   * Extract features from utterance audio and assign to a speaker side.
   * Internally updates the speaker profile EMA.
   */
  assign: (audio: Float32Array) => SpeakerAssignment;
  /** Clear all profiles and last-speaker memory */
  reset: () => void;
}

// ─── Pitch estimation ─────────────────────────────────────────────────────────

/**
 * Estimates the fundamental frequency of a speech utterance using
 * normalised autocorrelation over a centred window.
 * Returns 0 when the signal is unvoiced or too short.
 */
function estimatePitch(audio: Float32Array): number {
  if (audio.length < MIN_LAG * 2) return 0;

  // Centre the analysis window
  const half = PITCH_WINDOW >> 1;
  const start = Math.max(0, Math.floor(audio.length / 2) - half);
  const end = Math.min(audio.length, start + PITCH_WINDOW);
  const frame = audio.subarray(start, end);

  // r[0] — energy / zero-lag autocorrelation
  let r0 = 0;
  for (let i = 0; i < frame.length; i++) r0 += frame[i] * frame[i];
  if (r0 < 1e-9) return 0;

  // Find the lag with maximum normalised autocorrelation
  let bestLag = 0;
  let bestCorr = MIN_VOICED_CORR; // threshold — must exceed this to count as voiced

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

  if (bestLag === 0) return 0;

  // Sub-sample refinement via parabolic interpolation
  let refinedLag = bestLag;
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
      refinedLag = bestLag + (rNext - rPrev) / denom;
    }
  }

  return refinedLag > 0 ? SAMPLE_RATE / refinedLag : 0;
}

// ─── Spectral centroid ────────────────────────────────────────────────────────

/** Pre-compute Hann window coefficients once */
const _hannCoeffs = new Float32Array(DFT_SIZE);
for (let i = 0; i < DFT_SIZE; i++) {
  _hannCoeffs[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (DFT_SIZE - 1)));
}

/**
 * Computes spectral centroid (Hz) of the first DFT_SIZE samples using a
 * 256-point DFT, Hann-windowed, integrating up to MAX_CENTROID_HZ.
 * Returns 0 on silent input.
 */
function spectralCentroid(audio: Float32Array): number {
  const N = Math.min(DFT_SIZE, audio.length);

  // Apply Hann window to a copy
  const windowed = new Float32Array(DFT_SIZE); // zero-padded if audio shorter
  for (let i = 0; i < N; i++) windowed[i] = audio[i] * _hannCoeffs[i];

  // DFT magnitude weighted average — only up to MAX_CENTROID_HZ
  const maxBin = Math.floor((MAX_CENTROID_HZ / SAMPLE_RATE) * DFT_SIZE); // 64

  let weightedSum = 0;
  let magSum = 0;

  for (let k = 1; k <= maxBin; k++) {
    let re = 0, im = 0;
    const freq = (k * SAMPLE_RATE) / DFT_SIZE;
    for (let n = 0; n < DFT_SIZE; n++) {
      const phi = (2 * Math.PI * k * n) / DFT_SIZE;
      re += windowed[n] * Math.cos(phi);
      im += windowed[n] * Math.sin(phi);
    }
    const mag = Math.sqrt(re * re + im * im);
    weightedSum += freq * mag;
    magSum += mag;
  }

  return magSum < 1e-10 ? 0 : weightedSum / magSum;
}

// ─── RMS energy ───────────────────────────────────────────────────────────────

function rmsEnergy(audio: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
  return Math.sqrt(sum / audio.length);
}

// ─── Feature extraction ───────────────────────────────────────────────────────

function extractFeatures(audio: Float32Array): UtteranceFeatures {
  return {
    pitch: estimatePitch(audio),
    centroid: spectralCentroid(audio),
    energy: rmsEnergy(audio),
  };
}

// ─── Profile distance ─────────────────────────────────────────────────────────

/**
 * Normalised weighted Euclidean distance between utterance features and a
 * speaker profile.  Returns a value in [0, ∞) — smaller = more similar.
 */
function featureDistance(f: UtteranceFeatures, p: SpeakerProfile): number {
  const dp = (f.pitch - p.pitch) / NORM_PITCH;
  const dc = (f.centroid - p.centroid) / NORM_CENTROID;
  const de = (f.energy - p.energy) / NORM_ENERGY;
  const [w0, w1, w2] = FEAT_WEIGHTS;
  return Math.sqrt(w0 * dp * dp + w1 * dc * dc + w2 * de * de);
}

// ─── Profile update (EMA) ────────────────────────────────────────────────────

function profileFrom(f: UtteranceFeatures): SpeakerProfile {
  return { pitch: f.pitch, centroid: f.centroid, energy: f.energy, count: 1 };
}

function updateProfile(p: SpeakerProfile, f: UtteranceFeatures): SpeakerProfile {
  // Alpha decays as count grows so early observations carry more weight
  const alpha = Math.max(PROFILE_ALPHA_MIN, PROFILE_ALPHA_INIT / (1 + p.count * 0.4));
  return {
    pitch: p.pitch * (1 - alpha) + f.pitch * alpha,
    centroid: p.centroid * (1 - alpha) + f.centroid * alpha,
    energy: p.energy * (1 - alpha) + f.energy * alpha,
    count: p.count + 1,
  };
}

// ─── Public factory ───────────────────────────────────────────────────────────

export function createSpeakerHeuristics(): SpeakerHeuristicsHandle {
  let leftProfile: SpeakerProfile | null = null;
  let rightProfile: SpeakerProfile | null = null;
  let lastSide: SpeakerSide = 'left';

  function assign(audio: Float32Array): SpeakerAssignment {
    const f = extractFeatures(audio);

    // ── No profiles yet: first utterance ──────────────────────────────────
    if (!leftProfile) {
      leftProfile = profileFrom(f);
      lastSide = 'left';
      return { side: 'left', confidence: 0.5 }; // first utterance: moderate confidence
    }

    // ── Only left profile: second utterance ────────────────────────────────
    if (!rightProfile) {
      const distLeft = featureDistance(f, leftProfile);
      if (distLeft > SAME_SPEAKER_THRESHOLD) {
        // Features are distinct enough — likely a different speaker
        rightProfile = profileFrom(f);
        lastSide = 'right';
        return { side: 'right', confidence: 0.6 };
      } else {
        // Sounds like the same speaker
        leftProfile = updateProfile(leftProfile, f);
        lastSide = 'left';
        return { side: 'left', confidence: 0.6 };
      }
    }

    // ── Both profiles exist: assign to nearest ─────────────────────────────
    const distLeft = featureDistance(f, leftProfile);
    const distRight = featureDistance(f, rightProfile);
    const totalDist = distLeft + distRight;

    // Normalised distance ratio in [0, 1]; 0.5 = equidistant
    const ratio = totalDist < 1e-10 ? 0.5 : distLeft / totalDist;
    // Confidence in [0, 1]; 0 = equidistant, 1 = unambiguously one side
    const confidence = Math.min(1, Math.abs(ratio - 0.5) * 2 * 1.5);

    const winnerRatio = totalDist < 1e-10
      ? 1
      : Math.max(distLeft, distRight) / Math.max(Math.min(distLeft, distRight), 1e-10);

    const isCertain = winnerRatio >= UNCERTAINTY_RATIO_MIN;
    const assignedSide: 'left' | 'right' = distLeft <= distRight ? 'left' : 'right';

    if (!isCertain) {
      // Uncertain — use last known side so the conversation doesn't stall
      return { side: lastSide, confidence };
    }

    // Update the winning profile
    if (assignedSide === 'left') {
      leftProfile = updateProfile(leftProfile, f);
    } else {
      rightProfile = updateProfile(rightProfile, f);
    }

    lastSide = assignedSide;
    return { side: assignedSide, confidence };
  }

  function reset(): void {
    leftProfile = null;
    rightProfile = null;
    lastSide = 'left';
  }

  return { assign, reset };
}
