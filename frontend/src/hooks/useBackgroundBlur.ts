import { useRef, useCallback, useState } from 'react';

const BLUR_AMOUNT = 15;

type BodyPixModule = typeof import('@tensorflow-models/body-pix');
type BodyPixNet = Awaited<ReturnType<BodyPixModule['load']>>;

let bodyPixLibPromise: Promise<BodyPixModule> | null = null;

async function loadBodyPixLib(): Promise<BodyPixModule> {
  if (!bodyPixLibPromise) {
    bodyPixLibPromise = import('@tensorflow-models/body-pix').then(async (bodyPix) => {
      await import('@tensorflow/tfjs');
      return bodyPix;
    });
  }
  return bodyPixLibPromise;
}

export function useBackgroundBlur() {
  const netRef = useRef<BodyPixNet | null>(null);
  const bodyPixRef = useRef<BodyPixModule | null>(null);
  const animationRef = useRef<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const loadModel = useCallback(async () => {
    if (netRef.current) return netRef.current;
    setIsLoading(true);
    try {
      const bodyPix = await loadBodyPixLib();
      bodyPixRef.current = bodyPix;
      netRef.current = await bodyPix.load({
        architecture: 'MobileNetV1',
        outputStride: 16,
        multiplier: 0.75,
        quantBytes: 2,
      });
      return netRef.current;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const stopProcessing = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
    }
    setIsActive(false);
  }, []);

  const startBlur = useCallback(
    async (
      sourceVideo: HTMLVideoElement,
      outputCanvas: HTMLCanvasElement,
    ): Promise<MediaStream | null> => {
      stopProcessing();
      const net = await loadModel();
      const bodyPix = bodyPixRef.current!;
      const ctx = outputCanvas.getContext('2d');
      if (!ctx) return null;

      outputCanvas.width = sourceVideo.videoWidth || 640;
      outputCanvas.height = sourceVideo.videoHeight || 480;

      setIsActive(true);

      const processFrame = async () => {
        if (!netRef.current || sourceVideo.readyState < 2) {
          animationRef.current = requestAnimationFrame(processFrame);
          return;
        }

        try {
          const segmentation = await net.segmentPerson(sourceVideo, {
            flipHorizontal: false,
            internalResolution: 'medium',
            segmentationThreshold: 0.7,
          });

          ctx.save();
          ctx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);

          ctx.filter = `blur(${BLUR_AMOUNT}px)`;
          ctx.drawImage(sourceVideo, 0, 0, outputCanvas.width, outputCanvas.height);

          ctx.filter = 'none';
          const mask = bodyPix.toMask(segmentation);
          bodyPix.drawMask(outputCanvas, sourceVideo, mask, 1, 0, false);
          ctx.restore();
        } catch {
          ctx.drawImage(sourceVideo, 0, 0, outputCanvas.width, outputCanvas.height);
        }

        animationRef.current = requestAnimationFrame(processFrame);
      };

      processFrame();
      return outputCanvas.captureStream(30);
    },
    [loadModel, stopProcessing],
  );

  const dispose = useCallback(() => {
    stopProcessing();
    netRef.current = null;
    bodyPixRef.current = null;
  }, [stopProcessing]);

  return {
    startBlur,
    stopProcessing,
    dispose,
    isLoading,
    isActive,
  };
}
