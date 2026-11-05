import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { queryClient } from '../src/lib/queryClient.ts'
import { focusManager } from '@tanstack/react-query'

describe('Foreground Query Freshness Architecture', () => {
  it('configures queryClient defaultOptions with thoughtful staleTime, gcTime, and refetchOnWindowFocus', () => {
    const defaultOptions = queryClient.getDefaultOptions()
    assert.equal(
      defaultOptions.queries?.refetchOnWindowFocus,
      true,
      'refetchOnWindowFocus must be true for foreground freshness'
    )
    assert.equal(
      defaultOptions.queries?.staleTime,
      30_000,
      'staleTime must be 30 seconds to suppress redundant churn during quick app switching'
    )
    assert.equal(
      defaultOptions.queries?.gcTime,
      5 * 60 * 1000,
      'gcTime must be 5 minutes for memory cache eviction'
    )
    assert.equal(
      defaultOptions.queries?.refetchOnReconnect,
      'always',
      'refetchOnReconnect must revalidate upon network recovery'
    )
  })

  it('verifies focusManager setFocused synchronizes state for native app resume lifecycle', () => {
    focusManager.setFocused(false)
    assert.equal(focusManager.isFocused(), false)

    focusManager.setFocused(true)
    assert.equal(focusManager.isFocused(), true)
  })

  it('distinguishes between fresh and stale queries under the 30s stale window', () => {
    const key = ['freshness-test-sample']
    queryClient.setQueryData(key, { value: 100 }, { updatedAt: Date.now() })

    const query = queryClient.getQueryCache().find({ queryKey: key })
    assert.ok(query)
    const staleTime = query.options.staleTime ?? 30_000
    // Query is newly set -> isStaleByTime must be false (suppressing refetch on rapid app switch)
    assert.equal(query.isStaleByTime(staleTime), false, 'Recently updated data (< 30s) must remain fresh')

    // Data set 35 seconds ago -> isStaleByTime must be true (triggers revalidation on foreground return)
    queryClient.setQueryData(key, { value: 100 }, { updatedAt: Date.now() - 35_000 })
    assert.equal(query.isStaleByTime(staleTime), true, 'Data older than 30s staleTime must be marked stale for foreground revalidation')

    queryClient.removeQueries({ queryKey: key })
  })
})
