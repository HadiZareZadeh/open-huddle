import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { createMeeting, ApiError } from '@/services/api';

export function LandingPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);

    try {
      const meeting = await createMeeting(
        requireApproval ? { requireApproval: true } : undefined,
      );
      navigate(`/meeting/${meeting.id}`, {
        state: {
          isCreator: true,
          meetingInfo: {
            id: meeting.id,
            requiresApproval: meeting.requiresApproval,
            locked: false,
            participantCount: 0,
            maxParticipants: 8,
          },
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many requests. Restart the dev server and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create meeting');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-surface-lighter px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <svg className="h-5 w-5 text-surface" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17 10.5V7c0-.55-.45-1-1-1H5c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h11c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
            </svg>
          </div>
          <span className="text-lg font-semibold">Video Call</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-16">
        <div className="w-full max-w-xl text-center animate-fade-in">
          <h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Secure video meetings,
            <br />
            <span className="text-accent">made simple</span>
          </h1>
          <p className="mb-8 text-base text-gray-400 sm:mb-10 sm:text-lg">
            Create a meeting room instantly. Share the link. Connect face-to-face with
            peer-to-peer encryption. No accounts required.
          </p>

          <div className="mx-auto mb-6 w-full max-w-sm space-y-4 rounded-2xl bg-surface-light p-4 text-left sm:mb-8 sm:p-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => setRequireApproval(e.target.checked)}
                className="h-4 w-4 rounded accent-accent"
              />
              <span className="text-sm">Require host approval to join</span>
            </label>
          </div>

          {error && (
            <p className="mb-4 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <Button onClick={handleCreate} disabled={loading} className="w-full px-8 py-4 text-base sm:w-auto sm:text-lg">
            {loading ? 'Creating...' : 'Create Meeting'}
          </Button>
        </div>

        <div className="mt-12 grid w-full max-w-3xl gap-4 sm:mt-20 sm:grid-cols-3 sm:gap-6">
          {[
            {
              title: 'No sign-up',
              desc: 'Start instantly with a unique meeting link.',
            },
            {
              title: 'Peer-to-peer',
              desc: 'Video flows directly between participants.',
            },
            {
              title: 'Private',
              desc: 'Optional host approval and room locking.',
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl bg-surface-light p-5 text-center"
            >
              <h3 className="mb-2 font-medium text-accent">{feature.title}</h3>
              <p className="text-sm text-gray-400">{feature.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
