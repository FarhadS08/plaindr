import { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';

interface AudioWaveformProps {
  isActive: boolean;
  className?: string;
  barCount?: number;
  color?: string;
  minHeight?: number;
  maxHeight?: number;
}

export function AudioWaveform({
  isActive,
  className = '',
  barCount = 32,
  color = 'currentColor',
  minHeight = 4,
  maxHeight = 40,
}: AudioWaveformProps) {
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(barCount).fill(minHeight));
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const startAudioAnalysis = useCallback(async () => {
    try {
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Create audio context and analyser
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      // Connect microphone to analyser
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Start animation loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      const updateLevels = () => {
        if (!analyserRef.current) return;
        
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Map frequency data to bar heights
        const levels: number[] = [];
        const step = Math.floor(dataArray.length / barCount);
        
        for (let i = 0; i < barCount; i++) {
          const index = Math.min(i * step, dataArray.length - 1);
          const value = dataArray[index];
          // Normalize to our height range
          const normalizedHeight = minHeight + (value / 255) * (maxHeight - minHeight);
          levels.push(normalizedHeight);
        }
        
        setAudioLevels(levels);
        animationFrameRef.current = requestAnimationFrame(updateLevels);
      };
      
      updateLevels();
    } catch (err) {
      console.error('Failed to start audio analysis:', err);
      // Fallback to animated placeholder
      setAudioLevels(Array(barCount).fill(minHeight));
    }
  }, [barCount, minHeight, maxHeight]);

  const stopAudioAnalysis = useCallback(() => {
    // Stop animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Stop stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    analyserRef.current = null;
    setAudioLevels(Array(barCount).fill(minHeight));
  }, [barCount, minHeight]);

  useEffect(() => {
    if (isActive) {
      startAudioAnalysis();
    } else {
      stopAudioAnalysis();
    }
    
    return () => {
      stopAudioAnalysis();
    };
  }, [isActive, startAudioAnalysis, stopAudioAnalysis]);

  return (
    <div className={`flex items-center justify-center gap-[2px] ${className}`}>
      {audioLevels.map((height, index) => (
        <motion.div
          key={index}
          className="rounded-full"
          style={{
            width: 3,
            backgroundColor: color,
            opacity: isActive ? 0.9 : 0.3,
          }}
          animate={{
            height: isActive ? height : minHeight,
          }}
          transition={{
            duration: 0.05,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
}

// Simpler version that uses CSS animations for a more stylized look
export function AudioWaveformSimple({
  isActive,
  className = '',
  barCount = 5,
}: {
  isActive: boolean;
  className?: string;
  barCount?: number;
}) {
  return (
    <div className={`flex items-center justify-center gap-1 ${className}`}>
      {Array.from({ length: barCount }).map((_, index) => (
        <motion.div
          key={index}
          className="w-1 bg-current rounded-full"
          animate={{
            height: isActive ? [8, 24, 16, 32, 12][index % 5] : 4,
            scaleY: isActive ? [1, 1.5, 0.8, 1.2, 1] : 1,
          }}
          transition={{
            duration: 0.5,
            repeat: isActive ? Infinity : 0,
            repeatType: 'reverse',
            delay: index * 0.1,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

export default AudioWaveform;
