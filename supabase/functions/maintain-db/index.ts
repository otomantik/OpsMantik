// Partition maintenance: calls create_next_month_partitions() so next month's
// sessions_YYYY_MM and events_YYYY_MM exist. Invoke monthly (e.g. 25th) via
// external cron or pg_cron + pg_net.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Deno.serve handler signature requires request param
Deno.serve(async (req) => {
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
