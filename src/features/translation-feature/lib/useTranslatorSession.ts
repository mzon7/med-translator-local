import { useReducer, useCallback } from 'react';
import type {
  TranslatorSessionState,
  TranslatorAction,
  SessionState,
  ModelStatus,
  Language,
  TranscriptEntry,
} from '../../../lib/types';
import { loadPersistedLanguages, persistLanguage } from './languages';

function reducer(
  state: TranslatorSessionState,
  action: TranslatorAction,
): TranslatorSessionState {
  switch (action.type) {
    case 'SET_SESSION':
      return { ...state, session: action.payload, error: null };
    case 'SET_MODEL_STATUS':
      return {
        ...state,
        modelStatus: action.payload.status,
        modelProgress: action.payload.progress ?? state.modelProgress,
      };
    case 'SET_LEFT_LANGUAGE':
      return { ...state, leftLanguage: action.payload };
    case 'SET_RIGHT_LANGUAGE':
      return { ...state, rightLanguage: action.payload };
    case 'ADD_TRANSCRIPT': {
      // Replace partial entry from same speaker if exists, otherwise append
      const entries = state.transcripts.filter(
        (e) => !(e.isPartial && e.speaker === action.payload.speaker),
      );
      return { ...state, transcripts: [...entries, action.payload] };
    }
    case 'SET_ERROR':
      return { ...state, session: 'error', error: action.payload };
    case 'CLEAR_TRANSCRIPTS':
      return { ...state, transcripts: [] };
    default:
      return state;
  }
}

function buildInitialState(): TranslatorSessionState {
  const { left, right } = loadPersistedLanguages();
  return {
    session: 'idle',
    modelStatus: 'unloaded',
    modelProgress: 0,
    leftLanguage: left,
    rightLanguage: right,
    transcripts: [],
    error: null,
  };
}

export function useTranslatorSession() {
  const [state, dispatch] = useReducer(reducer, undefined, buildInitialState);

  const setSession = useCallback((s: SessionState) => {
    dispatch({ type: 'SET_SESSION', payload: s });
  }, []);

  const setModelStatus = useCallback((status: ModelStatus, progress?: number) => {
    dispatch({ type: 'SET_MODEL_STATUS', payload: { status, progress } });
  }, []);

  const setLeftLanguage = useCallback((lang: Language) => {
    persistLanguage('left', lang);
    dispatch({ type: 'SET_LEFT_LANGUAGE', payload: lang });
  }, []);

  const setRightLanguage = useCallback((lang: Language) => {
    persistLanguage('right', lang);
    dispatch({ type: 'SET_RIGHT_LANGUAGE', payload: lang });
  }, []);

  const addTranscript = useCallback((entry: TranscriptEntry) => {
    dispatch({ type: 'ADD_TRANSCRIPT', payload: entry });
  }, []);

  const setError = useCallback((msg: string) => {
    dispatch({ type: 'SET_ERROR', payload: msg });
  }, []);

  const clearTranscripts = useCallback(() => {
    dispatch({ type: 'CLEAR_TRANSCRIPTS' });
  }, []);

  const toggleSession = useCallback(() => {
    if (state.session === 'listening' || state.session === 'processing') {
      dispatch({ type: 'SET_SESSION', payload: 'idle' });
    } else if (state.session === 'idle') {
      dispatch({ type: 'SET_SESSION', payload: 'requestingMic' });
    }
  }, [state.session]);

  return {
    state,
    setSession,
    setModelStatus,
    setLeftLanguage,
    setRightLanguage,
    addTranscript,
    setError,
    clearTranscripts,
    toggleSession,
  };
}
