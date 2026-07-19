import { useEffect, useState } from 'react';

export type StreamOrientation = 'portrait' | 'landscape' | 'square';

function orientationFromDimensions(width: number, height: number): StreamOrientation {
  const ratio = width / height;
  if (ratio > 1.1) return 'landscape';
  if (ratio < 0.9) return 'portrait';
  return 'square';
}

export function useStreamOrientation(stream: MediaStream | null): StreamOrientation {
  const [orientation, setOrientation] = useState<StreamOrientation>('landscape');

  useEffect(() => {
    if (!stream) return;

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;

    const updateFromTrack = () => {
      const { width, height } = videoTrack.getSettings();
      if (width && height) {
        setOrientation(orientationFromDimensions(width, height));
      }
    };

    updateFromTrack();

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    const updateFromVideo = () => {
      if (video.videoWidth && video.videoHeight) {
        setOrientation(orientationFromDimensions(video.videoWidth, video.videoHeight));
      }
    };

    video.addEventListener('loadedmetadata', updateFromVideo);
    video.addEventListener('resize', updateFromVideo);
    void video.play().catch(() => {});

    return () => {
      video.removeEventListener('loadedmetadata', updateFromVideo);
      video.removeEventListener('resize', updateFromVideo);
      video.srcObject = null;
    };
  }, [stream]);

  return orientation;
}
