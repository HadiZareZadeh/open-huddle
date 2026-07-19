import { useRef, useEffect, useState, useCallback } from 'react';
import type { DeviceSelection, BackgroundEffect } from '@/types';
import {
  getAudioConstraints,
  getVideoConstraints,
} from '@/hooks/useMediaDevices';
import { useBackgroundBlur } from '@/hooks/useBackgroundBlur';

interface UseLocalMediaOptions {
  devices: DeviceSelection;
  noiseSuppression: boolean;
  backgroundEffect: BackgroundEffect;
  enabled: boolean;
}

export function useLocalMedia({
  devices,
  noiseSuppression,
  backgroundEffect,
  enabled,
}: UseLocalMediaOptions) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rawVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { startBlur, stopProcessing, dispose, isLoading: blurLoading } = useBackgroundBlur();

  const stopStream = useCallback((s: MediaStream | null) => {
    s?.getTracks().forEach((t) => t.stop());
  }, []);

  const buildStream = useCallback(async () => {
    setError(null);
    stopStream(stream);

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(devices.cameraId),
        audio: getAudioConstraints(devices.microphoneId, noiseSuppression),
      });

      if (backgroundEffect === 'blur' && mediaStream.getVideoTracks().length > 0) {
        const video = document.createElement('video');
        video.srcObject = mediaStream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        rawVideoRef.current = video;

        const canvas = document.createElement('canvas');
        canvasRef.current = canvas;

        const blurredStream = await startBlur(video, canvas);
        if (blurredStream) {
          const audioTracks = mediaStream.getAudioTracks();
          audioTracks.forEach((t) => blurredStream.addTrack(t));
          setStream(blurredStream);
          return blurredStream;
        }
      } else {
        stopProcessing();
      }

      setStream(mediaStream);
      return mediaStream;
    } catch (err) {
      const domErr = err as DOMException;
      if (domErr.name === 'NotFoundError') {
        setError('Selected device not found. It may have been disconnected.');
      } else if (domErr.name === 'NotAllowedError') {
        setError('Permission to use camera/microphone was denied.');
      } else {
        setError('Failed to start media stream.');
      }
      setStream(null);
      return null;
    }
  }, [devices, noiseSuppression, backgroundEffect, stream, startBlur, stopProcessing, stopStream]);

  useEffect(() => {
    if (!enabled) {
      stopStream(stream);
      setStream(null);
      stopProcessing();
      return;
    }

    buildStream();

    return () => {
      stopStream(stream);
      stopProcessing();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, devices.cameraId, devices.microphoneId, noiseSuppression, backgroundEffect]);

  useEffect(() => {
    return () => {
      stopStream(stream);
      dispose();
    };
  }, [stream, stopStream, dispose]);

  return {
    stream,
    error,
    blurLoading,
    refresh: buildStream,
  };
}
