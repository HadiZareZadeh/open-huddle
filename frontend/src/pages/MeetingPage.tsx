import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ParticipantGrid } from '@/components/ParticipantGrid';
import { PreJoinPanel } from '@/components/PreJoinPanel';
import { WaitingForHostPanel } from '@/components/WaitingForHostPanel';
import { JoinRequestsPanel } from '@/components/JoinRequestsPanel';
import { LocalVideoPreview } from '@/components/LocalVideoPreview';
import { ControlBar } from '@/components/ControlBar';
import { ChatSidebar } from '@/components/ChatSidebar';
import { useMediaDevices } from '@/hooks/useMediaDevices';
import { useLocalMedia } from '@/hooks/useLocalMedia';
import { useWebRTC, type ConnectionState } from '@/hooks/useWebRTC';
import { getMeetingInfo, getMeetingUrl, copyToClipboard, ApiError } from '@/services/api';
import {
  joinMeeting,
  leaveMeeting,
  disconnectSocket,
  sendChatMessage,
  onChatMessage,
  setMeetingLocked,
  onMeetingLocked,
  onConnectionStateChange,
  onMeetingRejoin,
  onParticipantJoined,
  onParticipantLeft,
  onExistingParticipants,
  onJoinRequest,
  onJoinRequestCancelled,
  onJoinRequestResolved,
  onJoinApproved,
  onJoinDenied,
  respondToJoinRequest,
  type SocketConnectionState,
} from '@/services/socket';
import { getStoredDisplayName, setStoredDisplayName } from '@/utils/displayNameStorage';
import type {
  MeetingPhase,
  MeetingInfo,
  ChatMessage,
  DeviceSelection,
  ParticipantInfo,
  RemoteParticipant,
  JoinRequest,
  BackgroundEffect,
} from '@/types';

