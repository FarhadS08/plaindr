import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Timer } from 'lucide-react';

interface SessionTimerProps {
  isActive: boolean;
  className?: string;
  showIcon?: boolean;
  variant?: 'default' | 'compact' | 'badge';
  onTimeUpdate?: (seconds: number) => void;
}

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function SessionTimer({
  isActive,
  className = '',
  showIcon = true,
  variant = 'default',
  onTimeUpdate,
}: SessionTimerProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isActive) {
      // Start timer
      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
      
      intervalRef.current = setInterval(() => {
        if (startTimeRef.current) {
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setElapsedSeconds(elapsed);
          onTimeUpdate?.(elapsed);
        }
      }, 1000);
    } else {
      // Stop timer
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      startTimeRef.current = null;
      setElapsedSeconds(0);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive, onTimeUpdate]);

  if (!isActive && variant !== 'badge') {
    return null;
  }

  const formattedTime = formatTime(elapsedSeconds);

  if (variant === 'compact') {
    return (
      <AnimatePresence>
        {isActive && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`flex items-center gap-1 text-xs text-muted-foreground ${className}`}
          >
            {showIcon && <Timer className="w-3 h-3" />}
            <span className="font-mono">{formattedTime}</span>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  if (variant === 'badge') {
    return (
      <AnimatePresence>
        {isActive && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 ${className}`}
          >
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <motion.div
                className="absolute inset-0 w-2 h-2 rounded-full bg-red-500"
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </div>
            <span className="text-xs font-medium text-primary font-mono">
              {formattedTime}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // Default variant
  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className={`flex items-center gap-2 ${className}`}
        >
          {showIcon && (
            <div className="relative">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <motion.div
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500"
                animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Session Duration</span>
            <span className="text-sm font-semibold font-mono text-foreground">
              {formattedTime}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Hook version for custom implementations
export function useSessionTimer(isActive: boolean) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isActive) {
      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
      
      interval = setInterval(() => {
        if (startTimeRef.current) {
          setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);
    } else {
      startTimeRef.current = null;
      setElapsedSeconds(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive]);

  return {
    elapsedSeconds,
    formattedTime: formatTime(elapsedSeconds),
    isRunning: isActive,
  };
}

export default SessionTimer;
