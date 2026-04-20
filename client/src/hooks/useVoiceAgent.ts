import { useState, useCallback, useRef, useEffect } from 'react';
import { Conversation } from '@elevenlabs/client';

// Agent ID comes from VITE_ELEVENLABS_AGENT_ID so staging and prod
// can point at different agents without a rebuild. The fallback is
// the original dev agent so local builds keep working when the env
// var isn't set.
const FALLBACK_AGENT_ID = 'agent_9501kc794bqzepqvsnfc9pjk44ew';
const AGENT_ID =
  import.meta.env.VITE_ELEVENLABS_AGENT_ID || FALLBACK_AGENT_ID;

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

export interface UseVoiceAgentOptions {
  onTranscriptUpdate?: (transcript: TranscriptEntry[]) => void;
  onSessionEnd?: (transcript: TranscriptEntry[]) => void;
  /**
   * Fires once per finalized user utterance. The ChatWorkspace uses
   * this to drive the normal text pipeline (DB persistence, streamed
   * answer, citations, Fact Grid) in parallel with the ElevenLabs
   * agent's spoken reply — one LLM call for audio, one for visuals.
   */
  onUserTranscript?: (text: string) => void;
}

export function useVoiceAgent(
  onTranscriptUpdateOrOptions?: ((transcript: TranscriptEntry[]) => void) | UseVoiceAgentOptions
): UseVoiceAgentReturn {
  // Handle both old and new API
  const options: UseVoiceAgentOptions = typeof onTranscriptUpdateOrOptions === 'function'
    ? { onTranscriptUpdate: onTranscriptUpdateOrOptions }
    : onTranscriptUpdateOrOptions || {};
  
  const { onTranscriptUpdate, onSessionEnd, onUserTranscript } = options;

  const [status, setStatus] = useState<VoiceAgentStatus>('idle');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const conversationRef = useRef<Conversation | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const onSessionEndRef = useRef(onSessionEnd);
  const onUserTranscriptRef = useRef(onUserTranscript);

  // Keep refs in sync
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    onSessionEndRef.current = onSessionEnd;
  }, [onSessionEnd]);

  useEffect(() => {
    onUserTranscriptRef.current = onUserTranscript;
  }, [onUserTranscript]);

  const addTranscriptEntry = useCallback((entry: TranscriptEntry) => {
    setTranscript(prev => {
      const newTranscript = [...prev, entry];
      if (onTranscriptUpdate) {
        onTranscriptUpdate(newTranscript);
      }
      return newTranscript;
    });
    // Finalized user utterances drive the on-screen text pipeline —
    // fire the callback once per transcript line, not per stream tick.
    if (entry.role === "user" && entry.content.trim()) {
      onUserTranscriptRef.current?.(entry.content);
    }
  }, [onTranscriptUpdate]);

  const startSession = useCallback(async () => {
    try {
      setError(null);
      setStatus('connecting');

      // Request microphone permission — classify the two common
      // failure modes so the UI can surface actionable guidance
      // instead of a generic "couldn't connect" message.
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micErr) {
        const name = (micErr as { name?: string })?.name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw new Error(
            'Microphone permission was denied. Enable it in your browser settings and try again.',
          );
        }
        if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          throw new Error(
            'No microphone detected. Plug one in or switch to text mode.',
          );
        }
        throw micErr;
      }

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
          
          // Call onSessionEnd with the final transcript
          if (onSessionEndRef.current && transcriptRef.current.length > 0) {
            console.log('[ElevenLabs] Calling onSessionEnd with', transcriptRef.current.length, 'messages');
            onSessionEndRef.current(transcriptRef.current);
          }
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
      
      // Call onSessionEnd with the final transcript (also called in onDisconnect, but this ensures it's called)
      if (onSessionEndRef.current && transcriptRef.current.length > 0) {
        console.log('[ElevenLabs] Calling onSessionEnd from stopSession with', transcriptRef.current.length, 'messages');
        onSessionEndRef.current(transcriptRef.current);
      }
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
