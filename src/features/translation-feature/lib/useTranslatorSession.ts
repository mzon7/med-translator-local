import { useReducer, useCallback, useEffect, useRef } from 'react';
import type {
  TranslatorSessionState,
  TranslatorAction,
  Language,
  Utterance,
} from '../../../lib/types';
import { loadPersistedLanguages, persistLanguage } from './languages';
import {
  startAudioCapture,
  type AudioCaptureHandle,
  type AudioCaptureCallbacks,
} from './audioCapture';

// ─── Reducer ─────────────────────────────────────────────────────────────────

function reducer(
  state: TranslatorSessionState,
  action: TranslatorAction,
): TranslatorSessionState {
  switch (action.type) {
    // Language selection
    case 'SET_LANG':
      return action.payload.side === 'left'
        ? { ...state, leftLang: action.payload.lang }
        : { ...state, rightLang: action.payload.lang };

    // Model lifecycle
    case 'MODEL_LOADING':
      return {
        ...state,
        modelStatus: 'loading',
        modelProgress: action.payload?.progress ?? state.modelProgress,
        error: null,
      };
    case 'MODEL_READY':
      return { ...state, modelStatus: 'ready', modelProgress: 100, error: null };
    case 'MODEL_ERROR':
      return { ...state, modelStatus: 'error', error: action.payload };

    // Mic lifecycle
    case 'MIC_REQUEST':
      return { ...state, micStatus: 'requesting', error: null };
    case 'MIC_GRANTED':
      return { ...state, micStatus: 'granted' };
    case 'MIC_DENIED':
      return {
        ...state,
        micStatus: 'denied',
        sessionStatus: 'error',
        error: 'Microphone access was denied. Please allow microphone access and try again.',
      };

    // Session lifecycle
    case 'START_LISTENING':
      return { ...state, sessionStatus: 'listening', error: null };
    case 'STOP_LISTENING':
      return {
        ...state,
        sessionStatus: 'idle',
        micStatus: state.micStatus === 'granted' ? 'idle' : state.micStatus,
        error: null,
      };

    // Transcript management
    case 'ADD_PARTIAL_TRANSCRIPT': {
      const rest = state.utterances.filter(
        (u) => !(u.isPartial && u.speakerSide === action.payload.speakerSide),
      );
      return {
        ...state,
        sessionStatus: 'listening',
        utterances: [...rest, action.payload],
      };
    }
    case 'FINALIZE_UTTERANCE': {
      const rest = state.utterances.filter(
        (u) => !(u.isPartial && u.speakerSide === action.payload.speakerSide),
      );
      return {
        ...state,
        utterances: [...rest, { ...action.payload, isPartial: false }],
      };
    }

    // Error
    case 'SET_ERROR':
      return { ...state, sessionStatus: 'error', error: action.payload };

    default:
      return state;
  }
}

// ─── Initial state ────────────────────────────────────────────────────────────

