# AI Policy Whisperer - Project TODO

## Authentication & User Identity
- [x] Integrate Manus OAuth authentication (sign-up, sign-in, user management)
- [x] Configure authentication in environment
- [x] Implement protected routes for authenticated users

## Database & Conversation Persistence
- [x] Create Supabase schema for conversations table
- [x] Create Supabase schema for messages table
- [x] Implement tRPC routes for conversation CRUD operations
- [x] Store user ID, conversation ID, timestamps, full history

## ElevenLabs Voice Agent Integration
- [x] Install ElevenLabs Conversational AI SDK
- [x] Implement headless voice runtime (no widgets/iframes)
- [x] Configure agent ID: agent_9501kc794bqzepqvsnfc9pjk44ew
- [x] Handle session lifecycle management

## Push-to-Talk Toggle Button
- [x] Implement microphone permission request
- [x] First press: start voice session, begin streaming
- [x] Second press: stop recording, end session
- [x] Visual feedback for recording state

## Audio Handling System
- [x] Microphone capture implementation
- [x] Real-time audio streaming to ElevenLabs
- [x] Agent response playback
- [x] Clean audio stream termination

## Conversation History UI
- [x] Display past conversations with timestamps
- [x] View full conversation details
- [x] User-specific conversation filtering

## Landing Page & Design
- [x] Modern asymmetric layout
- [x] Elegant visual style with purple accent
- [x] Voice interaction showcase
- [x] Dark/light mode toggle
- [x] Mobile responsive design

## Session Lifecycle Management
- [x] Frontend-ElevenLabs-n8n connection
- [x] Agent tools integration
- [x] Error handling and recovery
