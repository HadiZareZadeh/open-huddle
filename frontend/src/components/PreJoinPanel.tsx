import { DeviceSelect } from '@/components/DeviceSelect';
import { LocalVideoPreview } from '@/components/LocalVideoPreview';
import { Button } from '@/components/Button';
import type { MediaDevices, DeviceSelection } from '@/types';

interface PreJoinPanelProps {
  stream: MediaStream | null;
  devices: MediaDevices;
  selection: DeviceSelection;
  onSelectionChange: (selection: DeviceSelection) => void;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  noiseSuppression: boolean;
  onNoiseSuppressionChange: (value: boolean) => void;
  backgroundBlur: boolean;
  onBackgroundBlurChange: (value: boolean) => void;
  onJoin: () => void;
  joining: boolean;
  error: string | null;
  meetingLocked: boolean;
  meetingFull: boolean;
  maxParticipants: number;
  requiresApproval?: boolean;
  blurLoading?: boolean;
}

export function PreJoinPanel({
  stream,
  devices,
  selection,
  onSelectionChange,
  displayName,
  onDisplayNameChange,
  noiseSuppression,
  onNoiseSuppressionChange,
  backgroundBlur,
  onBackgroundBlurChange,
  onJoin,
  joining,
  error,
  meetingLocked,
  meetingFull,
  maxParticipants,
  requiresApproval,
  blurLoading,
}: PreJoinPanelProps) {
  const canJoin = !meetingLocked && !meetingFull && !joining && displayName.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-lg animate-fade-in px-4 py-6 sm:py-8">
      <h1 className="mb-4 text-center text-xl font-semibold sm:mb-6 sm:text-2xl">Ready to join?</h1>

      <div className="mb-4 flex justify-center sm:mb-6">
        <LocalVideoPreview
          stream={stream}
          variant="prejoin"
          className="shadow-lg"
        />
      </div>

      <div className="space-y-4 rounded-2xl bg-surface-light p-4 sm:p-6">
        <div className="space-y-1.5">
          <label htmlFor="display-name" className="block text-sm font-medium text-gray-300">
            Display name
          </label>
          <input
            id="display-name"
            type="text"
            className="select-field"
            value={displayName}
            onChange={(e) => onDisplayNameChange(e.target.value)}
            placeholder="Your name"
            maxLength={32}
            autoComplete="nickname"
            disabled={joining}
          />
        </div>

        <DeviceSelect
          label="Camera"
          devices={devices.cameras}
          value={selection.cameraId}
          onChange={(cameraId) => onSelectionChange({ ...selection, cameraId })}
        />

        <DeviceSelect
          label="Microphone"
          devices={devices.microphones}
          value={selection.microphoneId}
          onChange={(microphoneId) => onSelectionChange({ ...selection, microphoneId })}
        />

        <DeviceSelect
          label="Speaker"
          devices={devices.speakers}
          value={selection.speakerId}
          onChange={(speakerId) => onSelectionChange({ ...selection, speakerId })}
        />

        <div className="flex flex-col gap-3 pt-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={noiseSuppression}
              onChange={(e) => onNoiseSuppressionChange(e.target.checked)}
              className="h-4 w-4 rounded accent-accent"
            />
            <span className="text-sm text-gray-300">Noise suppression</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={backgroundBlur}
              onChange={(e) => onBackgroundBlurChange(e.target.checked)}
              disabled={blurLoading}
              className="h-4 w-4 rounded accent-accent"
            />
            <span className="text-sm text-gray-300">
              Background blur {blurLoading && '(loading model...)'}
            </span>
          </label>
        </div>

        {requiresApproval && (
          <div className="rounded-lg bg-accent/10 px-4 py-3 text-sm text-accent">
            The host must approve your request before you can join.
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-danger/20 px-4 py-3 text-sm text-danger" role="alert">
            {error}
          </div>
        )}

        {meetingLocked && (
          <div className="rounded-lg bg-yellow-500/20 px-4 py-3 text-sm text-yellow-300" role="alert">
            This meeting is locked. New participants cannot join.
          </div>
        )}

        {meetingFull && (
          <div className="rounded-lg bg-yellow-500/20 px-4 py-3 text-sm text-yellow-300" role="alert">
            This meeting is full (maximum {maxParticipants} participants).
          </div>
        )}

        <Button
          className="w-full"
          onClick={onJoin}
          disabled={!canJoin}
        >
          {joining ? 'Joining...' : 'Join Meeting'}
        </Button>
      </div>
    </div>
  );
}
