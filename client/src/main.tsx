import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";
import { ClerkAuthProvider } from "./contexts/ClerkContext";

const queryClient = new QueryClient();

const handleUnauthorizedError = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  console.error("[API Error]", error.message);
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    handleUnauthorizedError(event.query.state.error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    handleUnauthorizedError(event.mutation.state.error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async fetch(input, init) {
        // Attach the Supabase access token on every call so the
        // server can verify and RLS can scope to this user.
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const headers = new Headers(init?.headers ?? {});
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return globalThis.fetch(input, {
          ...(init ?? {}),
          headers,
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <ClerkAuthProvider>
        <App />
      </ClerkAuthProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
