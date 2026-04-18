import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimatePitchHz, mapPitchToSynthScale } from '../lib/pitchAnalyzer';
import {
  storePitchForSpeaker,
  resetPitchProfiles,
  speakTranslation,
  isVoicePitchEnabled,
  setVoicePitchEnabled,
  cancelSpeech,
} from '../lib/voiceSynth';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a pure sine wave at the given frequency (16 kHz, 2048 samples). */
function sineWave(freqHz: number, length = 2048): Float32Array {
  const audio = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    audio[i] = Math.sin((2 * Math.PI * freqHz * i) / 16_000);
  }
  return audio;
}

// ─── Mock SpeechSynthesis ─────────────────────────────────────────────────────

const mockSpeak = vi.fn();
const mockCancel = vi.fn();
const mockGetVoices = vi.fn(() => [] as SpeechSynthesisVoice[]);

// Mock SpeechSynthesisUtterance as a simple class
class MockSpeechSynthesisUtterance {
  text: string;
  lang = '';
  pitch = 1;
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

beforeEach(() => {
  vi.stubGlobal('speechSynthesis', {
    speak: mockSpeak,
    cancel: mockCancel,
    getVoices: mockGetVoices,
  });
  vi.stubGlobal('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance);

  mockSpeak.mockClear();
  mockCancel.mockClear();
  mockGetVoices.mockClear();

  resetPitchProfiles();
  setVoicePitchEnabled(true);
});

// ─── pitchAnalyzer: estimatePitchHz ──────────────────────────────────────────

describe('estimatePitchHz', () => {
  it('returns 0 for a silent (all-zero) buffer', () => {
    expect(estimatePitchHz(new Float32Array(2048))).toBe(0);
  });

  it('returns 0 for a buffer shorter than 80 samples (< MIN_LAG * 2)', () => {
    const buf = new Float32Array(40);
    buf.fill(0.5);
    expect(estimatePitchHz(buf)).toBe(0);
  });

  it('estimates ~200 Hz from a 200 Hz sine tone (±30 Hz tolerance)', () => {
    const pitch = estimatePitchHz(sineWave(200));
    expect(pitch).toBeGreaterThan(170);
    expect(pitch).toBeLessThan(230);
  });

  it('estimates ~100 Hz from a 100 Hz sine tone (±25 Hz tolerance)', () => {
    const pitch = estimatePitchHz(sineWave(100));
    expect(pitch).toBeGreaterThan(75);
    expect(pitch).toBeLessThan(130);
  });

  it('estimates ~150 Hz from a 150 Hz sine tone (±30 Hz tolerance)', () => {
    const pitch = estimatePitchHz(sineWave(150));
    expect(pitch).toBeGreaterThan(110);
    expect(pitch).toBeLessThan(200);
  });

  it('returns a positive number for any clearly voiced sine tone', () => {
    // 180 Hz is within the lag range (72–400 Hz)
    expect(estimatePitchHz(sineWave(180))).toBeGreaterThan(0);
  });
});

// ─── pitchAnalyzer: mapPitchToSynthScale ──────────────────────────────────────

describe('mapPitchToSynthScale', () => {
  it('returns 1.0 for 0 Hz (unvoiced — TTS uses browser default)', () => {
    expect(mapPitchToSynthScale(0)).toBe(1.0);
  });

  it('returns a value below 1.0 for a deep male voice (~85 Hz)', () => {
    expect(mapPitchToSynthScale(85)).toBeLessThan(1.0);
  });

  it('returns a value above 1.0 for a high female voice (~250 Hz)', () => {
    expect(mapPitchToSynthScale(250)).toBeGreaterThan(1.0);
  });

  it('increases monotonically with pitch frequency', () => {
    const p1 = mapPitchToSynthScale(100);
    const p2 = mapPitchToSynthScale(180);
    const p3 = mapPitchToSynthScale(280);
    expect(p1).toBeLessThan(p2);
    expect(p2).toBeLessThan(p3);
  });

  it('clamps output to [0.3, 1.9]', () => {
    expect(mapPitchToSynthScale(1)).toBeGreaterThanOrEqual(0.3);
    expect(mapPitchToSynthScale(10_000)).toBeLessThanOrEqual(1.9);
  });
});

// ─── voiceSynth: storePitchForSpeaker ────────────────────────────────────────

describe('storePitchForSpeaker', () => {
  it('does not throw for silent audio', () => {
    expect(() =>
      storePitchForSpeaker('left', new Float32Array(2048)),
    ).not.toThrow();
  });

  it('does not throw for a voiced sine tone', () => {
    expect(() => storePitchForSpeaker('right', sineWave(150))).not.toThrow();
  });

  it('influences speakTranslation pitch after storing a high-pitched tone', () => {
    // Store a clearly high-pitched voice (260 Hz) for left speaker
    storePitchForSpeaker('left', sineWave(260));

    speakTranslation('Test output', 'en', 'left');
    const utterance = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    // 260 Hz maps to > 1.0 on the synth scale
    expect(utterance.pitch).toBeGreaterThan(1.0);
  });

  it('influences speakTranslation pitch after storing a low-pitched tone', () => {
    // Store a clearly deep voice (90 Hz) for right speaker
    storePitchForSpeaker('right', sineWave(90));

    speakTranslation('Test output', 'es', 'right');
    const utterance = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    // 90 Hz maps to < 1.0 on the synth scale
    expect(utterance.pitch).toBeLessThan(1.0);
  });
});

// ─── voiceSynth: speakTranslation ────────────────────────────────────────────

describe('speakTranslation', () => {
  it('calls speechSynthesis.cancel then speak for valid input', () => {
    speakTranslation('Hello world', 'en', 'left');
    expect(mockCancel).toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledOnce();
  });

  it('sets the correct BCP-47 language on the utterance', () => {
    speakTranslation('Hola mundo', 'es', 'left');
    const utterance = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.lang).toBe('es-ES');
  });

  it('sets Japanese locale correctly', () => {
    speakTranslation('こんにちは', 'ja', 'right');
    const utterance = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.lang).toBe('ja-JP');
  });

  it('defaults pitch to 1.0 (neutral) when no profile has been stored', () => {
    speakTranslation('Neutral voice', 'en', 'left');
    const utterance = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.pitch).toBe(1.0); // mapPitchToSynthScale(0) = 1.0
  });

