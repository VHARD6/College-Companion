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

    // Check calling user's role in public.profiles using admin client
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

    if (!['student', 'professor', 'admin'].includes(role)) {
      return new Response(JSON.stringify({ error: `Invalid role: ${role}. Must be student, professor, or admin.` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const cleanEmail = String(email).trim().toLowerCase()
    const cleanName = String(name).trim()
    const cleanPassword = String(password)

    if (cleanPassword.length < 6) {
      return new Response(JSON.stringify({ error: 'Password must be at least 6 characters.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Role-specific validation before account creation
    if (role === 'student' && !rollNo) {
      return new Response(JSON.stringify({ error: 'Roll number is required when creating a student account.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (role === 'professor' && !departmentId) {
      return new Response(JSON.stringify({ error: 'Department is required when creating a professor account.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Create Auth user via Admin API (email confirmed automatically)
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password: cleanPassword,
      email_confirm: true,
      user_metadata: { name: cleanName, role },
    })

    if (createError || !newUser?.user) {
      return new Response(JSON.stringify({ error: createError?.message || 'Failed to create user account.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const createdUserId = newUser.user.id

    // Helper: Compensating rollback if auxiliary record insertion fails
    const rollbackCreatedUser = async (reason: string) => {
      try {
        await adminClient.auth.admin.deleteUser(createdUserId)
      } catch (cleanupErr: any) {
        console.error(`Failed to clean up user ${createdUserId}:`, cleanupErr.message)
      }
      return new Response(JSON.stringify({ error: reason }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Ensure profile row exists in public.profiles
    const { error: pErr } = await adminClient.from('profiles').upsert({
      id: createdUserId,
      name: cleanName,
      role,
      is_active: true,
      created_at: new Date().toISOString(),
    })

    if (pErr) {
      return await rollbackCreatedUser(`Failed to create user profile: ${pErr.message}`)
    }

    // 5. Insert required role-specific records
    if (role === 'student') {
      const { error: sErr } = await adminClient.from('students').insert({
        user_id: createdUserId,
        roll_no: String(rollNo).trim(),
        class_id: classId ? Number(classId) : null,
        batch_id: batchId ? Number(batchId) : null,
      })

      if (sErr) {
        return await rollbackCreatedUser(`Failed to create student record: ${sErr.message}`)
      }
    } else if (role === 'professor') {
      const { error: profErr } = await adminClient.from('professors').insert({
        user_id: createdUserId,
        department_id: Number(departmentId),
      })

      if (profErr) {
        return await rollbackCreatedUser(`Failed to create professor record: ${profErr.message}`)
      }
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
