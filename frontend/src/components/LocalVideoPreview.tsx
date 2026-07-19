import clsx from 'clsx';
import { VideoPlayer } from '@/components/VideoPlayer';
import { useStreamOrientation } from '@/hooks/useStreamOrientation';

interface LocalVideoPreviewProps {
  stream: MediaStream | null;
  className?: string;
  variant?: 'pip' | 'inline' | 'prejoin';
}

const ORIENTATION_CLASSES = {
  portrait: {
    pip: 'aspect-[9/16] w-[min(30vw,6.5rem)] max-h-[28dvh]',
    inline: 'aspect-[9/16] h-36 w-auto max-w-[8rem] sm:h-44 sm:max-w-[9.5rem]',
    prejoin:
      'aspect-[9/16] w-full max-w-[min(100%,16rem)] max-h-[45dvh] sm:max-w-xs md:max-w-sm',
  },
  landscape: {
    pip: 'aspect-video w-[min(44vw,10rem)] max-h-[22dvh]',
    inline: 'aspect-video h-28 w-auto min-w-[9rem] sm:h-36 sm:min-w-[12rem]',
    prejoin: 'aspect-video w-full max-h-[40dvh]',
  },
  square: {
    pip: 'aspect-square w-[min(34vw,7rem)] max-h-[26dvh]',
    inline: 'aspect-square h-32 w-auto sm:h-36 sm:w-36',
    prejoin: 'aspect-square w-full max-w-md max-h-[40dvh] mx-auto',
  },
} as const;

export function LocalVideoPreview({
  stream,
  className,
  variant = 'inline',
}: LocalVideoPreviewProps) {
  const orientation = useStreamOrientation(stream);
  const sizing = ORIENTATION_CLASSES[orientation][variant];

  return (
    <VideoPlayer
      stream={stream}
      muted
      mirror
      label="You"
      className={clsx(
        'shrink-0',
        sizing,
        variant === 'pip' && 'shadow-lg ring-2 ring-black/50',
        className,
      )}
    />
  );
}
