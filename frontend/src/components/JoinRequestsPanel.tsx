import { Button } from '@/components/Button';
import type { JoinRequest } from '@/types';

interface JoinRequestsPanelProps {
  requests: JoinRequest[];
  onRespond: (requestId: string, approved: boolean) => void;
  respondingId: string | null;
}

export function JoinRequestsPanel({
  requests,
  onRespond,
  respondingId,
}: JoinRequestsPanelProps) {
  if (requests.length === 0) return null;

  return (
    <div className="mx-2 mb-2 shrink-0 rounded-xl border border-accent/30 bg-accent/10 p-3 sm:mx-4 sm:p-4">
      <h3 className="mb-3 text-sm font-medium text-accent">
        Join requests ({requests.length})
      </h3>
      <div className="space-y-2">
        {requests.map((request) => (
          <div
            key={request.requestId}
            className="flex flex-col gap-2 rounded-lg bg-surface-light p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-medium text-white">{request.displayName}</p>
              <p className="text-xs text-gray-400">Wants to join the meeting</p>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 sm:flex-none"
                onClick={() => onRespond(request.requestId, true)}
                disabled={respondingId === request.requestId}
              >
                Accept
              </Button>
              <button
                type="button"
                className="btn-secondary flex-1 sm:flex-none"
                onClick={() => onRespond(request.requestId, false)}
                disabled={respondingId === request.requestId}
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
