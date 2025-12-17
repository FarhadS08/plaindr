import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Loader2, Volume2 } from 'lucide-react';
import { VoiceAgentStatus } from '@/hooks/useVoiceAgent';
import { cn } from '@/lib/utils';

interface VoiceButtonProps {
  status: VoiceAgentStatus;
  isSessionActive: boolean;
  onClick?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<VoiceAgentStatus, { icon: React.ReactNode; label: string; color: string }> = {
  idle: { icon: <Mic className="w-8 h-8" />, label: 'Start Voice Session', color: 'from-violet-500 to-purple-600' },
  connecting: { icon: <Loader2 className="w-8 h-8 animate-spin" />, label: 'Connecting...', color: 'from-amber-500 to-orange-600' },
  connected: { icon: <Mic className="w-8 h-8" />, label: 'Ready to Listen', color: 'from-emerald-500 to-green-600' },
  speaking: { icon: <Volume2 className="w-8 h-8" />, label: 'Agent Speaking', color: 'from-blue-500 to-cyan-600' },
  listening: { icon: <Mic className="w-8 h-8" />, label: 'Listening...', color: 'from-rose-500 to-pink-600' },
  error: { icon: <MicOff className="w-8 h-8" />, label: 'Error - Try Again', color: 'from-red-500 to-red-700' },
};

const sizeConfig = {
  sm: 'w-16 h-16',
  md: 'w-24 h-24',
  lg: 'w-32 h-32',
};

export function VoiceButton({ status, isSessionActive, onClick, disabled, size = 'lg' }: VoiceButtonProps) {
  const config = statusConfig[status];

  return (
    <div className="flex flex-col items-center gap-4">
      <motion.button
        onClick={onClick}
        disabled={disabled || status === 'connecting'}
        className={cn(
          'relative rounded-full flex items-center justify-center text-white shadow-2xl transition-all duration-300',
          'focus:outline-none focus:ring-4 focus:ring-purple-400/50',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          sizeConfig[size]
        )}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        {/* Animated gradient background */}
        <motion.div
          className={cn(
            'absolute inset-0 rounded-full bg-gradient-to-br',
            config.color
          )}
          animate={{
            boxShadow: isSessionActive
              ? ['0 0 20px rgba(139, 92, 246, 0.5)', '0 0 40px rgba(139, 92, 246, 0.8)', '0 0 20px rgba(139, 92, 246, 0.5)']
              : '0 0 20px rgba(139, 92, 246, 0.3)',
          }}
          transition={{
            duration: 1.5,
            repeat: isSessionActive ? Infinity : 0,
            ease: 'easeInOut',
          }}
        />

        {/* Pulse rings when active */}
        <AnimatePresence>
          {isSessionActive && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-white/30"
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 1.5, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-white/20"
                initial={{ scale: 1, opacity: 0.3 }}
                animate={{ scale: 2, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
              />
            </>
          )}
        </AnimatePresence>

        {/* Icon */}
        <motion.div
          className="relative z-10"
          animate={status === 'listening' ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 0.5, repeat: status === 'listening' ? Infinity : 0 }}
        >
          {config.icon}
        </motion.div>
      </motion.button>

      {/* Status label */}
      <motion.p
        key={status}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-sm font-medium text-muted-foreground"
      >
        {config.label}
      </motion.p>

      {/* Session toggle hint */}
      <p className="text-xs text-muted-foreground/60">
        {isSessionActive ? 'Press to end session' : 'Press to start voice session'}
      </p>
    </div>
  );
}
