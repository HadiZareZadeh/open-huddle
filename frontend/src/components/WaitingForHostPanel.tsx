interface WaitingForHostPanelProps {
  displayName: string;
  onCancel: () => void;
}

export function WaitingForHostPanel({ displayName, onCancel }: WaitingForHostPanelProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-in rounded-2xl bg-surface-light p-6 text-center sm:p-8">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
        <h2 className="mb-2 text-xl font-semibold">Waiting for host</h2>
        <p className="mb-6 text-sm text-gray-400">
          Your request to join as <span className="text-white">{displayName}</span> was sent.
          The host needs to accept before you can enter the meeting.
        </p>
        <button type="button" className="btn-secondary w-full" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
