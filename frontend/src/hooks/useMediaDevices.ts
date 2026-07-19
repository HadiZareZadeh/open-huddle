import { useState, useEffect, useCallback } from 'react';
import type { MediaDevices, DeviceSelection } from '@/types';

export function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDevices>({
    cameras: [],
    microphones: [],
    speakers: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const enumerate = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        cameras: allDevices.filter((d) => d.kind === 'videoinput'),
        microphones: allDevices.filter((d) => d.kind === 'audioinput'),
        speakers: allDevices.filter((d) => d.kind === 'audiooutput'),
      });
    } catch {
      setError('Failed to enumerate devices');
    }
  }, []);

  const requestPermissions = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      stream.getTracks().forEach((t) => t.stop());
      setPermissionDenied(false);
      setError(null);
      await enumerate();
      return true;
    } catch (err) {
      const domErr = err as DOMException;
      if (domErr.name === 'NotAllowedError') {
        setPermissionDenied(true);
        setError('Camera and microphone access was denied. Please allow access in your browser settings.');
      } else if (domErr.name === 'NotFoundError') {
        setError('No camera or microphone found on this device.');
      } else {
        setError('Failed to access media devices.');
      }
      await enumerate();
      return false;
    }
  }, [enumerate]);

  useEffect(() => {
    enumerate();
    navigator.mediaDevices.addEventListener('devicechange', enumerate);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', enumerate);
    };
  }, [enumerate]);

  const getDefaultSelection = useCallback((): DeviceSelection => {
    return {
      cameraId: devices.cameras[0]?.deviceId ?? '',
      microphoneId: devices.microphones[0]?.deviceId ?? '',
      speakerId: devices.speakers[0]?.deviceId ?? '',
    };
  }, [devices]);

  return {
    devices,
    error,
    permissionDenied,
    requestPermissions,
    enumerate,
    getDefaultSelection,
    hasCamera: devices.cameras.length > 0,
    hasMicrophone: devices.microphones.length > 0,
  };
}

export function getAudioConstraints(
  deviceId: string,
  noiseSuppression: boolean,
): MediaTrackConstraints | boolean {
  if (!deviceId) return true;
  return {
    deviceId: { exact: deviceId },
    echoCancellation: true,
    noiseSuppression,
    autoGainControl: true,
  };
}

export function getVideoConstraints(deviceId: string): MediaTrackConstraints | boolean {
  if (!deviceId) return { width: { ideal: 1280 }, height: { ideal: 720 } };
  return {
    deviceId: { exact: deviceId },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
}

export async function setAudioOutput(
  element: HTMLMediaElement,
  deviceId: string,
): Promise<void> {
  if (!deviceId) return;
  const el = element as HTMLMediaElement & {
    setSinkId?: (id: string) => Promise<void>;
  };
  if (typeof el.setSinkId === 'function') {
    await el.setSinkId(deviceId);
  }
}
