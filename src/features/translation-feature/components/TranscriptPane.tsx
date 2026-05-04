import { useEffect, useRef } from 'react';
import type { Utterance, Language } from '../../../lib/types';

/** Speaker attribution confidence below this value triggers the "uncertain" badge */
const LOW_CONFIDENCE_THRESHOLD = 0.55;

interface TranscriptPaneProps {
  side: 'left' | 'right';
  language: Language;
  utterances: Utterance[];
  /** Called when the user taps "Retry" on a failed utterance */
  onRetryUtterance?: (id: string) => void;
}

function EmptyState({ side }: { side: 'left' | 'right' }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20">
      <svg
        className="w-8 h-8"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"
        />
      </svg>
      <span className="text-xs tracking-wide">
        {side === 'left' ? 'Speaker 1' : 'Speaker 2'} will appear here
      </span>
    </div>
  );
}

function UncertainBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] text-yellow-400/60 uppercase tracking-widest font-medium"
      title="Speaker attribution is uncertain for this utterance"
    >
      <svg
        className="w-2.5 h-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        />
      </svg>
      Speaker uncertain
    </span>
  );
}

function TranslationLabel() {
  return (
    <span className="text-[9px] text-[#0ea5e9]/50 uppercase tracking-widest font-medium">
      Translation
    </span>
  );
}

/**
 * Determines what this pane should render for a given utterance.
 *
 * Rules:
 *   speakerSide === this side  → SOURCE bubble (the speaker's own words)
 *   speakerSide === other side → TRANSLATION bubble (their words in this pane's language)
 *   speakerSide === 'unknown'  → SOURCE bubble with uncertain badge in left pane only
 */
function getPaneRole(
  utterance: Utterance,
  side: 'left' | 'right',
): 'source' | 'translation' | 'unknown-source' | null {
  if (utterance.speakerSide === side) return 'source';
  if (utterance.speakerSide === 'unknown') {
    // Unknown falls through to left pane only
    return side === 'left' ? 'unknown-source' : null;
  }
  // Opposite speaker → show their translation in this pane
  return 'translation';
}

export function TranscriptPane({ side, language, utterances, onRetryUtterance }: TranscriptPaneProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const isRtl = language.dir === 'rtl';

  // Filter to only utterances this pane should render
  const visibleUtterances = utterances.filter(
    (u) => getPaneRole(u, side) !== null,
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleUtterances.length]);

  return (
    <div className="flex flex-col h-full bg-white/[0.03] border border-white/10 rounded-2xl backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <div
          className={`w-2 h-2 rounded-full ${side === 'left' ? 'bg-[#10b981]' : 'bg-[#0ea5e9]'}`}
        />
        <span className="text-xs font-medium text-white/40 uppercase tracking-widest">
          {side === 'left' ? 'Speaker 1' : 'Speaker 2'}
        </span>
        <span className="ml-auto text-xs text-white/20">{language.label}</span>
      </div>

      {/* Utterances */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
        {visibleUtterances.length === 0 ? (
          <EmptyState side={side} />
        ) : (
          visibleUtterances.map((utterance) => {
            const role = getPaneRole(utterance, side)!;
            const isUncertain =
              role === 'unknown-source' ||
              (utterance.confidence !== undefined &&
                utterance.confidence < LOW_CONFIDENCE_THRESHOLD &&
                !utterance.isPartial);

            if (role === 'translation') {
              // Translation bubble — show the translated text (opposite speaker's words)
              const hasText = !!utterance.translatedText;
              // If source utterance failed, show an error placeholder in the translation slot
              if (utterance.failed) {
                return (
                  <div
                    key={utterance.id}
                    className="pl-3 border-l border-red-500/20 space-y-1"
                  >
                    <TranslationLabel />
                    <p className="text-xs text-red-400/50 italic">Translation unavailable</p>
                  </div>
                );
              }
              return (
                <div
                  key={utterance.id}
                  className={[
                    'space-y-1 transition-opacity duration-200 pl-3 border-l border-[#0ea5e9]/20',
                    utterance.isPartial ? 'opacity-40' : 'opacity-100',
                  ].join(' ')}
                >
                  <TranslationLabel />
                  <p
                    className={[
                      'text-sm leading-relaxed',
                      utterance.isPartial || !hasText
                        ? 'text-white/35 italic'
                        : 'text-white/75',
                    ].join(' ')}
                  >
                    {hasText ? utterance.translatedText : '…'}
                  </p>
                </div>
              );
            }

            // Failed source utterance — show inline error + retry button
            if (utterance.failed) {
              return (
                <div
                  key={utterance.id}
                  className="space-y-1.5 border border-red-500/20 rounded-lg p-2.5 bg-red-500/5"
                >
                  {isUncertain && <UncertainBadge />}
                  <div className="flex items-start gap-2">
                    <svg
                      className="w-3.5 h-3.5 text-red-400/70 shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                      />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-red-400/80">Transcription failed</p>
                      {utterance.failedReason && (
                        <p className="text-[10px] text-red-400/40 mt-0.5 truncate">
                          {utterance.failedReason}
                        </p>
                      )}
                    </div>
                  </div>
                  {onRetryUtterance && (
                    <button
                      onClick={() => onRetryUtterance(utterance.id)}
                      className="flex items-center gap-1.5 text-[10px] text-[#10b981]/60 hover:text-[#10b981] transition-colors"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      Retry
                    </button>
                  )}
                  <p className="text-[10px] text-white/20">
                    {new Date(utterance.timestampStart).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </p>
                </div>
              );
            }

            // Source bubble (role === 'source' or 'unknown-source')
            return (
              <div
                key={utterance.id}
                className={[
                  'space-y-1 transition-opacity duration-200',
                  utterance.isPartial ? 'opacity-50' : 'opacity-100',
                ].join(' ')}
              >
                {isUncertain && <UncertainBadge />}

                <p
                  className={[
                    'text-sm leading-relaxed',
                    utterance.isPartial ? 'text-white/60 italic' : 'text-white/90',
                    isUncertain ? 'text-white/70' : '',
                  ].join(' ')}
                >
                  {utterance.sourceText}
                </p>

                {/* Speaker confidence bar (finalised, certain source utterances only) */}
                {utterance.confidence !== undefined &&
                  !utterance.isPartial &&
                  !isUncertain && (
                    <div className="flex items-center gap-1">
                      <div className="h-px flex-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#10b981]/30 rounded-full"
                          style={{ width: `${Math.round(utterance.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-white/15 font-mono">
                        {Math.round(utterance.confidence * 100)}%
                      </span>
                    </div>
                  )}

                <p className="text-[10px] text-white/20">
                  {new Date(utterance.timestampStart).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </p>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
