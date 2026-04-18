/**
 * Translation Feature — Vitest test suite
 *
 * Coverage:
 *   1. Language persistence (localStorage round-trip, left/right isolation)
 *   2. Model-ready flag persistence
 *   3. Privacy boundary — sanitizeForLog strips PII
 *   4. VAD — detects speech from energy, forces segment at cap
 *   5. Speaker heuristics — pitch/centroid/energy feature extraction
 *   6. TranscriptPane — paired bubble rendering (source + translation)
 *   7. TranscriptPane — failed utterance shows retry button
 *   8. TranscriptPane — empty state
 *   9. BigMicButton — disabled when model not ready
 *  10. SettingsSheet — clear button disabled with no transcripts
 *  11. SettingsSheet — keyboard/outside close
 *  12. Direction logic — speakerSide drives language pair (reducer slice)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Pure logic modules ─────────────────────────────────────────────────────
import { sanitizeForLog } from '../../features/translation-feature/lib/privacyBoundary';
import { createVAD, VAD_SAMPLE_RATE } from '../../features/translation-feature/lib/vad';
import { createSpeakerHeuristics } from '../../features/translation-feature/lib/speakerHeuristics';
import {
  LANGUAGES,
  DEFAULT_LEFT_LANGUAGE,
  DEFAULT_RIGHT_LANGUAGE,
  loadPersistedLanguages,
  persistLanguage,
  persistModelReady,
  loadModelReady,
  clearModelReady,
} from '../../features/translation-feature/lib/languages';

// ── Components ─────────────────────────────────────────────────────────────
import { TranscriptPane } from '../../features/translation-feature/components/TranscriptPane';
import { BigMicButton } from '../../features/translation-feature/components/BigMicButton';
import { SettingsSheet } from '../../features/translation-feature/components/SettingsSheet';

// ── Types ──────────────────────────────────────────────────────────────────
import type { Utterance } from '../../lib/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

const EN = LANGUAGES.find((l) => l.code === 'en')!;
const ES = LANGUAGES.find((l) => l.code === 'es')!;

function makeUtterance(overrides: Partial<Utterance> = {}): Utterance {
  return {
    id: crypto.randomUUID(),
    timestampStart: Date.now(),
    speakerSide: 'left',
    sourceLang: 'en',
    targetLang: 'es',
    sourceText: 'Hello',
    translatedText: 'Hola',
    confidence: 0.9,
    isPartial: false,
    ...overrides,
  };
}

/** Float32Array filled with a sine wave at the given amplitude */
function sineWave(samples: number, amplitude: number, freq = 440): Float32Array {
  const buf = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    buf[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / VAD_SAMPLE_RATE);
  }
  return buf;
}

