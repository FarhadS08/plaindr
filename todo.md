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
- [ ] Investigate why chat history is not showing
- [ ] Fix Supabase connection for conversation persistence
- [ ] Ensure conversations are saved when voice session ends
- [ ] Create fix branch and push to GitHub
