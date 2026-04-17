import { useState, useRef, useEffect } from 'react';
import type { Language } from '../../../lib/types';
import { LANGUAGES } from '../lib/languages';

interface LanguagePickerProps {
  side: 'left' | 'right';
  value: Language;
  onChange: (lang: Language) => void;
  disabled?: boolean;
}

export function LanguagePicker({ side, value, onChange, disabled }: LanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const alignment = side === 'left' ? 'left-0' : 'right-0';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={[
          'flex items-center gap-2 px-4 py-2.5 rounded-xl',
          'bg-white/5 border border-white/10 backdrop-blur-md',
          'text-white font-medium text-sm tracking-wide',
          'transition-all duration-200',
          disabled
            ? 'opacity-40 cursor-not-allowed'
            : 'hover:bg-white/10 hover:border-[#d5d728]/40 cursor-pointer',
          open ? 'border-[#d5d728]/60 bg-white/10' : '',
        ].join(' ')}
        aria-label={`Select ${side} language`}
        aria-expanded={open}
      >
        {/* Globe icon */}
        <svg
          className="w-4 h-4 text-[#d5d728] shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span className="min-w-[80px]">{value.label}</span>
        {/* Chevron */}
        <svg
          className={`w-3.5 h-3.5 text-white/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className={[
            'absolute top-full mt-2 z-50 min-w-[160px]',
            'bg-black/90 border border-white/10 backdrop-blur-xl rounded-xl',
            'shadow-2xl shadow-black/60 overflow-hidden',
            alignment,
          ].join(' ')}
        >
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                onChange(lang);
                setOpen(false);
              }}
              className={[
                'w-full text-left px-4 py-2.5 text-sm transition-colors duration-150',
                'flex items-center gap-2',
                lang.code === value.code
                  ? 'text-[#d5d728] bg-[#d5d728]/10'
                  : 'text-white/80 hover:text-white hover:bg-white/5',
              ].join(' ')}
            >
              {lang.code === value.code && (
                <svg
                  className="w-3.5 h-3.5 text-[#d5d728] shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {lang.code !== value.code && <span className="w-3.5" />}
              {lang.label}
              {lang.dir === 'rtl' && (
                <span className="ml-auto text-[10px] text-white/30 font-mono">RTL</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
