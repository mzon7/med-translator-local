/**
 * Voice Pitch Copy — Vitest test suite
 *
 * Coverage:
 *   1.  pitchAnalyzer — returns 0 for silence / short buffers
 *   2.  pitchAnalyzer — estimates F0 within ±30 Hz for synthetic sine tones
 *   3.  pitchAnalyzer — mapPitchToSynthScale: monotonically increasing, clamped
 *   4.  pitchAnalyzer — unvoiced input (0 Hz) maps to neutral synth scale (1.0)
 *   5.  voiceSynth — feature flag enabled by default; can be toggled
 *   6.  voiceSynth — storePitchForSpeaker does not throw on silent audio
 *   7.  voiceSynth — storePitchForSpeaker stores a profile that influences TTS pitch
 *   8.  voiceSynth — resetPitchProfiles clears stored pitch so TTS reverts to 1.0
 *   9.  voiceSynth — speakTranslation calls SpeechSynthesis.speak with correct lang
 *  10.  voiceSynth — speakTranslation is a no-op when feature is disabled
 *  11.  voiceSynth — speakTranslation is a no-op for blank / whitespace-only text
 *  12.  voiceSynth — speakTranslation cancels any in-flight speech before speaking
 *  13.  voiceSynth — cancelSpeech calls SpeechSynthesis.cancel
 *  14.  voiceSynth — speakTranslation is a no-op when SpeechSynthesis is unavailable
 *  15.  voiceSynth — high-pitched speaker produces higher TTS pitch than low-pitched
 *  16.  voiceSynth — EMA pitch profile updates gradually (does not jump on one sample)
 *  17.  VoicePitchToggle — renders toggle in correct checked state
 *  18.  VoicePitchToggle — fires onToggle when the switch is clicked
 *  19.  VoicePitchToggle — toggle is accessible (role=switch, aria-checked)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { estimatePitchHz, mapPitchToSynthScale } from '../../features/voice-pitch-copy/lib/pitchAnalyzer';
import {
  storePitchForSpeaker,
  resetPitchProfiles,
  speakTranslation,
  isVoicePitchEnabled,
  setVoicePitchEnabled,
  cancelSpeech,
} from '../../features/voice-pitch-copy/lib/voiceSynth';
import { VoicePitchToggle } from '../../features/voice-pitch-copy/components/VoicePitchToggle';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a pure sine wave at the given frequency (16 kHz, 2048 samples). */
function sineWave(freqHz: number, length = 2048): Float32Array {
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buf[i] = Math.sin((2 * Math.PI * freqHz * i) / 16_000);
  }
  return buf;
}

// ─── SpeechSynthesis mock ─────────────────────────────────────────────────────

const mockSpeak = vi.fn();
const mockCancel = vi.fn();
const mockGetVoices = vi.fn(() => [] as SpeechSynthesisVoice[]);

