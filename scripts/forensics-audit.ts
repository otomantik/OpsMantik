import { adminClient } from '../lib/supabase/admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

type QueueRow = {
  id: string;
  site_id: string;
  action: string | null;
  status: string | null;
  value_cents: number | null;
  created_at: string;
  gclid: string | null;
  error_message: string | null;
};

async function runForensics() {
  console.log('Starting OCI forensics (queue-only journal)...');

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  console.log(`Analysis window: > ${sevenDaysAgo}\n`);

  const { data: queueRows, error: queueErr } = await adminClient
    .from('offline_conversion_queue')
    .select('id, site_id, action, status, value_cents, created_at, gclid, error_message')
    .gte('created_at', sevenDaysAgo);

  if (queueErr) {
    console.error('Error fetching queue:', queueErr.message);
    return;
  }

  const rows = (queueRows ?? []) as QueueRow[];
  const statuses = rows.reduce<Record<string, number>>((acc, r) => {
    const status = r.status ?? 'UNKNOWN';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  console.log('Queue statuses (7 days):', statuses);

  const zombies = rows.filter(
    (r) =>
      r.status === 'PROCESSING' &&
      new Date(r.created_at).getTime() < Date.now() - 60 * 60 * 1000
  );
  console.log(`Zombie PROCESSING rows (>1h): ${zombies.length}`);

  const poison = rows.filter((r) => {
    const cents = r.value_cents ?? 0;
    return cents <= 0 || cents > 12000;
  });
  console.log(`Value outliers (0 or >12000 cents): ${poison.length}`);

  const { data: recent } = await adminClient
    .from('offline_conversion_queue')
    .select('id, status, created_at, error_message')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('Recent queue rows:', recent?.length ?? 0);
  for (const q of recent ?? []) {
    console.log(` - ${q.id}: ${q.status} (${q.created_at}) err=${q.error_message ?? 'none'}`);
  }

  console.log('\nForensics complete.');
}

runForensics();
