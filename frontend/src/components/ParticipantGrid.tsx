import clsx from 'clsx';
import { VideoPlayer } from '@/components/VideoPlayer';
import type { RemoteParticipant } from '@/types';

interface ParticipantGridProps {
  participants: RemoteParticipant[];
  speakerId?: string;
  className?: string;
  onTileClick?: () => void;
}

function gridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1 grid-rows-1';
  if (count === 2) return 'grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1';
  if (count <= 4) return 'grid-cols-2 grid-rows-2';
  if (count <= 6) return 'grid-cols-2 grid-rows-3 sm:grid-cols-3 sm:grid-rows-2';
  return 'grid-cols-2 grid-rows-4 sm:grid-cols-3 sm:grid-rows-3';
}

export function ParticipantGrid({
  participants,
  speakerId,
  className,
  onTileClick,
}: ParticipantGridProps) {
  if (participants.length === 0) {
    return (
      <div
        className={clsx(
          'flex h-full min-h-[200px] items-center justify-center rounded-xl bg-surface-light',
          className,
        )}
      >
        <p className="px-4 text-center text-sm text-gray-400 sm:text-base">
          Waiting for other participants...
        </p>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'grid h-full min-h-0 gap-2',
        gridClass(participants.length),
        className,
      )}
    >
      {participants.map((participant) => (
        <VideoPlayer
          key={participant.socketId}
          stream={participant.stream}
          speakerId={speakerId}
          label={participant.displayName}
          className="min-h-0"
          onClick={onTileClick}
          objectFit="cover"
        />
      ))}
    </div>
  );
}
