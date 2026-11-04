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
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000, // 5 minutes: promptly collects unused cache entries from memory
      retry: 1,
      refetchOnWindowFocus: false, // Prevents redundant background queries and RAM spikes on mobile app resume
      refetchOnReconnect: 'always',
    },
  },
})