  it('does not speak when the feature is disabled', () => {
    setVoicePitchEnabled(false);
    speakTranslation('Should not be spoken', 'en', 'left');
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('does not speak blank / whitespace-only text', () => {
    speakTranslation('   ', 'en', 'left');
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('does not speak an empty string', () => {
    speakTranslation('', 'fr', 'right');
    expect(mockSpeak).not.toHaveBeenCalled();
  });
});

// ─── voiceSynth: cancelSpeech ─────────────────────────────────────────────────

describe('cancelSpeech', () => {
  it('calls speechSynthesis.cancel', () => {
    cancelSpeech();
    expect(mockCancel).toHaveBeenCalledOnce();
  });
});

// ─── voiceSynth: feature flag ─────────────────────────────────────────────────

describe('feature flag', () => {
  it('is enabled by default after setVoicePitchEnabled(true)', () => {
    setVoicePitchEnabled(true);
    expect(isVoicePitchEnabled()).toBe(true);
  });

  it('can be disabled', () => {
    setVoicePitchEnabled(false);
    expect(isVoicePitchEnabled()).toBe(false);
  });

  it('can be re-enabled after being disabled', () => {
    setVoicePitchEnabled(false);
    setVoicePitchEnabled(true);
    expect(isVoicePitchEnabled()).toBe(true);
  });
});

// ─── voiceSynth: resetPitchProfiles ──────────────────────────────────────────

describe('resetPitchProfiles', () => {
  it('resets pitch so TTS defaults to neutral (1.0) after a reset', () => {
    // Store a high pitch then reset
    storePitchForSpeaker('left', sineWave(260));
    resetPitchProfiles();

    speakTranslation('Reset test', 'en', 'left');
    const utterance = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.pitch).toBe(1.0);
  });
});
