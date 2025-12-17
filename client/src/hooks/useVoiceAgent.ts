import { useState, useCallback, useRef, useEffect } from 'react';
import { Conversation } from '@elevenlabs/client';

const AGENT_ID = 'agent_9501kc794bqzepqvsnfc9pjk44ew';

export type VoiceAgentStatus = 'idle' | 'connecting' | 'connected' | 'speaking' | 'listening' | 'error';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface UseVoiceAgentReturn {
  status: VoiceAgentStatus;
  isSessionActive: boolean;
  transcript: TranscriptEntry[];
  error: string | null;
  toggleSession: () => Promise<void>;
  clearTranscript: () => void;
}

export function useVoiceAgent(onTranscriptUpdate?: (transcript: TranscriptEntry[]) => void): UseVoiceAgentReturn {
  const [status, setStatus] = useState<VoiceAgentStatus>('idle');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const conversationRef = useRef<Conversation | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);

  // Keep transcriptRef in sync
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  const addTranscriptEntry = useCallback((entry: TranscriptEntry) => {
    setTranscript(prev => {
      const newTranscript = [...prev, entry];
      onTranscriptUpdate?.(newTranscript);
      return newTranscript;
    });
  }, [onTranscriptUpdate]);

  const startSession = useCallback(async () => {
    try {
      setError(null);
      setStatus('connecting');

      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Start the ElevenLabs conversation
      const conversation = await Conversation.startSession({
        agentId: AGENT_ID,
        connectionType: 'websocket',
        onConnect: () => {
          setStatus('connected');
          setIsSessionActive(true);
        },
        onDisconnect: () => {
          setStatus('idle');
          setIsSessionActive(false);
          conversationRef.current = null;
        },
        onError: (errorMsg) => {
          console.error('ElevenLabs error:', errorMsg);
          setError(typeof errorMsg === 'string' ? errorMsg : 'Voice agent error occurred');
          setStatus('error');
        },
        onModeChange: (mode) => {
          if (mode.mode === 'speaking') {
            setStatus('speaking');
          } else if (mode.mode === 'listening') {
            setStatus('listening');
          }
        },
        onMessage: (message: unknown) => {
          // Handle different message types with type assertion
          const msg = message as Record<string, unknown>;
          
          if (msg.type === 'user_transcript') {
            const event = msg.user_transcript_event as Record<string, unknown> | undefined;
            if (event?.user_transcript) {
              addTranscriptEntry({
                role: 'user',
                content: String(event.user_transcript),
                timestamp: new Date(),
              });
            }
          } else if (msg.type === 'agent_response') {
            const event = msg.agent_response_event as Record<string, unknown> | undefined;
            if (event?.agent_response) {
              addTranscriptEntry({
                role: 'assistant',
                content: String(event.agent_response),
                timestamp: new Date(),
              });
            }
          }
        },
      });

      conversationRef.current = conversation;
    } catch (err) {
      console.error('Failed to start voice session:', err);
      setError(err instanceof Error ? err.message : 'Failed to start voice session');
      setStatus('error');
      setIsSessionActive(false);
    }
  }, [addTranscriptEntry]);

  const stopSession = useCallback(async () => {
    try {
      if (conversationRef.current) {
        await conversationRef.current.endSession();
        conversationRef.current = null;
      }
      setStatus('idle');
      setIsSessionActive(false);
    } catch (err) {
      console.error('Failed to stop voice session:', err);
      setError(err instanceof Error ? err.message : 'Failed to stop voice session');
    }
  }, []);

  const toggleSession = useCallback(async () => {
    if (isSessionActive) {
      await stopSession();
    } else {
      await startSession();
    }
  }, [isSessionActive, startSession, stopSession]);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
    transcriptRef.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (conversationRef.current) {
        conversationRef.current.endSession();
      }
    };
  }, []);

  return {
    status,
    isSessionActive,
    transcript,
    error,
    toggleSession,
    clearTranscript,
  };
}
