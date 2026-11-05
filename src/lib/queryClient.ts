import { QueryClient } from '@tanstack/react-query'

/**
 * Shared QueryClient singleton.
 *
 * Exported here so both App.tsx (QueryClientProvider) and
 * useAuth.ts (cache clear on sign-out) can reference the same
 * instance without creating a circular import between them.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 seconds: data remains fresh, suppressing duplicate calls during rapid app-switching
      gcTime: 5 * 60 * 1000, // 5 minutes: unused cache is cleaned up from memory
      retry: 1,
      refetchOnWindowFocus: true, // Thoughtful freshness: revalidates when foregrounded IF data is actually stale
      refetchOnReconnect: 'always', // Thoughtful resilience: revalidates when network connectivity recovers
    },
  },
})
