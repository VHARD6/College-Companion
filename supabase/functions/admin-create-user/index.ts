// Supabase Edge Function: admin-create-user
// Secure server-side user provisioning for Administrators
// Deploy with: supabase functions deploy admin-create-user

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const authHeader = req.headers.get('Authorization')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Server environment variables SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.')
    }

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Verify that caller is an authenticated Admin
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user: callingUser }, error: userError } = await userClient.auth.getUser()
    if (userError || !callingUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check calling user's role in public.profiles
    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('role, is_active')
      .eq('id', callingUser.id)
      .single()

    if (profileError || !callerProfile || callerProfile.role !== 'admin' || !callerProfile.is_active) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Only active administrators can provision user accounts.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Parse and validate payload
    const body = await req.json()
    const { name, email, password, role, rollNo, classId, batchId, departmentId } = body

    if (!name || !email || !password || !role) {
      return new Response(JSON.stringify({ error: 'Name, email, password, and role are required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const cleanEmail = String(email).trim().toLowerCase()

    // 3. Create Auth user via Admin API (email automatically confirmed)
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password: String(password),
      email_confirm: true,
      user_metadata: { name: String(name).trim(), role },
    })

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const createdUserId = newUser.user.id

    // 4. Upsert into public.profiles
    const { error: pErr } = await adminClient.from('profiles').upsert({
      id: createdUserId,
      name: String(name).trim(),
      role,
      is_active: true,
      created_at: new Date().toISOString(),
    })

    if (pErr) {
      return new Response(JSON.stringify({ error: `Profile creation failed: ${pErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Insert role-specific relation
    if (role === 'student' && rollNo && classId) {
      const { error: sErr } = await adminClient.from('students').insert({
        user_id: createdUserId,
        roll_no: String(rollNo).trim(),
        class_id: Number(classId),
        batch_id: batchId ? Number(batchId) : null,
      })
      if (sErr) console.warn('Student role insert warning:', sErr.message)
    } else if (role === 'professor' && departmentId) {
      const { error: profErr } = await adminClient.from('professors').insert({
        user_id: createdUserId,
        department_id: Number(departmentId),
      })
      if (profErr) console.warn('Professor role insert warning:', profErr.message)
    }

    return new Response(
      JSON.stringify({ success: true, user: newUser.user }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
