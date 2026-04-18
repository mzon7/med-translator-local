/**
 * usePitchCopy — React hook for Voice Pitch Copy UI state.
 *
 * Exposes the feature's enabled/toggle state so components (e.g. SettingsSheet)
 * can render and control the toggle without touching module internals directly.
 */

import { useState, useCallback } from 'react';
import { isVoicePitchEnabled, setVoicePitchEnabled, cancelSpeech } from './voiceSynth';

export function usePitchCopy() {
  const [enabled, setEnabled] = useState(() => isVoicePitchEnabled());

  const toggle = useCallback(() => {
    const next = !enabled;
    setVoicePitchEnabled(next);
    setEnabled(next);
    if (!next) cancelSpeech();
  }, [enabled]);

  return { enabled, toggle };
}
