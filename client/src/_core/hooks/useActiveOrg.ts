// Active organization id for the current caller, or null when in
// personal mode. Thin wrapper so component code doesn't need to
// repeat the `activeQuery.data?.id ?? null` dance — and so queries
// keyed on the scope invalidate uniformly when switching orgs.

import { trpc } from '@/lib/trpc';

export function useActiveOrgId(): string | null {
  const q = trpc.organizations.getActive.useQuery(undefined, {
    staleTime: 60_000,
  });
  return q.data?.id ?? null;
}
