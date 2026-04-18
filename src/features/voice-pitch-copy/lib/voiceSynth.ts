/**
 * voiceSynth.ts — Text-to-speech with per-speaker pitch matching
 *
 * Uses the Web Speech API (SpeechSynthesis) to speak translated text
 * with pitch adjusted to match the original speaker's detected F0.
 *
 * Per-speaker pitch profiles are maintained as exponential moving averages
 * so the voice adapts gradually across utterances in a session.
 */

import { estimatePitchHz, mapPitchToSynthScale } from './pitchAnalyzer';

const STORAGE_KEY = 'med_translator_voice_pitch_enabled';

// ─── Feature flag (lazy-initialised to avoid localStorage at import time) ─────

let _enabledCache: boolean | null = null;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true; // default on — SSR / restricted contexts
  }
}

export function isVoicePitchEnabled(): boolean {
  if (_enabledCache === null) _enabledCache = readEnabled();
  return _enabledCache;
}

export function setVoicePitchEnabled(value: boolean): void {
  _enabledCache = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // localStorage may not be available in all environments
  }
}

// ─── Per-speaker pitch profiles (EMA over utterances) ─────────────────────────

const _pitchHz: Record<'left' | 'right', number> = { left: 0, right: 0 };

/**
 * Analyse utterance audio and update the EMA pitch profile for the given
 * speaker side.  Call this synchronously in onSpeechEnd alongside
 * speaker attribution so the profile is ready before TTS output.
 */
export function storePitchForSpeaker(
  side: 'left' | 'right',
  audio: Float32Array,
): void {
  const hz = estimatePitchHz(audio);
  if (hz <= 0) return;
  // EMA: blend new observation into existing profile (30% weight for new data)
  const prev = _pitchHz[side];
  _pitchHz[side] = prev === 0 ? hz : prev * 0.7 + hz * 0.3;
}

/** Reset pitch profiles when a new session starts. */
export function resetPitchProfiles(): void {
  _pitchHz.left = 0;
  _pitchHz.right = 0;
}

// ─── Language → BCP-47 locale ─────────────────────────────────────────────────

const LANG_TO_BCP47: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  ar: 'ar-SA',
  hi: 'hi-IN',
  zh: 'zh-CN',
  pt: 'pt-BR',
  ru: 'ru-RU',
  ja: 'ja-JP',
};

function toBCP47(langCode: string): string {
  return LANG_TO_BCP47[langCode] ?? langCode;
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

/**
 * Speak translated text via the Web Speech API.
 *
 * Pitch is taken from the speaker's stored profile and mapped to the 0–2
 * SpeechSynthesis scale.  Cancels any currently speaking utterance first
 * so overlapping translations don't pile up.
 *
 * Silently no-ops when:
 *   • The feature is disabled
 *   • SpeechSynthesis is unavailable (unsupported browser / test env)
 *   • The text is blank
 */
export function speakTranslation(
  text: string,
  targetLangCode: string,
  speakerSide: 'left' | 'right',
): void {
  if (!isVoicePitchEnabled()) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  if (!text.trim()) return;

  // Cancel in-flight speech to avoid overlap
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = toBCP47(targetLangCode);
  utterance.pitch = mapPitchToSynthScale(_pitchHz[speakerSide]);
  utterance.rate = 1.0;
  utterance.volume = 1.0;

  // Prefer a voice that matches the target language if available
  const voices = window.speechSynthesis.getVoices();
  const match = voices.find(
    (v) => v.lang === utterance.lang || v.lang.startsWith(targetLangCode + '-'),
  );
  if (match) utterance.voice = match;

  window.speechSynthesis.speak(utterance);
}

/** Cancel any currently spoken utterance. */
export function cancelSpeech(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
