// Compat shim. Historically callers reached for useAuth from this
// path; the real implementation lives in the auth context. Keep the
// re-export so any lingering imports still work.

export { useAuth } from '@/contexts/ClerkContext';