export function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as {
    isCreator?: boolean;
    meetingInfo?: MeetingInfo;
  } | null;

  const [phase, setPhase] = useState<MeetingPhase>('loading');
  const [meetingInfo, setMeetingInfo] = useState<MeetingInfo | null>(null);
  const [participant, setParticipant] = useState<ParticipantInfo | null>(null);
  const [deviceSelection, setDeviceSelection] = useState<DeviceSelection>({
    cameraId: '',
    microphoneId: '',
    speakerId: '',
  });
  const [displayName, setDisplayName] = useState(() => getStoredDisplayName());
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [backgroundEffect, setBackgroundEffect] = useState<BackgroundEffect>('none');
  const [joining, setJoining] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('new');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [socketState, setSocketState] = useState<SocketConnectionState>('connected');
  const [webrtcEpoch, setWebrtcEpoch] = useState(0);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const remoteContainerRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const {
    devices,
    error: deviceError,
    requestPermissions,
    getDefaultSelection,
    permissionDenied,
  } = useMediaDevices();

  const preJoinEnabled = phase === 'prejoin';
  const inCallEnabled = phase === 'incall' || phase === 'connecting';
  const mediaEnabled = preJoinEnabled || inCallEnabled || phase === 'waiting';

  const { stream: localStream, error: mediaError, blurLoading } = useLocalMedia({
    devices: deviceSelection,
    noiseSuppression,
    backgroundEffect,
    enabled: mediaEnabled,
  });

  const localStreamRef = useRef(localStream);
  localStreamRef.current = localStream;

  const handleRemoteStream = useCallback(
    (socketId: string, displayName: string, stream: MediaStream | null) => {
      setRemoteParticipants((prev) => {
        const existing = prev.find((p) => p.socketId === socketId);
        if (!stream && !existing) return prev;

        if (!stream) {
          return prev.filter((p) => p.socketId !== socketId);
        }

        if (existing) {
          return prev.map((p) =>
            p.socketId === socketId ? { ...p, stream, displayName } : p,
          );
        }

        return [...prev, { socketId, displayName, stream }];
      });
      setStatusMessage(null);
    },
    [],
  );

  const enterCall = useCallback((result: {
    participant?: ParticipantInfo;
    chatHistory?: ChatMessage[];
    pendingRequests?: JoinRequest[];
  }) => {
    setParticipant(result.participant ?? null);
    setChatMessages(result.chatHistory ?? []);
    setJoinRequests(result.pendingRequests ?? []);
    setRemoteParticipants([]);
    setPhase('connecting');
    setTimeout(() => setPhase('incall'), 500);
  }, []);

  const handlePeerLeft = useCallback((socketId: string) => {
    setRemoteParticipants((prev) => prev.filter((p) => p.socketId !== socketId));
  }, []);

  const { toggleTrack } = useWebRTC({
    meetingId: id ?? '',
    localStream,
    enabled: inCallEnabled,
    reconnectEpoch: webrtcEpoch,
    onRemoteStream: handleRemoteStream,
    onConnectionStateChange: setConnectionState,
    onPeerLeft: handlePeerLeft,
  });

  useEffect(() => {
    if (!id) {
      navigate('/');
      return;
    }

    const meetingId = id;
    let cancelled = false;

    async function loadMeeting() {
      const cached =
        locationState?.meetingInfo?.id === meetingId
          ? locationState.meetingInfo
          : null;

      try {
        const info = cached ?? (await getMeetingInfo(meetingId));
        if (cancelled) return;

        setMeetingInfo(info);
        setIsLocked(info.locked);
        setParticipantCount(info.participantCount);

        const inCall =
          phaseRef.current === 'incall' || phaseRef.current === 'connecting';

        if (!inCall && phaseRef.current !== 'waiting') {
          setPhase('prejoin');
        }
      } catch (err) {
        if (cancelled) return;

        setPhase('error');
        if (err instanceof ApiError && err.status === 429) {
          setStatusMessage('Too many requests. Wait a minute and try again, or restart the dev server.');
        } else if (cached) {
          setMeetingInfo(cached);
          setPhase('prejoin');
        } else {
          setStatusMessage('Meeting not found or server unavailable.');
        }
      }
    }

    loadMeeting();

    return () => {
      cancelled = true;
    };
  }, [id, navigate, locationState?.meetingInfo]);

  useEffect(() => {
    if (phase === 'loading' || phase === 'error' || phase === 'ended') return;

    let cancelled = false;

    async function setupDevices() {
      await requestPermissions();
      if (cancelled) return;
      setDeviceSelection(getDefaultSelection());
    }

    setupDevices();

    return () => {
      cancelled = true;
    };
  }, [phase, requestPermissions, getDefaultSelection]);

  useEffect(() => {
    if (devices.cameras.length > 0 && !deviceSelection.cameraId) {
      setDeviceSelection(getDefaultSelection());
    }
  }, [devices, deviceSelection.cameraId, getDefaultSelection]);

  useEffect(() => {
    if (phase !== 'incall' && phase !== 'connecting' && phase !== 'waiting') return;

    const unsubJoinApproved = onJoinApproved((result) => {
      setStoredDisplayName(displayName.trim());
      setJoining(false);
      setParticipantCount((count) => count + 1);
      enterCall(result);
    });

    const unsubJoinDenied = onJoinDenied(({ reason }) => {
      setJoining(false);
      setPhase('prejoin');
      setStatusMessage(reason ?? 'The host declined your request to join.');
    });

    return () => {
      unsubJoinApproved();
      unsubJoinDenied();
    };
  }, [phase, displayName, enterCall]);

  useEffect(() => {
    if (phase !== 'incall' && phase !== 'connecting') return;

    const unsubChat = onChatMessage((msg) => {
      setChatMessages((prev) => [...prev, msg]);
    });

    const unsubLock = onMeetingLocked(({ locked }) => {
      setIsLocked(locked);
    });

    const unsubSocket = onConnectionStateChange((state) => {
      setSocketState(state);
      if (state === 'reconnecting') {
        setStatusMessage('Connection lost. Reconnecting to the meeting...');
      }
    });

    const unsubRejoin = onMeetingRejoin((result) => {
      if (result.success && !result.pending) {
        setParticipant((prev) => result.participant ?? prev);
        setChatMessages(result.chatHistory ?? []);
        setJoinRequests(result.pendingRequests ?? []);
        setRemoteParticipants([]);
        setWebrtcEpoch((epoch) => epoch + 1);
        setStatusMessage(null);
        setPhase('incall');
        return;
      }

      if (result.success && result.pending) {
        setPhase('waiting');
        setStatusMessage(null);
        return;
      }

      if (result.error === 'Meeting not found') {
        setPhase('ended');
        setStatusMessage(
          'This meeting no longer exists. The server may have restarted.',
        );
        return;
      }

      setStatusMessage(result.error ?? 'Failed to rejoin the meeting.');
    });

    const unsubJoined = onParticipantJoined(({ socketId, displayName: name }) => {
      setParticipantCount((count) => count + 1);
      setRemoteParticipants((prev) => {
        if (prev.some((p) => p.socketId === socketId)) return prev;
        return [...prev, { socketId, displayName: name, stream: null }];
      });
    });

    const unsubExisting = onExistingParticipants(({ participants }) => {
      setRemoteParticipants((prev) => {
        const next = [...prev];
        participants.forEach(({ socketId, displayName: name }) => {
          if (!next.some((p) => p.socketId === socketId)) {
            next.push({ socketId, displayName: name, stream: null });
          }
        });
        return next;
      });
    });

    const unsubLeft = onParticipantLeft(() => {
      setParticipantCount((count) => Math.max(0, count - 1));
    });

    const unsubJoinRequest = onJoinRequest((request) => {
      setJoinRequests((prev) => {
        if (prev.some((item) => item.requestId === request.requestId)) return prev;
        return [...prev, request];
      });
    });

    const unsubJoinCancelled = onJoinRequestCancelled(({ requestId }) => {
      setJoinRequests((prev) => prev.filter((item) => item.requestId !== requestId));
    });

    const unsubJoinResolved = onJoinRequestResolved(({ requestId }) => {
      setJoinRequests((prev) => prev.filter((item) => item.requestId !== requestId));
    });

    return () => {
      unsubChat();
      unsubLock();
      unsubSocket();
      unsubRejoin();
      unsubJoined();
      unsubExisting();
      unsubLeft();
      unsubJoinRequest();
      unsubJoinCancelled();
      unsubJoinResolved();
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      if (!id) return;

      const currentPhase = phaseRef.current;
      if (currentPhase === 'incall' || currentPhase === 'connecting' || currentPhase === 'waiting') {
        leaveMeeting(id);
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        disconnectSocket();
      }
    };
  }, [id]);

  const handleJoin = async () => {
    if (!id) return;

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setStatusMessage('Please enter a display name.');
      return;
    }

    setJoining(true);
    setStatusMessage(null);

    const result = await joinMeeting(id, { displayName: trimmedName });

    if (!result.success) {
      setJoining(false);
      setStatusMessage(result.error ?? 'Failed to join meeting');
      return;
    }

    if (result.pending) {
      setPhase('waiting');
      setJoining(false);
      return;
    }

    setStoredDisplayName(trimmedName);
    setJoining(false);
    setParticipantCount((meetingInfo?.participantCount ?? 0) + 1);
    enterCall(result);
  };

  const handleCancelWaiting = () => {
    if (id) leaveMeeting(id);
    disconnectSocket();
    setPhase('prejoin');
    setStatusMessage(null);
  };

  const handleRespondToJoinRequest = async (requestId: string, approved: boolean) => {
    if (!id) return;
    setRespondingRequestId(requestId);
    await respondToJoinRequest(id, requestId, approved);
    setRespondingRequestId(null);
  };

  const handleToggleAudio = () => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    toggleTrack('audio', next);
  };

  const handleToggleVideo = () => {
    const next = !videoEnabled;
    setVideoEnabled(next);
    toggleTrack('video', next);
  };

  const handleToggleLock = async () => {
    if (!id) return;
    const result = await setMeetingLocked(id, !isLocked);
    if (result.success) {
      setIsLocked(result.locked ?? !isLocked);
    }
  };

  const handleCopyLink = async () => {
    if (!id) return;
    const success = await copyToClipboard(getMeetingUrl(id));
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLeave = useCallback(() => {
    if (id) leaveMeeting(id);
    localStream?.getTracks().forEach((t) => t.stop());
    disconnectSocket();
    navigate('/');
  }, [id, localStream, navigate]);

  const handleSendChat = async (text: string) => {
    if (!id) return;
    await sendChatMessage(id, text);
  };

  const toggleFullscreen = () => {
    const el = remoteContainerRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  if (phase === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
          <p className="text-gray-400">Loading meeting...</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <p className="mb-4 text-danger">{statusMessage}</p>
        <button className="btn-primary" onClick={() => navigate('/')}>
          Go Home
        </button>
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <h2 className="mb-2 text-xl font-semibold">Meeting ended</h2>
        <p className="mb-6 text-gray-400">{statusMessage}</p>
        <button className="btn-primary" onClick={() => navigate('/')}>
          Return Home
        </button>
      </div>
    );
  }

  const isInCall = phase === 'connecting' || phase === 'incall';
  const isPreJoin = phase === 'prejoin';

  return (
    <div
      className={
        isInCall
          ? 'flex h-dvh max-h-dvh flex-col overflow-hidden bg-surface'
          : isPreJoin
            ? 'flex min-h-dvh flex-col overflow-y-auto bg-surface'
            : 'flex min-h-dvh flex-col bg-surface'
      }
    >
      {phase === 'waiting' && (
        <WaitingForHostPanel
          displayName={displayName.trim()}
          onCancel={handleCancelWaiting}
        />
      )}

      {phase === 'prejoin' && (
        <PreJoinPanel
          stream={localStream}
          devices={devices}
          selection={deviceSelection}
          onSelectionChange={setDeviceSelection}
          displayName={displayName}
          onDisplayNameChange={setDisplayName}
          noiseSuppression={noiseSuppression}
          onNoiseSuppressionChange={setNoiseSuppression}
          backgroundBlur={backgroundEffect === 'blur'}
          onBackgroundBlurChange={(v) => setBackgroundEffect(v ? 'blur' : 'none')}
          onJoin={handleJoin}
          joining={joining}
          error={deviceError ?? mediaError ?? statusMessage}
          meetingLocked={meetingInfo?.locked ?? false}
          meetingFull={
            (meetingInfo?.participantCount ?? 0) >= (meetingInfo?.maxParticipants ?? 8)
          }
          maxParticipants={meetingInfo?.maxParticipants ?? 8}
          requiresApproval={meetingInfo?.requiresApproval ?? false}
          blurLoading={blurLoading}
        />
      )}

      {(phase === 'connecting' || phase === 'incall') && participant && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-surface-lighter px-3 py-2 sm:px-4">
              <div className="flex min-w-0 items-center gap-2 text-xs text-gray-400 sm:text-sm">
                <span
                  className={`h-2 w-2 rounded-full ${
                    socketState === 'connected' && connectionState === 'connected'
                      ? 'bg-success'
                      : socketState === 'reconnecting'
                        ? 'bg-accent animate-pulse'
                        : 'bg-yellow-500'
                  }`}
                />
                {socketState === 'reconnecting'
                  ? 'Reconnecting...'
                  : connectionState === 'connected'
                    ? 'Connected'
                    : 'Connecting...'}
                {isLocked && <span className="ml-2 text-yellow-400">🔒 Locked</span>}
              </div>
              <span className="shrink-0 text-xs text-gray-500 sm:text-sm">
                {participant.displayName}
                {participantCount > 0 && (
                  <span className="ml-2 text-gray-600">· {participantCount} in call</span>
                )}
              </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4">
              <div
                ref={remoteContainerRef}
                className="relative min-h-0 flex-1 overflow-hidden"
              >
                <ParticipantGrid
                  participants={remoteParticipants}
                  speakerId={deviceSelection.speakerId}
                  className="h-full w-full"
                  onTileClick={toggleFullscreen}
                />

                <div className="absolute bottom-3 right-3 z-10 sm:bottom-4 sm:right-4 lg:hidden">
                  <LocalVideoPreview stream={localStream} variant="pip" />
                </div>
              </div>

              <div className="mt-2 flex shrink-0 flex-col gap-2 landscape:max-lg:flex-row landscape:max-lg:items-end sm:flex-row sm:items-end">
                <LocalVideoPreview
                  stream={localStream}
                  variant="inline"
                  className="hidden lg:block"
                />

                <div className="min-w-0 flex-1 rounded-xl bg-surface-light p-2 sm:p-4">
                  <ControlBar
                    audioEnabled={audioEnabled}
                    videoEnabled={videoEnabled}
                    noiseSuppression={noiseSuppression}
                    backgroundBlur={backgroundEffect === 'blur'}
                    isLocked={isLocked}
                    isHost={participant.isHost}
                    chatOpen={chatOpen}
                    copied={copied}
                    onToggleAudio={handleToggleAudio}
                    onToggleVideo={handleToggleVideo}
                    onToggleNoiseSuppression={() => setNoiseSuppression((v) => !v)}
                    onToggleBackgroundBlur={() =>
                      setBackgroundEffect((v) => (v === 'blur' ? 'none' : 'blur'))
                    }
                    onToggleLock={handleToggleLock}
                    onCopyLink={handleCopyLink}
                    onToggleChat={() => setChatOpen((v) => !v)}
                    onLeave={handleLeave}
                    blurLoading={blurLoading}
                  />
                </div>
              </div>
            </div>

            {statusMessage && (
              <div className="mx-2 mb-2 shrink-0 rounded-lg bg-yellow-500/20 px-3 py-2 text-xs text-yellow-300 sm:mx-4 sm:px-4 sm:text-sm">
                {statusMessage}
              </div>
            )}

            {participant.isHost && (
              <JoinRequestsPanel
                requests={joinRequests}
                onRespond={handleRespondToJoinRequest}
                respondingId={respondingRequestId}
              />
            )}
          </div>

          <ChatSidebar
            messages={chatMessages}
            currentUser={participant.displayName}
            onSend={handleSendChat}
            isOpen={chatOpen}
            onToggle={() => setChatOpen((v) => !v)}
          />
        </div>
      )}

      {permissionDenied && phase === 'prejoin' && (
        <div className="fixed bottom-4 left-4 right-4 rounded-lg bg-danger/90 p-4 text-sm text-white sm:left-auto sm:max-w-md">
          Please allow camera and microphone access in your browser to join the meeting.
        </div>
      )}
    </div>
  );
}