/** Float32Array of near-zero samples (silence) */
function silence(samples: number): Float32Array {
  return new Float32Array(samples); // all zeros
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Language persistence
// ─────────────────────────────────────────────────────────────────────────

describe('Language persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default languages when nothing is persisted', () => {
    const { left, right } = loadPersistedLanguages();
    expect(left.code).toBe(DEFAULT_LEFT_LANGUAGE.code);
    expect(right.code).toBe(DEFAULT_RIGHT_LANGUAGE.code);
  });

  it('round-trips left and right language selections independently', () => {
    const fr = LANGUAGES.find((l) => l.code === 'fr')!;
    const de = LANGUAGES.find((l) => l.code === 'de')!;

    persistLanguage('left', fr);
    persistLanguage('right', de);

    const { left, right } = loadPersistedLanguages();
    expect(left.code).toBe('fr');
    expect(right.code).toBe('de');
  });

  it('persisting left does not affect right, and vice versa', () => {
    persistLanguage('left', ES);
    const { left: l1, right: r1 } = loadPersistedLanguages();
    expect(l1.code).toBe('es');
    expect(r1.code).toBe(DEFAULT_RIGHT_LANGUAGE.code); // right unchanged

    persistLanguage('right', EN);
    const { left: l2, right: r2 } = loadPersistedLanguages();
    expect(l2.code).toBe('es'); // left still es
    expect(r2.code).toBe('en');
  });

  it('ignores unknown language codes and returns defaults', () => {
    localStorage.setItem('med_translator_lang_left', 'klingon');
    const { left } = loadPersistedLanguages();
    expect(left.code).toBe(DEFAULT_LEFT_LANGUAGE.code);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Model-ready flag
// ─────────────────────────────────────────────────────────────────────────

describe('Model-ready flag', () => {
  beforeEach(() => localStorage.clear());

  it('returns false when flag has not been set', () => {
    expect(loadModelReady()).toBe(false);
  });

  it('returns true after persistModelReady()', () => {
    persistModelReady();
    expect(loadModelReady()).toBe(true);
  });

  it('returns false after clearModelReady()', () => {
    persistModelReady();
    clearModelReady();
    expect(loadModelReady()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Privacy boundary — sanitizeForLog
// ─────────────────────────────────────────────────────────────────────────

describe('sanitizeForLog', () => {
  it('returns Error name + truncated ASCII message for a standard Error', () => {
    const err = new Error('Connection failed');
    const result = sanitizeForLog(err);
    expect(result).toContain('Error');
    expect(result).toContain('Connection failed');
  });

  it('strips non-ASCII characters that could represent transcript text', () => {
    // Simulate an error whose message accidentally contains transcribed/translated text
    const err = new Error('Failed during: Hola amigo cómo estás 你好世界');
    const result = sanitizeForLog(err);
    // Non-ASCII should be replaced with '?'
    expect(result).not.toMatch(/[^\x20-\x7E]/);
    // The prefix should still be present
    expect(result).toContain('Error');
  });

  it('returns "Unknown error" for non-Error thrown values', () => {
    expect(sanitizeForLog('string thrown')).toBe('Unknown error');
    expect(sanitizeForLog(42)).toBe('Unknown error');
    expect(sanitizeForLog(null)).toBe('Unknown error');
  });

  it('truncates very long error messages to avoid log bloat', () => {
    const longMsg = 'x'.repeat(500);
    const err = new Error(longMsg);
    const result = sanitizeForLog(err, 120);
    // The message portion should be ≤ 120 chars
    const msgPart = result.replace(/^Error: /, '');
    expect(msgPart.length).toBeLessThanOrEqual(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. VAD — speech detection
// ─────────────────────────────────────────────────────────────────────────

describe('Voice Activity Detection (VAD)', () => {
  it('does not fire onSpeechEnd for pure silence', () => {
    const onSpeechEnd = vi.fn();
    const vad = createVAD({ onSpeechEnd });

    // Feed 2 seconds of silence
    vad.processChunk(silence(VAD_SAMPLE_RATE * 2));

    expect(onSpeechEnd).not.toHaveBeenCalled();
    expect(vad.isSpeaking).toBe(false);
  });

  it('detects speech and fires onSpeechEnd after silence gap', () => {
    const onSpeechEnd = vi.fn();
    const vad = createVAD(
      { onSpeechEnd },
      { minSpeechMs: 100, endSilenceMs: 200, preRollMs: 0 },
    );

    // 500ms of loud speech (sine wave at 0.5 amplitude)
    vad.processChunk(sineWave(VAD_SAMPLE_RATE * 0.5, 0.5));
    // 400ms of silence to trigger speech-end
    vad.processChunk(silence(VAD_SAMPLE_RATE * 0.4));

    expect(onSpeechEnd).toHaveBeenCalledOnce();
    const [audio, forced] = onSpeechEnd.mock.calls[0] as [Float32Array, boolean];
    expect(audio).toBeInstanceOf(Float32Array);
    expect(audio.length).toBeGreaterThan(0);
    expect(forced).toBe(false);
  });

  it('force-segments utterance at maxUtteranceMs cap', () => {
    const onSpeechEnd = vi.fn();
    const vad = createVAD(
      { onSpeechEnd },
      { minSpeechMs: 50, maxUtteranceMs: 200, preRollMs: 0 },
    );

    // Feed 400ms of continuous loud speech — should trigger forced segment at 200ms cap
    vad.processChunk(sineWave(VAD_SAMPLE_RATE * 0.4, 0.5));

    expect(onSpeechEnd).toHaveBeenCalled();
    const [, forced] = onSpeechEnd.mock.calls[0] as [Float32Array, boolean];
    expect(forced).toBe(true);
  });

  it('resets state correctly after reset()', () => {
    const onSpeechEnd = vi.fn();
    const vad = createVAD({ onSpeechEnd }, { minSpeechMs: 50, preRollMs: 0 });

    vad.processChunk(sineWave(VAD_SAMPLE_RATE * 0.5, 0.5));
    vad.reset();

    expect(vad.isSpeaking).toBe(false);
    // After reset, silence should not trigger lingering callbacks
    vad.processChunk(silence(VAD_SAMPLE_RATE));
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. Speaker heuristics
// ─────────────────────────────────────────────────────────────────────────

describe('Speaker heuristics', () => {
  it('assigns first utterance to left side', () => {
    const sh = createSpeakerHeuristics();
    const audio = sineWave(VAD_SAMPLE_RATE * 0.5, 0.3, 120); // ~120 Hz pitch
    const { side } = sh.assign(audio);
    expect(side).toBe('left');
  });

  it('assigns second utterance with different pitch to right side', () => {
    const sh = createSpeakerHeuristics();
    // Speaker 1: low pitch (~100 Hz)
    const lowPitch = sineWave(VAD_SAMPLE_RATE * 0.5, 0.3, 100);
    sh.assign(lowPitch); // → left
    // Speaker 2: high pitch (~250 Hz) — sufficiently different
    const highPitch = sineWave(VAD_SAMPLE_RATE * 0.5, 0.3, 250);
    const { side } = sh.assign(highPitch);
    expect(side).toBe('right');
  });

  it('returns confidence value in 0–1 range', () => {
    const sh = createSpeakerHeuristics();
    const audio = sineWave(VAD_SAMPLE_RATE * 0.5, 0.3, 150);
    const { confidence } = sh.assign(audio);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it('resets profiles after reset()', () => {
    const sh = createSpeakerHeuristics();
    const audio = sineWave(VAD_SAMPLE_RATE * 0.5, 0.3, 150);
    sh.assign(audio);
    sh.assign(audio);
    sh.reset();

    // After reset, next utterance should be left again (first speaker)
    const { side } = sh.assign(audio);
    expect(side).toBe('left');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. TranscriptPane — paired bubble rendering
// ─────────────────────────────────────────────────────────────────────────

describe('TranscriptPane — paired bubble rendering', () => {
  const utterances: Utterance[] = [
    makeUtterance({
      speakerSide: 'left',
      sourceText: 'Hello doctor',
      translatedText: 'Hola doctor',
    }),
    makeUtterance({
      speakerSide: 'right',
      sourceText: 'Buenos días',
      translatedText: 'Good morning',
    }),
  ];

  it('left pane shows source text for left-speaker utterances', () => {
    render(<TranscriptPane side="left" language={EN} utterances={utterances} />);
    expect(screen.getByText('Hello doctor')).toBeInTheDocument();
  });

  it('left pane shows translated text for right-speaker utterances', () => {
    render(<TranscriptPane side="left" language={EN} utterances={utterances} />);
    // The right-speaker's words translated into left's language
    expect(screen.getByText('Good morning')).toBeInTheDocument();
  });

  it('right pane shows source text for right-speaker utterances', () => {
    render(<TranscriptPane side="right" language={ES} utterances={utterances} />);
    expect(screen.getByText('Buenos días')).toBeInTheDocument();
  });

  it('right pane shows translated text for left-speaker utterances', () => {
    render(<TranscriptPane side="right" language={ES} utterances={utterances} />);
    expect(screen.getByText('Hola doctor')).toBeInTheDocument();
  });

  it('unknown-speaker utterances appear only in the left pane', () => {
    const unknownUtterance = makeUtterance({
      speakerSide: 'unknown',
      sourceText: 'Unknown speech',
      translatedText: 'Unknown translated',
    });
    const { rerender } = render(
      <TranscriptPane side="left" language={EN} utterances={[unknownUtterance]} />,
    );
    expect(screen.getByText('Unknown speech')).toBeInTheDocument();

    rerender(<TranscriptPane side="right" language={ES} utterances={[unknownUtterance]} />);
    expect(screen.queryByText('Unknown speech')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. TranscriptPane — empty state
// ─────────────────────────────────────────────────────────────────────────

describe('TranscriptPane — empty state', () => {
  it('shows speaker label in empty state for left pane', () => {
    render(<TranscriptPane side="left" language={EN} utterances={[]} />);
    // Both the header and the empty-state span contain "Speaker 1" — getAllByText is correct
    const matches = screen.getAllByText(/Speaker 1/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // The empty-state span says "Speaker 1 will appear here"
    expect(screen.getByText(/Speaker 1 will appear here/i)).toBeInTheDocument();
  });

  it('shows speaker label in empty state for right pane', () => {
    render(<TranscriptPane side="right" language={ES} utterances={[]} />);
    const matches = screen.getAllByText(/Speaker 2/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Speaker 2 will appear here/i)).toBeInTheDocument();
  });

  it('does not show retry button when there are no failed utterances', () => {
    const utterance = makeUtterance({ failed: false });
    render(
      <TranscriptPane
        side="left"
        language={EN}
        utterances={[utterance]}
        onRetryUtterance={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. TranscriptPane — failed utterance with retry
// ─────────────────────────────────────────────────────────────────────────

describe('TranscriptPane — failed utterance', () => {
  it('shows "Transcription failed" for a failed source utterance', () => {
    const failed = makeUtterance({ failed: true, failedReason: 'OOM error' });
    render(
      <TranscriptPane
        side="left"
        language={EN}
        utterances={[failed]}
        onRetryUtterance={vi.fn()}
      />,
    );
    expect(screen.getByText(/Transcription failed/i)).toBeInTheDocument();
  });

  it('calls onRetryUtterance with the utterance id when Retry is clicked', () => {
    const onRetry = vi.fn();
    const failed = makeUtterance({ id: 'utt-123', failed: true, failedReason: 'error' });
    render(
      <TranscriptPane
        side="left"
        language={EN}
        utterances={[failed]}
        onRetryUtterance={onRetry}
      />,
    );
    fireEvent.click(screen.getByText(/Retry/i));
    expect(onRetry).toHaveBeenCalledWith('utt-123');
  });

  it('shows "Translation unavailable" in the opposite pane for a failed utterance', () => {
    const failed = makeUtterance({
      speakerSide: 'left',
      failed: true,
      failedReason: 'error',
    });
    render(<TranscriptPane side="right" language={ES} utterances={[failed]} />);
    expect(screen.getByText(/Translation unavailable/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. BigMicButton — disabled states
// ─────────────────────────────────────────────────────────────────────────

describe('BigMicButton', () => {
  it('is not interactive when model is not ready (unloaded)', () => {
    const onToggle = vi.fn();
    render(
      <BigMicButton
        sessionStatus="idle"
        micStatus="idle"
        modelStatus="unloaded"
        modelProgress={0}
        onToggle={onToggle}
      />,
    );
    // The button should be rendered but not call onToggle when model is unloaded
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('calls onToggle when model is ready and session is idle', () => {
    const onToggle = vi.fn();
    render(
      <BigMicButton
        sessionStatus="idle"
        micStatus="idle"
        modelStatus="ready"
        modelProgress={100}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('is not interactive when model has errored', () => {
    const onToggle = vi.fn();
    render(
      <BigMicButton
        sessionStatus="error"
        micStatus="denied"
        modelStatus="error"
        modelProgress={0}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 10. SettingsSheet
// ─────────────────────────────────────────────────────────────────────────

describe('SettingsSheet', () => {
  it('does not render content visually when closed', () => {
    render(
      <SettingsSheet
        open={false}
        onClose={vi.fn()}
        hasTranscripts={true}
        onClearTranscripts={vi.fn()}
        voicePitchEnabled={false}
        onToggleVoicePitch={vi.fn()}
      />,
    );
    // Sheet is in the DOM but translated off-screen (translate-x-full)
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog).toHaveClass('translate-x-full');
  });

  it('renders content when open', () => {
    render(
      <SettingsSheet
        open={true}
        onClose={vi.fn()}
        hasTranscripts={true}
        onClearTranscripts={vi.fn()}
        voicePitchEnabled={false}
        onToggleVoicePitch={vi.fn()}
      />,
    );
    expect(screen.getByText(/Clear conversation/i)).toBeInTheDocument();
  });

  it('Clear button is disabled when there are no transcripts', () => {
    render(
      <SettingsSheet
        open={true}
        onClose={vi.fn()}
        hasTranscripts={false}
        onClearTranscripts={vi.fn()}
        voicePitchEnabled={false}
        onToggleVoicePitch={vi.fn()}
      />,
    );
    const clearBtn = screen.getByRole('button', { name: /Clear conversation/i });
    expect(clearBtn).toBeDisabled();
  });

  it('calls onClearTranscripts and onClose when Clear is clicked', () => {
    const onClear = vi.fn();
    const onClose = vi.fn();
    render(
      <SettingsSheet
        open={true}
        onClose={onClose}
        hasTranscripts={true}
        onClearTranscripts={onClear}
        voicePitchEnabled={false}
        onToggleVoicePitch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Clear conversation/i }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape key is pressed while open', () => {
    const onClose = vi.fn();
    render(
      <SettingsSheet
        open={true}
        onClose={onClose}
        hasTranscripts={false}
        onClearTranscripts={vi.fn()}
        voicePitchEnabled={false}
        onToggleVoicePitch={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 11. Direction logic — language pair selection
// ─────────────────────────────────────────────────────────────────────────

describe('Direction logic', () => {
  it('left-speaker utterance is shown in left pane and translation in right pane', () => {
    const leftUtterance = makeUtterance({
      speakerSide: 'left',
      sourceText: 'I have a headache',
      translatedText: 'Tengo dolor de cabeza',
    });

    const { rerender } = render(
      <TranscriptPane side="left" language={EN} utterances={[leftUtterance]} />,
    );
    expect(screen.getByText('I have a headache')).toBeInTheDocument();
    expect(screen.queryByText('Tengo dolor de cabeza')).not.toBeInTheDocument();

    rerender(
      <TranscriptPane side="right" language={ES} utterances={[leftUtterance]} />,
    );
    expect(screen.queryByText('I have a headache')).not.toBeInTheDocument();
    expect(screen.getByText('Tengo dolor de cabeza')).toBeInTheDocument();
  });

  it('right-speaker utterance is shown in right pane and translation in left pane', () => {
    const rightUtterance = makeUtterance({
      speakerSide: 'right',
      sourceText: 'Necesito un médico',
      translatedText: 'I need a doctor',
    });

    const { rerender } = render(
      <TranscriptPane side="right" language={ES} utterances={[rightUtterance]} />,
    );
    expect(screen.getByText('Necesito un médico')).toBeInTheDocument();

    rerender(
      <TranscriptPane side="left" language={EN} utterances={[rightUtterance]} />,
    );
    expect(screen.getByText('I need a doctor')).toBeInTheDocument();
  });
});
