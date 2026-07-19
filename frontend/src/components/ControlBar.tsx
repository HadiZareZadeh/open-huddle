import clsx from 'clsx';

interface ControlBarProps {
  audioEnabled: boolean;
  videoEnabled: boolean;
  noiseSuppression: boolean;
  backgroundBlur: boolean;
  isLocked: boolean;
  isHost: boolean;
  chatOpen: boolean;
  copied: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleNoiseSuppression: () => void;
  onToggleBackgroundBlur: () => void;
  onToggleLock: () => void;
  onCopyLink: () => void;
  onToggleChat: () => void;
  onLeave: () => void;
  blurLoading?: boolean;
}

function ControlIcon({
  children,
  label,
  active,
  off,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  off?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={clsx('control-btn', active && 'active', off && 'off')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function ControlBar({
  audioEnabled,
  videoEnabled,
  noiseSuppression,
  backgroundBlur,
  isLocked,
  isHost,
  chatOpen,
  copied,
  onToggleAudio,
  onToggleVideo,
  onToggleNoiseSuppression,
  onToggleBackgroundBlur,
  onToggleLock,
  onCopyLink,
  onToggleChat,
  onLeave,
  blurLoading,
}: ControlBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1 max-[380px]:gap-0.5 sm:gap-2 md:gap-3">
      <ControlIcon
        label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
        off={!audioEnabled}
        onClick={onToggleAudio}
      >
        {audioEnabled ? (
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        ) : (
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 3.01 3 1.02 0 1.96-.51 2.51-1.37l1.48 1.48C10.97 15.44 9.58 16 8 16c-2.76 0-5-2.24-5-5H1c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c1.01-.15 1.95-.52 2.77-1.05L4.27 3z" />
          </svg>
        )}
      </ControlIcon>

      <ControlIcon
        label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
        off={!videoEnabled}
        onClick={onToggleVideo}
      >
        {videoEnabled ? (
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H5c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h11c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
        ) : (
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H5c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h11c.21 0 .39-.08.55-.18L19.73 21 21 19.73 3.27 2z" />
          </svg>
        )}
      </ControlIcon>

      <ControlIcon
        label={noiseSuppression ? 'Disable noise suppression' : 'Enable noise suppression'}
        active={noiseSuppression}
        onClick={onToggleNoiseSuppression}
      >
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 3v10.55A4 4 0 1014 17.34V7h4V3h-6z" />
        </svg>
      </ControlIcon>

      <ControlIcon
        label={backgroundBlur ? 'Disable background blur' : 'Enable background blur'}
        active={backgroundBlur}
        onClick={onToggleBackgroundBlur}
        disabled={blurLoading}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      </ControlIcon>

      <ControlIcon
        label={chatOpen ? 'Hide chat' : 'Show chat'}
        active={chatOpen}
        onClick={onToggleChat}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </ControlIcon>

      <button
        className="btn-secondary text-xs sm:text-sm"
        onClick={onCopyLink}
        aria-label="Copy invite link"
      >
        {copied ? 'Copied!' : 'Copy Invite Link'}
      </button>

      {isHost && (
        <ControlIcon
          label={isLocked ? 'Unlock meeting' : 'Lock meeting'}
          active={isLocked}
          onClick={onToggleLock}
        >
          {isLocked ? (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z" />
            </svg>
          )}
        </ControlIcon>
      )}

      <button className="btn-danger" onClick={onLeave} aria-label="Leave meeting">
        Leave
      </button>
    </div>
  );
}
