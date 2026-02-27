import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Admin (Service Role) Supabase client for server/worker use.
 * Connection resilience (Sprint 3): This client uses the Supabase REST API and does not
 * hold Postgres connections. For high-frequency workers using a direct Postgres client
 * (e.g. serverless driver), use the Supabase Transaction Pooler (port 6543) to avoid
 * connection exhaustion when many QStash workers run simultaneously.
 */

// Lazy initialization to avoid build-time errors when env vars are not set
let _adminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (!_adminClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. ' +
        'Please check your .env.local file or Vercel environment variables.'
      );
    }

    _adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return _adminClient;
}

// Export as a Proxy to maintain API compatibility while enabling lazy initialization
// The client is only created when first accessed, not at module load time
export const adminClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getAdminClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
}) as SupabaseClient;
