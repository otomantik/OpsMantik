// Partition maintenance: calls create_next_month_partitions() so next month's
// sessions_YYYY_MM and events_YYYY_MM exist. Invoke monthly (e.g. 25th) via
// external cron or pg_cron + pg_net.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * CRITICAL SECURITY GUARD (P0)
 *
 * This function executes service-role RPCs and MUST NOT be publicly callable.
 * Require a shared secret via Authorization header:
 *   Authorization: Bearer <MAINTAIN_DB_SHARED_SECRET>
 * Env (preferred):
 *   - MAINTAIN_DB_SHARED_SECRET
 * Fallbacks (optional):
 *   - CRON_SECRET
 */

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aa = enc.encode(a)
  const bb = enc.encode(b)
  if (aa.length !== bb.length) return false
  let out = 0
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i]
  return out === 0
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const t = authHeader.trim()
  if (!t) return null
  if (t.toLowerCase().startsWith('bearer ')) return t.slice(7).trim() || null
  return t // allow raw token (still treated as secret)
}

function getSharedSecret(): string | null {
  return (
    Deno.env.get('MAINTAIN_DB_SHARED_SECRET') ||
    Deno.env.get('CRON_SECRET') ||
    null
  )
}

Deno.serve(async (req) => {
  // Method hardening
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          'Allow': 'POST, OPTIONS',
        },
      }
    )
  }

  // --- AUTH GUARD (MUST run before any service-role access) ---
  const secret = getSharedSecret()
  const token = extractBearerToken(req.headers.get('authorization'))
  if (!secret || !token || !timingSafeEqual(token, secret)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="maintain-db"',
        },
      }
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { error } = await supabase.rpc('create_next_month_partitions')

  if (error) {
    console.error('Partition maintenance failed:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.log('Partition maintenance success: Next month tables ready.')
  return new Response(JSON.stringify({ message: 'Success' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
