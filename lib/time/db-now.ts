import { adminClient } from '@/lib/supabase/admin';

export async function getDbNowIso(): Promise<string> {
  const { data, error } = await adminClient.rpc('ops_db_now_v1');
  if (error) throw error;
  if (typeof data === 'string') return new Date(data).toISOString();
  if (Array.isArray(data) && typeof data[0] === 'string') return new Date(data[0]).toISOString();
  return new Date().toISOString();
}

export function addSecondsIso(baseIso: string, seconds: number): string {
  return new Date(new Date(baseIso).getTime() + seconds * 1000).toISOString();
}
