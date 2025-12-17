import { motion, AnimatePresence } from 'framer-motion';
import { User, Bot } from 'lucide-react';
import { TranscriptEntry } from '@/hooks/useVoiceAgent';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useEffect, useRef } from 'react';

interface TranscriptDisplayProps {
  transcript: TranscriptEntry[];
  className?: string;
}

export function TranscriptDisplay({ transcript, className }: TranscriptDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  if (transcript.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full text-muted-foreground/50', className)}>
        <p className="text-center">
          Your conversation will appear here.<br />
          <span className="text-sm">Press the microphone to start.</span>
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className={cn('h-full', className)} ref={scrollRef}>
      <div className="space-y-4 p-4">
        <AnimatePresence initial={false}>
          {transcript.map((entry, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className={cn(
                'flex gap-3',
                entry.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {entry.role === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-3',
                  entry.role === 'user'
                    ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white'
                    : 'bg-muted text-foreground'
                )}
              >
                <p className="text-sm leading-relaxed">{entry.content}</p>
                <p className={cn(
                  'text-xs mt-1',
                  entry.role === 'user' ? 'text-white/60' : 'text-muted-foreground/60'
                )}>
                  {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>

              {entry.role === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ScrollArea>
  );
}