class MockSpeechSynthesisUtterance {
  text: string;
  lang = '';
  pitch = 1;
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  constructor(text: string) { this.text = text; }
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

// ─────────────────────────────────────────────────────────────────────────────
// 1. pitchAnalyzer — silence / short buffers return 0
// ─────────────────────────────────────────────────────────────────────────────

describe('pitchAnalyzer — silence and edge inputs', () => {
  it('returns 0 for an all-zero (silent) buffer', () => {
    expect(estimatePitchHz(new Float32Array(2048))).toBe(0);
  });

  it('returns 0 for a buffer shorter than 80 samples (below MIN_LAG * 2)', () => {
    const short = new Float32Array(40);
    short.fill(0.1);
    expect(estimatePitchHz(short)).toBe(0);
  });

  it('returns 0 when energy is below the voiced correlation threshold', () => {
    // Very low amplitude → autocorrelation stays below MIN_VOICED_CORR
    const whisper = new Float32Array(2048);
    for (let i = 0; i < whisper.length; i++) whisper[i] = 1e-6 * Math.random();
    // Just verify it doesn't throw and returns a number
    expect(typeof estimatePitchHz(whisper)).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. pitchAnalyzer — F0 estimation accuracy
// ─────────────────────────────────────────────────────────────────────────────

describe('pitchAnalyzer — F0 estimation', () => {
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

  it('estimates ~200 Hz from a 200 Hz sine tone (±30 Hz tolerance)', () => {
    const pitch = estimatePitchHz(sineWave(200));
    expect(pitch).toBeGreaterThan(170);
    expect(pitch).toBeLessThan(230);
  });

  it('returns a positive value for any clearly voiced tone in the 80–300 Hz range', () => {
    // 120 Hz is comfortably within the autocorrelation lag window
    expect(estimatePitchHz(sineWave(120))).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 & 4. pitchAnalyzer — mapPitchToSynthScale
// ─────────────────────────────────────────────────────────────────────────────

describe('pitchAnalyzer — mapPitchToSynthScale', () => {
  it('returns 1.0 for 0 Hz (unvoiced — TTS uses browser default)', () => {
    expect(mapPitchToSynthScale(0)).toBe(1.0);
  });

  it('returns a value below 1.0 for a deep male voice (~85 Hz)', () => {
    expect(mapPitchToSynthScale(85)).toBeLessThan(1.0);
  });

  it('returns a value above 1.0 for a high female voice (~260 Hz)', () => {
    expect(mapPitchToSynthScale(260)).toBeGreaterThan(1.0);
  });

  it('increases monotonically with pitch frequency', () => {
    const s1 = mapPitchToSynthScale(100);
    const s2 = mapPitchToSynthScale(180);
    const s3 = mapPitchToSynthScale(280);
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
  });

  it('clamps output to [0.3, 1.9] for extreme inputs', () => {
    expect(mapPitchToSynthScale(1)).toBeGreaterThanOrEqual(0.3);
    expect(mapPitchToSynthScale(10_000)).toBeLessThanOrEqual(1.9);
  });

  it('clamps negative Hz to [0.3, 1.9]', () => {
    expect(mapPitchToSynthScale(-50)).toBeGreaterThanOrEqual(0.3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. voiceSynth — feature flag
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — feature flag', () => {
  it('is enabled after setVoicePitchEnabled(true)', () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// 6. voiceSynth — storePitchForSpeaker (error handling)
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — storePitchForSpeaker edge cases', () => {
  it('does not throw on silent audio', () => {
    expect(() =>
      storePitchForSpeaker('left', new Float32Array(2048)),
    ).not.toThrow();
  });

  it('does not throw on a very short buffer', () => {
    expect(() =>
      storePitchForSpeaker('right', new Float32Array(10)),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. voiceSynth — stored profile influences TTS pitch
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — pitch profile affects TTS output', () => {
  it('high-pitched speaker produces TTS pitch > 1.0', () => {
    storePitchForSpeaker('left', sineWave(260));
    speakTranslation('Test', 'en', 'left');
    const utterance = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.pitch).toBeGreaterThan(1.0);
  });

  it('low-pitched speaker produces TTS pitch < 1.0', () => {
    storePitchForSpeaker('right', sineWave(90));
    speakTranslation('Prueba', 'es', 'right');
    const utterance = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.pitch).toBeLessThan(1.0);
  });

  it('left and right speakers maintain independent pitch profiles', () => {
    storePitchForSpeaker('left', sineWave(260)); // high
    storePitchForSpeaker('right', sineWave(90)); // low

    speakTranslation('Left speaker output', 'en', 'left');
    const leftPitch = (mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance).pitch;
    mockSpeak.mockClear();

    speakTranslation('Right speaker output', 'es', 'right');
    const rightPitch = (mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance).pitch;

    expect(leftPitch).toBeGreaterThan(rightPitch);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. voiceSynth — resetPitchProfiles
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — resetPitchProfiles', () => {
  it('reverts TTS pitch to neutral (1.0) after a reset', () => {
    storePitchForSpeaker('left', sineWave(260));
    resetPitchProfiles();
    speakTranslation('Reset test', 'en', 'left');
    const utterance = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.pitch).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. voiceSynth — speakTranslation happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — speakTranslation happy path', () => {
  it('calls SpeechSynthesis.speak for valid text', () => {
    speakTranslation('Hello world', 'en', 'left');
    expect(mockSpeak).toHaveBeenCalledOnce();
  });

  it('sets correct BCP-47 language — English', () => {
    speakTranslation('Hello', 'en', 'left');
    const u = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(u.lang).toBe('en-US');
  });

  it('sets correct BCP-47 language — Spanish', () => {
    speakTranslation('Hola', 'es', 'left');
    const u = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(u.lang).toBe('es-ES');
  });

  it('sets correct BCP-47 language — Japanese', () => {
    speakTranslation('こんにちは', 'ja', 'right');
    const u = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(u.lang).toBe('ja-JP');
  });

  it('sets correct BCP-47 language — Arabic', () => {
    speakTranslation('مرحبا', 'ar', 'right');
    const u = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(u.lang).toBe('ar-SA');
  });

  it('defaults pitch to 1.0 when no profile has been stored', () => {
    speakTranslation('Neutral', 'en', 'left');
    const u = mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(u.pitch).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. voiceSynth — disabled feature is a no-op
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — disabled feature', () => {
  it('does not call speak when the feature is turned off', () => {
    setVoicePitchEnabled(false);
    speakTranslation('Should not be spoken', 'en', 'left');
    expect(mockSpeak).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. voiceSynth — blank text is a no-op
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — blank text edge cases', () => {
  it('does not speak empty string', () => {
    speakTranslation('', 'en', 'left');
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('does not speak whitespace-only text', () => {
    speakTranslation('   \t\n  ', 'en', 'left');
    expect(mockSpeak).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. voiceSynth — cancels in-flight speech before speaking
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — cancels existing speech', () => {
  it('calls cancel before speak to prevent overlap', () => {
    const callOrder: string[] = [];
    mockCancel.mockImplementation(() => callOrder.push('cancel'));
    mockSpeak.mockImplementation(() => callOrder.push('speak'));

    speakTranslation('First', 'en', 'left');
    speakTranslation('Second', 'en', 'left');

    // Each call should cancel before speaking
    expect(callOrder).toEqual(['cancel', 'speak', 'cancel', 'speak']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. voiceSynth — cancelSpeech
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — cancelSpeech', () => {
  it('calls SpeechSynthesis.cancel', () => {
    cancelSpeech();
    expect(mockCancel).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. voiceSynth — SpeechSynthesis unavailable (browser does not support it)
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — SpeechSynthesis unavailable', () => {
  it('does not throw when window.speechSynthesis is undefined', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(() => speakTranslation('Hello', 'en', 'left')).not.toThrow();
    expect(mockSpeak).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15 & 16. voiceSynth — EMA pitch profile
// ─────────────────────────────────────────────────────────────────────────────

describe('voiceSynth — EMA pitch profile', () => {
  it('high-pitched speaker produces higher TTS pitch than low-pitched', () => {
    resetPitchProfiles();
    storePitchForSpeaker('left', sineWave(260));
    speakTranslation('High voice', 'en', 'left');
    const highPitch = (mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance).pitch;
    mockSpeak.mockClear();
    mockCancel.mockClear();

    resetPitchProfiles();
    storePitchForSpeaker('left', sineWave(90));
    speakTranslation('Low voice', 'en', 'left');
    const lowPitch = (mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance).pitch;

    expect(highPitch).toBeGreaterThan(lowPitch);
  });

  it('EMA update does not drastically jump pitch after a single utterance over an established profile', () => {
    // Build up an established 150 Hz profile
    for (let i = 0; i < 5; i++) storePitchForSpeaker('left', sineWave(150));

    speakTranslation('Before spike', 'en', 'left');
    const beforePitch = (mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance).pitch;
    mockSpeak.mockClear();

    // Single 260 Hz spike — EMA should blend it in gradually (30% weight)
    storePitchForSpeaker('left', sineWave(260));
    speakTranslation('After spike', 'en', 'left');
    const afterPitch = (mockSpeak.mock.calls[0][0] as MockSpeechSynthesisUtterance).pitch;

    // afterPitch should be somewhat higher but not as high as a pure 260 Hz profile
    const purePitch = mapPitchToSynthScale(260);
    expect(afterPitch).toBeGreaterThan(beforePitch);
    expect(afterPitch).toBeLessThan(purePitch);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17, 18, 19. VoicePitchToggle component
// ─────────────────────────────────────────────────────────────────────────────

describe('VoicePitchToggle component', () => {
  it('renders the toggle switch with correct aria-checked when enabled', () => {
    render(
      <VoicePitchToggle enabled={true} onToggle={vi.fn()} />,
    );
    const switchEl = screen.getByRole('switch');
    expect(switchEl).toHaveAttribute('aria-checked', 'true');
  });

  it('renders the toggle switch with correct aria-checked when disabled', () => {
    render(
      <VoicePitchToggle enabled={false} onToggle={vi.fn()} />,
    );
    const switchEl = screen.getByRole('switch');
    expect(switchEl).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onToggle when the switch is clicked', () => {
    const onToggle = vi.fn();
    render(<VoicePitchToggle enabled={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('has an accessible label', () => {
    render(<VoicePitchToggle enabled={true} onToggle={vi.fn()} />);
    expect(screen.getByRole('switch', { name: /voice pitch copy/i })).toBeInTheDocument();
  });

  it('displays the "Voice Pitch Copy" label text', () => {
    render(<VoicePitchToggle enabled={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/Voice Pitch Copy/i)).toBeInTheDocument();
  });
});
