import { ClerkProvider, SignedIn, SignedOut, useUser, useClerk, useAuth as useClerkAuth } from '@clerk/clerk-react';
import { createContext, useContext, ReactNode } from 'react';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!CLERK_PUBLISHABLE_KEY) {
  console.error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable');
}

interface AuthContextType {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    imageUrl: string | null;
  } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function AuthProvider({ children }: { children: ReactNode }) {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();

  const authValue: AuthContextType = {
    user: user ? {
      id: user.id,
      email: user.primaryEmailAddress?.emailAddress || null,
      name: user.fullName || user.firstName || null,
      imageUrl: user.imageUrl || null,
    } : null,
    isAuthenticated: !!isSignedIn,
    isLoading: !isLoaded,
    signOut: async () => {
      await signOut();
    },
  };

  return (
    <AuthContext.Provider value={authValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  if (!CLERK_PUBLISHABLE_KEY) {
    return <div className="min-h-screen flex items-center justify-center text-red-500">Missing Clerk Publishable Key</div>;
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <AuthProvider>
        {children}
      </AuthProvider>
    </ClerkProvider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within ClerkAuthProvider');
  }
  return context;
}

export { SignedIn, SignedOut };
