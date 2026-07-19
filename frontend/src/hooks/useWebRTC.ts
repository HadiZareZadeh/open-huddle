import { useRef, useCallback, useState, useEffect } from 'react';
import { getIceServers } from '@/services/api';
import {
  getSocket,
  sendSignal,
  onSignal,
  onParticipantJoined,
  onExistingParticipants,
  onParticipantLeft,
  sendMediaState,
} from '@/services/socket';

export type ConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

interface PeerState {
  pc: RTCPeerConnection;
  displayName: string;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

interface UseWebRTCOptions {
  meetingId: string;
  localStream: MediaStream | null;
  enabled: boolean;
  reconnectEpoch: number;
  onRemoteStream: (socketId: string, displayName: string, stream: MediaStream | null) => void;
  onPeerLeft: (socketId: string) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
}

function shouldInitiate(localId: string, remoteId: string): boolean {
  return localId < remoteId;
}

function aggregateConnectionState(peers: Map<string, PeerState>): ConnectionState {
  if (peers.size === 0) return 'new';

  const states = [...peers.values()].map((peer) => peer.pc.connectionState as ConnectionState);

  if (states.every((state) => state === 'connected')) return 'connected';
  if (states.some((state) => state === 'failed')) return 'failed';
  if (states.some((state) => state === 'disconnected')) return 'disconnected';
  if (states.some((state) => state === 'connecting' || state === 'new')) return 'connecting';
  return 'closed';
}

export function useWebRTC({
  meetingId,
  localStream,
  enabled,
  reconnectEpoch,
  onRemoteStream,
  onPeerLeft,
  onConnectionStateChange,
}: UseWebRTCOptions) {
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const peerDisplayNamesRef = useRef<Map<string, string>>(new Map());
  const localSocketIdRef = useRef<string>('');
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const [iceReady, setIceReady] = useState(false);

  useEffect(() => {
    getIceServers()
      .then(({ iceServers: servers }) => setIceServers(servers))
      .catch((err) => console.error('Failed to load ICE servers:', err))
      .finally(() => setIceReady(true));
  }, []);

  const updateAggregateState = useCallback(() => {
    onConnectionStateChange(aggregateConnectionState(peersRef.current));
  }, [onConnectionStateChange]);

  const removePeer = useCallback(
    (peerId: string) => {
      const timer = reconnectTimersRef.current.get(peerId);
      if (timer) {
        clearTimeout(timer);
        reconnectTimersRef.current.delete(peerId);
      }

      const peer = peersRef.current.get(peerId);
      if (peer) {
        peer.pc.close();
        peersRef.current.delete(peerId);
      }

      peerDisplayNamesRef.current.delete(peerId);
      onRemoteStream(peerId, '', null);
      onPeerLeft(peerId);
      updateAggregateState();
    },
    [onPeerLeft, onRemoteStream, updateAggregateState],
  );

  const createOffer = useCallback(
    async (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;

      peer.makingOffer = true;
      try {
        const offer = await peer.pc.createOffer({ iceRestart: reconnectEpoch > 0 });
        await peer.pc.setLocalDescription(offer);
        sendSignal(meetingId, { type: 'offer', sdp: peer.pc.localDescription }, peerId);
      } finally {
        peer.makingOffer = false;
      }
    },
    [meetingId, reconnectEpoch],
  );

  const createPeerConnection = useCallback(
    (peerId: string, displayName: string) => {
      if (peersRef.current.has(peerId)) {
        return peersRef.current.get(peerId)!.pc;
      }

      peerDisplayNamesRef.current.set(peerId, displayName);
      localSocketIdRef.current = getSocket().id ?? '';

      const pc = new RTCPeerConnection({ iceServers });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(
            meetingId,
            { type: 'candidate', candidate: event.candidate },
            peerId,
          );
        }
      };

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) {
          onRemoteStream(peerId, displayName, stream);
        }
      };

      pc.onconnectionstatechange = () => {
        updateAggregateState();

        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          const timer = setTimeout(() => {
            if (peersRef.current.get(peerId)?.pc.connectionState === 'failed') {
              peersRef.current.get(peerId)?.pc.restartIce();
            }
          }, 2000);
          reconnectTimersRef.current.set(peerId, timer);
        }
      };

      if (localStream) {
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      }

      peersRef.current.set(peerId, {
        pc,
        displayName,
        makingOffer: false,
        ignoreOffer: false,
      });

      updateAggregateState();
      return pc;
    },
    [iceServers, localStream, meetingId, onRemoteStream, updateAggregateState],
  );

  const connectToPeer = useCallback(
    async (peerId: string, displayName: string) => {
      if (peerId === localSocketIdRef.current) return;

      createPeerConnection(peerId, displayName);

      if (shouldInitiate(localSocketIdRef.current, peerId)) {
        await createOffer(peerId);
      }
    },
    [createOffer, createPeerConnection],
  );

  const handleSignal = useCallback(
    async (
      from: string,
      signal: {
        type: string;
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      },
    ) => {
      const displayName = peerDisplayNamesRef.current.get(from) ?? 'Guest';
      const peer = peersRef.current.get(from);
      const pc = peer?.pc ?? createPeerConnection(from, displayName);
      const peerState = peersRef.current.get(from)!;
      const isInitiator = shouldInitiate(localSocketIdRef.current, from);

      if (signal.type === 'offer' && signal.sdp) {
        const offerCollision =
          peerState.makingOffer || pc.signalingState !== 'stable';
        peerState.ignoreOffer = !isInitiator && offerCollision;

        if (peerState.ignoreOffer) return;

        await pc.setRemoteDescription(signal.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(meetingId, { type: 'answer', sdp: pc.localDescription }, from);
      } else if (signal.type === 'answer' && signal.sdp) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(signal.sdp);
        }
      } else if (signal.type === 'candidate' && signal.candidate) {
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch {
          // Ignore stale candidates
        }
      }
    },
    [createPeerConnection, meetingId],
  );

  useEffect(() => {
    if (!enabled || !iceReady) return;

    localSocketIdRef.current = getSocket().id ?? '';

    const unsubSignal = onSignal(({ from, signal }) => {
      void handleSignal(from, signal as {
        type: string;
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      });
    });

    const unsubJoined = onParticipantJoined(({ socketId, displayName }) => {
      void connectToPeer(socketId, displayName);
    });

    const unsubExisting = onExistingParticipants(({ participants }) => {
      participants.forEach(({ socketId, displayName }) => {
        void connectToPeer(socketId, displayName);
      });
    });

    const unsubLeft = onParticipantLeft(({ socketId }) => {
      removePeer(socketId);
    });

    return () => {
      unsubSignal();
      unsubJoined();
      unsubExisting();
      unsubLeft();

      reconnectTimersRef.current.forEach((timer) => clearTimeout(timer));
      reconnectTimersRef.current.clear();

      peersRef.current.forEach((peer) => peer.pc.close());
      peersRef.current.clear();
      peerDisplayNamesRef.current.clear();
    };
  }, [enabled, iceReady, reconnectEpoch, connectToPeer, handleSignal, removePeer]);

  useEffect(() => {
    if (!localStream) return;

    peersRef.current.forEach(({ pc }) => {
      const senders = pc.getSenders();
      localStream.getTracks().forEach((track) => {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
        } else {
          pc.addTrack(track, localStream);
        }
      });
    });
  }, [localStream]);

  const toggleTrack = useCallback(
    (kind: 'audio' | 'video', trackEnabled: boolean) => {
      if (!localStream) return;
      localStream
        .getTracks()
        .filter((t) => t.kind === kind)
        .forEach((t) => {
          t.enabled = trackEnabled;
        });

      const audioEnabled = localStream.getAudioTracks().some((t) => t.enabled);
      const videoEnabled = localStream.getVideoTracks().some((t) => t.enabled);
      sendMediaState(meetingId, audioEnabled, videoEnabled);
    },
    [localStream, meetingId],
  );

  return { toggleTrack };
}
