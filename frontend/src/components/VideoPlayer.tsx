import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { setAudioOutput } from '@/hooks/useMediaDevices';

interface VideoPlayerProps {
  stream: MediaStream | null;
  muted?: boolean;
  mirror?: boolean;
  label?: string;
  className?: string;
  speakerId?: string;
  onClick?: () => void;
  objectFit?: 'cover' | 'contain';
}

export function VideoPlayer({
  stream,
  muted = false,
  mirror = false,
  label,
  className,
  speakerId,
  onClick,
  objectFit = 'cover',
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
    } else {
      video.srcObject = null;
    }
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && speakerId && !muted) {
      setAudioOutput(video, speakerId).catch(() => {});
    }
  }, [speakerId, muted, stream]);

  return (
    <div
      className={clsx(
        'relative min-h-0 max-h-full max-w-full overflow-hidden rounded-xl bg-black',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
    >
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={clsx(
            'h-full w-full',
            objectFit === 'cover' ? 'object-cover' : 'object-contain',
            mirror && 'scale-x-[-1]',
          )}
        />
      ) : (
        <div className="flex h-full min-h-[120px] items-center justify-center bg-surface-light">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-lighter">
            <svg className="h-8 w-8 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
        </div>
      )}
      {label && (
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {label}
        </span>
      )}
    </div>
  );
}
