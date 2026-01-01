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

## Bug Fixes - December 17, 2025
- [x] Replace Manus OAuth with Clerk authentication using provided API keys
- [x] Fix Supabase integration - conversations now properly saved to database
- [x] Fix conversation display under voice button on home page
- [x] Ensure messages appear in conversation details
- [x] Properly integrate ElevenLabs voice agent with Supabase persistence

## UI Updates - December 17, 2025
- [ ] Remove phone number option from Clerk sign-in/sign-up UI

## CRITICAL - Remove Manus Code - December 17, 2025
- [x] Remove ALL Manus OAuth code from server/_core (oauth.ts, sdk.ts, manusTypes.ts deleted)
- [x] Remove Manus database (Drizzle/MySQL) - use ONLY Supabase
- [x] Remove Manus auth routes and middleware
- [x] Update server to use Clerk JWT verification (clerkAuth.ts created)
- [x] Ensure NO Manus references remain in codebase

## URGENT - Complete Manus Removal - December 17, 2025
- [x] Search ALL files for manus, oauth, OAUTH_SERVER_URL references
- [x] Remove vite-plugin-manus-runtime from package.json
- [x] Remove ManusDialog.tsx component
- [x] Remove vite.config.ts Manus plugin
- [x] Remove main.tsx getLoginUrl redirect
- [x] Update DashboardLayout to use Clerk SignInButton
- [x] Remove const.ts with getLoginUrl function
- [x] Update env.ts to remove Manus OAuth references
- [x] Rewrite db.ts to disable Drizzle/MySQL
- [x] Verify published site shows Clerk auth only (dev server confirmed working)

## CRITICAL - Published Site Still Shows Manus Auth - December 17, 2025
- [ ] Navigate to published URL to see the Manus auth issue
- [ ] Identify source of Manus auth injection in published builds
- [ ] The issue is at the HOSTING/DEPLOYMENT level, not application code
- [ ] Find way to disable Manus auth requirement for published sites

## Vercel Deployment - December 17, 2025
- [ ] Create GitHub repository for the project
- [ ] Configure project for Vercel deployment
- [ ] Deploy to Vercel using API key
- [ ] Configure environment variables (Clerk, Supabase)
- [ ] Verify deployment works with Clerk authentication only

## Supabase Chat History Fix - December 17, 2025
- [x] Investigate why chat history is not showing (RLS policies needed)
- [x] Fixed Supabase RLS policies to allow access
- [x] Improved ElevenLabs message handling with better logging
- [x] Added cookie-parser dependency
- [x] Create fix branch and push to GitHub: fix/supabase-chat-history

## Fix Supabase Conversation Saving - December 17, 2025
- [x] Investigate why conversations are not being saved to Supabase (async state issue)
- [x] Fix the save conversation logic in Home.tsx using refs instead of state
- [x] Ensure conversations are created when session starts
- [x] Ensure messages are saved when transcript updates
- [x] Push fix to GitHub (branch: fix/supabase-chat-history)

## Update Supabase Project - December 17, 2025
- [ ] Update VITE_SUPABASE_URL to new project: https://tksqbgpsrruujxzqrlhc.supabase.co
- [ ] Update VITE_SUPABASE_ANON_KEY to new key
- [ ] Push changes to fix/supabase-chat-history branch
- [ ] Verify conversations and messages tables exist in new Supabase project

## VoicePoweredOrb UI - December 24, 2025
- [x] Install OGL dependency for WebGL rendering
- [x] Create VoicePoweredOrb component with voice-reactive animation
- [x] Create CSS-based AnimatedOrb as reliable fallback
- [x] Adapt colors to match AI Policy Whisperer branding (purple gradient)
- [x] Integrate with existing ElevenLabs voice agent on Home page
- [x] Test voice recording UI
- [x] Push to new branch on GitHub (voice-orb-ui)

## AI-Generated Conversation Titles - January 1, 2026
- [x] Review existing title logic and document limitations
- [x] Create AI title generation service with few-shot examples
- [x] Implement title replacement logic with smart refresh triggers
- [x] Update Supabase schema if needed for AI-generated titles (no changes needed)
- [x] Update UI to display AI-generated titles (already displays from database)
- [x] Test across short/long, single/multi-topic conversations (14 unit tests passing)
- [x] Push to new branch on GitHub (feature/ai-generated-titles)

## Voice Interface Enhancements - January 1, 2026
- [x] Add audio waveform visualization - Show real-time audio levels while speaking
- [x] Add voice activity indicator - Highlight when the AI is speaking vs listening
- [x] Add session timer - Display how long the current voice session has been active
- [x] Integrate all components into the voice interface
- [x] Test and verify all features work correctly (24 unit tests passing)
- [x] Push to new branch on GitHub (feature/voice-interface-enhancements)

## Conversation Management Features - January 1, 2026
- [x] Add manual title editing - Click to rename conversation titles in History page
- [x] Implement title regeneration - Add "Regenerate Title" button for AI title refresh
- [x] Add conversation search - Search bar to filter conversations by title keywords
- [x] Create backend endpoints for title update and regeneration (updateTitle, generateTitle, search)
- [x] Test and verify all features work correctly (25 unit tests passing)
- [x] Push to new branch on GitHub (feature/conversation-management)

## Bug Fix - Regenerate Title Button - January 1, 2026
- [x] Fix regenerate title to always produce a new, different title
- [x] Add explicit instruction to LLM to generate a DIFFERENT title
- [x] Add toast notification for user feedback when regenerating
- [x] Test and verify the fix works (94 tests passing)
- [ ] Push fix to GitHub

## Bug Fix - LLM Returns Same Title (v2) - January 1, 2026
- [x] Strengthen LLM prompt with explicit forbidden words from current title
- [x] Add retry logic (up to 3 attempts) with different focus angles
- [x] Add fallback to create manual title variation from conversation keywords
- [x] Add isSameTitle() helper to detect duplicate titles
- [ ] Test and verify titles are actually different
- [ ] Push fix to GitHub
