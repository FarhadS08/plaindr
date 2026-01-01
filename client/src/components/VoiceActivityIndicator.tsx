import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Volume2, Loader2 } from 'lucide-react';
import type { VoiceAgentStatus } from '@/hooks/useVoiceAgent';

interface VoiceActivityIndicatorProps {
  status: VoiceAgentStatus;
  className?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<VoiceAgentStatus, {
  icon: React.ReactNode;
  label: string;
  color: string;
  bgColor: string;
  pulseColor: string;
  animate: boolean;
}> = {
  idle: {
    icon: <Mic className="w-full h-full" />,
    label: 'Ready',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    pulseColor: 'bg-muted',
    animate: false,
  },
  connecting: {
    icon: <Loader2 className="w-full h-full animate-spin" />,
    label: 'Connecting...',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    pulseColor: 'bg-amber-500/30',
    animate: true,
  },
  connected: {
    icon: <Mic className="w-full h-full" />,
    label: 'Connected',
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    pulseColor: 'bg-emerald-500/30',
    animate: true,
  },
  listening: {
    icon: <Mic className="w-full h-full" />,
    label: 'Listening...',
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/10',
    pulseColor: 'bg-violet-500/30',
    animate: true,
  },
  speaking: {
    icon: <Volume2 className="w-full h-full" />,
    label: 'AI Speaking',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    pulseColor: 'bg-blue-500/30',
    animate: true,
  },
  error: {
    icon: <Mic className="w-full h-full" />,
    label: 'Error',
    color: 'text-destructive',
    bgColor: 'bg-destructive/10',
    pulseColor: 'bg-destructive/30',
    animate: false,
  },
};

const sizeConfig = {
  sm: {
    container: 'w-6 h-6',
    icon: 'w-3 h-3',
    text: 'text-xs',
    gap: 'gap-1.5',
  },
  md: {
    container: 'w-8 h-8',
    icon: 'w-4 h-4',
    text: 'text-sm',
    gap: 'gap-2',
  },
  lg: {
    container: 'w-10 h-10',
    icon: 'w-5 h-5',
    text: 'text-base',
    gap: 'gap-2.5',
  },
};

export function VoiceActivityIndicator({
  status,
  className = '',
  showLabel = true,
  size = 'md',
}: VoiceActivityIndicatorProps) {
  const config = statusConfig[status];
  const sizes = sizeConfig[size];

  return (
    <div className={`flex items-center ${sizes.gap} ${className}`}>
      <div className="relative">
        {/* Pulse animation */}
        <AnimatePresence>
          {config.animate && (
            <motion.div
              initial={{ scale: 1, opacity: 0.5 }}
              animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
              exit={{ scale: 1, opacity: 0 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              className={`absolute inset-0 rounded-full ${config.pulseColor}`}
            />
          )}
        </AnimatePresence>
        
        {/* Icon container */}
        <motion.div
          className={`relative ${sizes.container} rounded-full ${config.bgColor} flex items-center justify-center`}
          animate={{
            scale: config.animate ? [1, 1.05, 1] : 1,
          }}
          transition={{
            duration: 0.8,
            repeat: config.animate ? Infinity : 0,
            ease: 'easeInOut',
          }}
        >
          <div className={`${sizes.icon} ${config.color}`}>
            {config.icon}
          </div>
        </motion.div>
      </div>
      
      {/* Label */}
      {showLabel && (
        <AnimatePresence mode="wait">
          <motion.span
            key={status}
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 5 }}
            transition={{ duration: 0.2 }}
            className={`${sizes.text} font-medium ${config.color}`}
          >
            {config.label}
          </motion.span>
        </AnimatePresence>
      )}
    </div>
  );
}

// Compact badge version for inline use
export function VoiceActivityBadge({
  status,
  className = '',
}: {
  status: VoiceAgentStatus;
  className?: string;
}) {
  const config = statusConfig[status];
  
  if (status === 'idle') return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${config.bgColor} ${className}`}
    >
      <div className={`w-2 h-2 rounded-full ${config.color.replace('text-', 'bg-')}`}>
        {config.animate && (
          <motion.div
            className="w-full h-full rounded-full bg-current"
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        )}
      </div>
      <span className={`text-xs font-medium ${config.color}`}>
        {config.label}
      </span>
    </motion.div>
  );
}

export default VoiceActivityIndicator;
