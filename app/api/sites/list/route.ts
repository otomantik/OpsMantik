import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/auth/is-admin';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userIsAdmin = await isAdmin();
  const query = userIsAdmin ? adminClient.from('sites') : supabase.from('sites');
  const { data, error } = await query
    .select('id, name, domain, public_id')
    .order('created_at', { ascending: false });

  if (error) {
    const message = error.message || 'Failed to load sites';
    const isSchemaMismatch =
      error.code === '42703' ||
      error.code === 'PGRST116' ||
      (typeof message === 'string' && message.includes('does not exist'));

    return NextResponse.json(
      {
        error: message,
        code: isSchemaMismatch ? 'SCHEMA_MISMATCH' : 'SITES_LIST_FAILED',
      },
      { status: 500 }
    );
  }

  const filteredSites = (data || []).filter(
    (site) => site.name !== 'E2E Conversation Layer' && !(site.name?.startsWith('[SİLİNDİ]'))
  );

  return NextResponse.json({ sites: filteredSites });
}
