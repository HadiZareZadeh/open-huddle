import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import type { ChatMessage } from '@/types';

interface ChatSidebarProps {
  messages: ChatMessage[];
  currentUser: string;
  onSend: (text: string) => Promise<void>;
  isOpen: boolean;
  onToggle: () => void;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ChatSidebar({
  messages,
  currentUser,
  onSend,
  isOpen,
  onToggle,
}: ChatSidebarProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;

    setSending(true);
    try {
      await onSend(text.trim());
      setText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <aside
        className={clsx(
          'flex h-full min-h-0 flex-col border-l border-surface-lighter bg-surface-light transition-all duration-300',
          isOpen
            ? 'fixed inset-y-0 right-0 z-40 h-dvh w-full max-w-sm lg:relative lg:h-auto lg:w-80'
            : 'hidden lg:flex lg:w-80',
        )}
      >
        <div className="flex items-center justify-between border-b border-surface-lighter px-4 py-3">
          <h2 className="font-medium">In-call messages</h2>
          <button
            className="rounded p-1 hover:bg-surface-lighter lg:hidden"
            onClick={onToggle}
            aria-label="Close chat"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-8">
              No messages yet. Say hello!
            </p>
          ) : (
            messages.map((msg) => {
              const isOwn = msg.sender === currentUser;
              return (
                <div
                  key={msg.id}
                  className={clsx('flex flex-col', isOwn ? 'items-end' : 'items-start')}
                >
                  <span className="mb-0.5 text-xs text-gray-400">
                    {msg.sender} · {formatTime(msg.timestamp)}
                  </span>
                  <div
                    className={clsx(
                      'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                      isOwn
                        ? 'bg-accent text-surface rounded-br-md'
                        : 'bg-surface-lighter text-white rounded-bl-md',
                    )}
                    dangerouslySetInnerHTML={{ __html: msg.text }}
                  />
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} className="border-t border-surface-lighter p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Send a message"
              className="input-field flex-1 text-sm"
              maxLength={2000}
              aria-label="Chat message"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="btn-primary px-4 py-2 text-sm"
            >
              Send
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
