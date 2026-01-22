-- Create user_profiles table for storing user profile data
-- Run this migration in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  usage_intent TEXT CHECK (usage_intent IN ('personal_awareness', 'professional_research', 'compliance_checks', 'curiosity', 'other')),
  usage_intent_note TEXT,
  language TEXT DEFAULT 'en',
  region TEXT,
  notifications_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
