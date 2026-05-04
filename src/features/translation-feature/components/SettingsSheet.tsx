import { useEffect, useRef } from 'react';
import { VoicePitchToggle } from '../../voice-pitch-copy/components/VoicePitchToggle';

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  hasTranscripts: boolean;
  onClearTranscripts: () => void;
  voicePitchEnabled: boolean;
  onToggleVoicePitch: () => void;
}

export function SettingsSheet({
  open,
  onClose,
  hasTranscripts,
  onClearTranscripts,
  voicePitchEnabled,
  onToggleVoicePitch,
}: SettingsSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid the same click that opened the sheet immediately closing it
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handler);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={[
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        aria-hidden="true"
      />

      {/* Sheet panel */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className={[
          'fixed top-0 right-0 bottom-0 z-50 w-64 bg-[#0a0a0a] border-l border-white/10',
          'flex flex-col transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <span className="text-xs font-medium text-white/60 uppercase tracking-widest">
            Settings
          </span>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/60 transition-colors"
            aria-label="Close settings"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Conversation section */}
          <section className="space-y-2">
            <p className="text-[10px] text-white/25 uppercase tracking-widest font-medium">
              Conversation
            </p>
            <button
              onClick={() => {
                onClearTranscripts();
                onClose();
              }}
              disabled={!hasTranscripts}
              className={[
                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs',
                'border transition-all duration-150',
                hasTranscripts
                  ? 'border-red-500/30 text-red-400 hover:bg-red-500/10 active:scale-[0.98]'
                  : 'border-white/5 text-white/20 cursor-not-allowed',
              ].join(' ')}
            >
              <svg
                className="w-3.5 h-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Clear conversation
            </button>
            <p className="text-[10px] text-white/20 leading-relaxed">
              Removes all transcripts from this session. Nothing is stored on a server.
            </p>
          </section>

          {/* Audio output section */}
          <section className="space-y-3">
            <p className="text-[10px] text-white/25 uppercase tracking-widest font-medium">
              Audio Output
            </p>
            <VoicePitchToggle
              enabled={voicePitchEnabled}
              onToggle={onToggleVoicePitch}
            />
            <p className="text-[10px] text-white/20 leading-relaxed">
              Uses the browser's built-in speech synthesis. Pitch is automatically
              calibrated from each speaker's voice and applied to TTS output.
            </p>
          </section>

          {/* Privacy note */}
          <section className="space-y-2">
            <p className="text-[10px] text-white/25 uppercase tracking-widest font-medium">
              Privacy
            </p>
            <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <svg
                  className="w-3 h-3 text-[#10b981]/60 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                  />
                </svg>
                <span className="text-[10px] text-white/40 font-medium">On-device only</span>
              </div>
              <p className="text-[10px] text-white/20 leading-relaxed">
                All speech processing runs locally in your browser. No audio or text is
                ever sent to a server.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
