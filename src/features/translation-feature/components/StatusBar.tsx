import type { SessionStatus, MicStatus, ModelStatus } from '../../../lib/types';

interface StatusBarProps {
  sessionStatus: SessionStatus;
  micStatus: MicStatus;
  modelStatus: ModelStatus;
  error: string | null;
}

export function StatusBar({ sessionStatus, micStatus, modelStatus, error }: StatusBarProps) {
  const isError =
    sessionStatus === 'error' || modelStatus === 'error' || micStatus === 'denied';
  const isListening = sessionStatus === 'listening';
  const isProcessing = sessionStatus === 'processing';
  const isRequestingMic = micStatus === 'requesting';

  const dotColor = (() => {
    if (isError) return 'bg-red-500';
    if (isListening) return 'bg-[#d5d728] animate-pulse';
    if (isProcessing) return 'bg-blue-400 animate-pulse';
    if (isRequestingMic) return 'bg-yellow-400 animate-pulse';
    return 'bg-white/20';
  })();

  const statusText = (() => {
    if (error) return error;
    if (modelStatus === 'unloaded') return 'Model not loaded — download to begin';
    if (modelStatus === 'loading') return 'Loading model…';
    if (modelStatus === 'error') return 'Model failed to load';
    if (micStatus === 'denied') return 'Microphone access denied';
    if (sessionStatus === 'unsupported') return 'This device does not support WebGPU';
    if (isRequestingMic) return 'Requesting microphone access…';
    if (isListening) return 'Listening — speak now';
    if (isProcessing) return 'Translating…';
    if (sessionStatus === 'error') return 'An error occurred';
    return 'Ready';
  })();

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
      <span className={`text-xs tracking-wide ${isError ? 'text-red-400' : 'text-white/30'}`}>
        {statusText}
      </span>
    </div>
  );
}
