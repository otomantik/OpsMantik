export function isApplyCallActionV2SignatureMissing(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return err.code === 'PGRST202' && msg.includes('apply_call_action_v2');
}
