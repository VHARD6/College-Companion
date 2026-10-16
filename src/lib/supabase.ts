import { createClient } from '@supabase/supabase-js'

// Loaded from environment variables (e.g. .env.local)
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || ''
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || ''

export interface SupabaseConfigStatus {
  isValid: boolean
  error?: string
}

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  if (!supabaseUrl || supabaseUrl.trim() === '') {
    return {
      isValid: false,
      error: 'Supabase URL is not configured. Please set VITE_SUPABASE_URL in .env.local',
    }
  }

  if (!supabaseUrl.startsWith('https://') && !supabaseUrl.startsWith('http://')) {
    return {
      isValid: false,
      error: 'Supabase URL must start with https:// (e.g., https://<project>.supabase.co). Please check VITE_SUPABASE_URL.',
    }
  }

  if (!supabaseAnonKey || supabaseAnonKey.trim() === '') {
    return {
      isValid: false,
      error: 'Supabase publishable/anon key is missing. Please set VITE_SUPABASE_ANON_KEY in .env.local',
    }
  }

  return { isValid: true }
}

// Ensure the client has a valid fallback URL during build/init to prevent app crashes on load
const safeUrl = supabaseUrl.startsWith('http') ? supabaseUrl : 'https://placeholder.supabase.co'
const safeKey = supabaseAnonKey || 'placeholder-anon-key'

export const supabase = createClient(safeUrl, safeKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