function buildInitialState(): TranslatorSessionState {
  const { left, right } = loadPersistedLanguages();
  return {
    modelStatus: 'unloaded',
    modelProgress: 0,
    micStatus: 'idle',
    sessionStatus: 'idle',
    leftLang: left,
    rightLang: right,
    utterances: [],
    error: null,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTranslatorSession() {
  const [state, dispatch] = useReducer(reducer, undefined, buildInitialState);

  /** Active audio capture handle — null when not capturing */
  const captureRef = useRef<AudioCaptureHandle | null>(null);

  /**
   * PCM data listener.  Future pipeline stages (VAD, ASR) will replace this
   * ref with their own handler.  For now it is a no-op.
   */
  const pcmListenerRef = useRef<AudioCaptureCallbacks['onPCMData']>(() => undefined);

  // Clean up capture on unmount
  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      captureRef.current = null;
    };
  }, []);

  // ── Language ────────────────────────────────────────────────────────────────

  const setLang = useCallback((side: 'left' | 'right', lang: Language) => {
    persistLanguage(side, lang);
    dispatch({ type: 'SET_LANG', payload: { side, lang } });
  }, []);

  // ── Model lifecycle ─────────────────────────────────────────────────────────

  const modelLoading = useCallback((progress?: number) => {
    dispatch({
      type: 'MODEL_LOADING',
      payload: progress !== undefined ? { progress } : undefined,
    });
  }, []);
  const modelReady = useCallback(() => dispatch({ type: 'MODEL_READY' }), []);
  const modelError = useCallback(
    (msg: string) => dispatch({ type: 'MODEL_ERROR', payload: msg }),
    [],
  );

  // ── Mic lifecycle (exposed for external callers) ────────────────────────────

  const micRequest = useCallback(() => dispatch({ type: 'MIC_REQUEST' }), []);
  const micGranted = useCallback(() => dispatch({ type: 'MIC_GRANTED' }), []);
  const micDenied = useCallback(() => dispatch({ type: 'MIC_DENIED' }), []);

  // ── Session lifecycle ───────────────────────────────────────────────────────

  const startListening = useCallback(() => dispatch({ type: 'START_LISTENING' }), []);
  const stopListening = useCallback(() => dispatch({ type: 'STOP_LISTENING' }), []);

  // ── Transcripts ─────────────────────────────────────────────────────────────

  const addPartialTranscript = useCallback((utterance: Utterance) => {
    dispatch({ type: 'ADD_PARTIAL_TRANSCRIPT', payload: utterance });
  }, []);
  const finalizeUtterance = useCallback((utterance: Utterance) => {
    dispatch({ type: 'FINALIZE_UTTERANCE', payload: utterance });
  }, []);

  // ── Error ───────────────────────────────────────────────────────────────────

  const setError = useCallback((msg: string) => {
    dispatch({ type: 'SET_ERROR', payload: msg });
  }, []);

  // ── Internal capture start/stop ─────────────────────────────────────────────

  const _doStartCapture = useCallback(async () => {
    dispatch({ type: 'MIC_REQUEST' });
    try {
      const handle = await startAudioCapture({
        onPCMData: (samples) => {
          // Delegate to whatever pipeline stage is currently registered.
          // Step 3: no-op.  Step 4 (VAD) will replace pcmListenerRef.current.
          pcmListenerRef.current(samples);
        },
        onError: (err) => {
          dispatch({ type: 'SET_ERROR', payload: err.message });
        },
      });
      captureRef.current = handle;
      dispatch({ type: 'MIC_GRANTED' });
      dispatch({ type: 'START_LISTENING' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDenied =
        msg.toLowerCase().includes('denied') ||
        msg.toLowerCase().includes('notallowed') ||
        msg.toLowerCase().includes('permission');
      if (isDenied) {
        dispatch({ type: 'MIC_DENIED' });
      } else {
        dispatch({ type: 'SET_ERROR', payload: msg });
      }
    }
  }, []);

  const _doStopCapture = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    dispatch({ type: 'STOP_LISTENING' });
  }, []);

  // ── High-level toggle (drives BigMicButton) ─────────────────────────────────

  const toggleSession = useCallback(() => {
    const { sessionStatus, modelStatus } = state;
    if (modelStatus !== 'ready') return;
    if (sessionStatus === 'listening' || sessionStatus === 'processing') {
      _doStopCapture();
    } else if (sessionStatus === 'idle') {
      void _doStartCapture();
    }
  }, [state, _doStartCapture, _doStopCapture]);

  return {
    state,
    dispatch,
    /** Replace this ref's current value to intercept raw PCM data (used by VAD). */
    pcmListenerRef,
    // Language
    setLang,
    // Model
    modelLoading,
    modelReady,
    modelError,
    // Mic
    micRequest,
    micGranted,
    micDenied,
    // Session
    startListening,
    stopListening,
    // Transcripts
    addPartialTranscript,
    finalizeUtterance,
    // Error
    setError,
    // Convenience
    toggleSession,
  };
}
