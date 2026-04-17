import { useEffect, useRef } from 'react';
import type { Utterance, Language } from '../../../lib/types';

interface TranscriptPaneProps {
  side: 'left' | 'right';
  language: Language;
  utterances: Utterance[];
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

export function TranscriptPane({ side, language, utterances }: TranscriptPaneProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const sideUtterances = utterances.filter((u) => u.speakerSide === side);

  // Auto-scroll on new utterances
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sideUtterances.length]);

  const isRtl = language.dir === 'rtl';

  return (
    <div className="flex flex-col h-full bg-white/[0.03] border border-white/10 rounded-2xl backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <div
          className={`w-2 h-2 rounded-full ${side === 'left' ? 'bg-[#d5d728]' : 'bg-white/40'}`}
        />
        <span className="text-xs font-medium text-white/40 uppercase tracking-widest">
          {side === 'left' ? 'Speaker 1' : 'Speaker 2'}
        </span>
        <span className="ml-auto text-xs text-white/20">{language.label}</span>
      </div>

      {/* Utterances */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
        {sideUtterances.length === 0 ? (
          <EmptyState side={side} />
        ) : (
          sideUtterances.map((utterance) => (
            <div
              key={utterance.id}
              className={[
                'space-y-1 transition-opacity duration-200',
                utterance.isPartial ? 'opacity-50' : 'opacity-100',
              ].join(' ')}
            >
              <p
                className={[
                  'text-sm leading-relaxed',
                  utterance.isPartial ? 'text-white/60 italic' : 'text-white/90',
                ].join(' ')}
              >
                {utterance.sourceText}
              </p>
              {utterance.translatedText && (
                <p className="text-xs text-[#d5d728]/70 leading-relaxed">
                  {utterance.translatedText}
                </p>
              )}
              {utterance.confidence !== undefined && !utterance.isPartial && (
                <div className="flex items-center gap-1">
                  <div className="h-px flex-1 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#d5d728]/30 rounded-full"
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
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
