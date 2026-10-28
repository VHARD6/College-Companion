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
      retry: 1,
    },
  },
})
