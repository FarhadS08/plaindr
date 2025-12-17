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

// Type for message events from ElevenLabs
interface ElevenLabsMessage {
  type?: string;
  source?: string;
  message?: string;
  text?: string;
  user_transcript?: string;
  agent_response?: string;
  transcript?: string;
  response?: string;
  user_transcript_event?: {
    user_transcript?: string;
  };
  agent_response_event?: {
    agent_response?: string;
  };
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
      // Call the callback with new transcript
      if (onTranscriptUpdate) {
        onTranscriptUpdate(newTranscript);
      }
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
          console.log('[ElevenLabs] Connected');
          setStatus('connected');
          setIsSessionActive(true);
        },
        onDisconnect: () => {
          console.log('[ElevenLabs] Disconnected');
          setStatus('idle');
          setIsSessionActive(false);
          conversationRef.current = null;
        },
        onError: (errorMsg) => {
          console.error('[ElevenLabs] Error:', errorMsg);
          setError(typeof errorMsg === 'string' ? errorMsg : 'Voice agent error occurred');
          setStatus('error');
        },
        onModeChange: (mode) => {
          console.log('[ElevenLabs] Mode changed:', mode);
          if (mode.mode === 'speaking') {
            setStatus('speaking');
          } else if (mode.mode === 'listening') {
            setStatus('listening');
          }
        },
        onMessage: (message: unknown) => {
          console.log('[ElevenLabs] Message received:', JSON.stringify(message));
          
          // Cast to our message type
          const msg = message as ElevenLabsMessage;
          
          // Try different message formats that ElevenLabs might use
          if (msg.type === 'user_transcript' || msg.type === 'transcript') {
            const transcriptText = msg.user_transcript_event?.user_transcript 
              || msg.user_transcript 
              || msg.transcript
              || msg.text;
            
            if (transcriptText) {
              console.log('[ElevenLabs] User said:', transcriptText);
              addTranscriptEntry({
                role: 'user',
                content: String(transcriptText),
                timestamp: new Date(),
              });
            }
          } else if (msg.type === 'agent_response' || msg.type === 'response') {
            const responseText = msg.agent_response_event?.agent_response 
              || msg.agent_response 
              || msg.response
              || msg.text;
            
            if (responseText) {
              console.log('[ElevenLabs] Agent said:', responseText);
              addTranscriptEntry({
                role: 'assistant',
                content: String(responseText),
                timestamp: new Date(),
              });
            }
          } else if (msg.source === 'user' && msg.message) {
            // Alternative format
            console.log('[ElevenLabs] User (alt):', msg.message);
            addTranscriptEntry({
              role: 'user',
              content: String(msg.message),
              timestamp: new Date(),
            });
          } else if (msg.source === 'ai' && msg.message) {
            // Alternative format
            console.log('[ElevenLabs] Agent (alt):', msg.message);
            addTranscriptEntry({
              role: 'assistant',
              content: String(msg.message),
              timestamp: new Date(),
            });
          }
        },
      });

      conversationRef.current = conversation;
    } catch (err) {
      console.error('[ElevenLabs] Failed to start voice session:', err);
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
      console.error('[ElevenLabs] Failed to stop voice session:', err);
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
