// Environment configuration — Supabase Auth + Supabase DB only.

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // Supabase (auth + database)
  supabaseUrl: process.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY ?? "",
  // Built-in APIs (for LLM, storage, etc.)
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
