-- Persist RAG citations alongside assistant messages so they survive page
-- refreshes. Run this in the Supabase SQL editor.
--
-- Shape of each element in the jsonb array (matches QuerySource in
-- client/src/lib/api.ts):
--   {
--     "text": string,
--     "source_url": string,
--     "section_heading": string | null,
--     "policy_summary": string | null,
--     "relevance_score": number,
--     "company_name": string
--   }

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sources jsonb;
