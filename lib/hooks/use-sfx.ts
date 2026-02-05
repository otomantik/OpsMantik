/**
 * Simple SFX hook for one-shot sound effects.
 * - Caches the Audio instance in a ref
 * - Wraps play() in try/catch to handle autoplay/promise rejections
 */
'use client';

import { useCallback, useRef } from 'react';

export function useSfx(src: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(async () => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio(src);
        // Keep it subtle by default
        audioRef.current.volume = 0.7;
      }

      // Rewind to start for rapid consecutive plays
      audioRef.current.currentTime = 0;

      const p = audioRef.current.play();
      if (p && typeof (p as Promise<void>).catch === 'function') {
        await (p as Promise<void>).catch(() => {
          // Autoplay / user gesture restrictions; fail silently.
        });
      }
    } catch {
      // Fail silently; SFX must never block core UX.
    }
  }, [src]);

  return { play };
}

