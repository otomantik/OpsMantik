import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { PanelOnboarding } from '@/components/dashboard/panel-onboarding';
import { PanelFeed } from '../../components/dashboard/panel-feed';
import { logError } from '@/lib/logging/logger';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability } from '@/lib/auth/rbac';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PanelRoute() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Find user's site
  let targetSiteId: string | null = null;
  const { data: ownedSite } = await adminClient
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (ownedSite) {
    targetSiteId = ownedSite.id;
  } else {
    const { data: membership } = await adminClient
      .from('site_members')
      .select('site_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (membership) {
      targetSiteId = membership.site_id;
    }
  }

  if (!targetSiteId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-400">
        <h1 className="text-xl font-black text-white mb-2">Yetkisiz Giriş</h1>
        <p className="text-sm">Hesabınıza kayıtlı bir site bulunamadı.</p>
      </div>
    );
  }

  // Get site config
  const { data: site } = await adminClient
    .from('sites')
    .select('pipeline_stages, oci_config, default_aov, name')
    .eq('id', targetSiteId)
    .single();

  const ociConfig = (site?.oci_config as Record<string, unknown>) || {};
  const baseValue = ociConfig.base_deal_value_try || site?.default_aov;
  const pipelineStages = site?.pipeline_stages as import('@/lib/types/database').PipelineStage[] | null;
  const access = await validateSiteAccess(targetSiteId, user.id, supabase);
  const canWriteSiteConfig =
    Boolean(access.allowed && access.role && hasCapability(access.role, 'site:write')) ||
    access.role === 'operator';

  const isUniversalConfigured = pipelineStages && pipelineStages.some(s => s.id === 'g_4' || s.id === 'g_3');

  if (!baseValue || !isUniversalConfigured) {
    if (!canWriteSiteConfig) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h1 className="text-xl font-black mb-2">Kurulum Bekleniyor</h1>
            <p className="text-sm text-slate-400">
              Bu panel henüz ilk kurulumunu tamamlamamış.
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-slate-950">
        <PanelOnboarding siteId={targetSiteId} />
      </div>
    );
  }

  // Fetch via RPC
  const { fromIso, toIso } = getTodayTrtUtcRange();
  const { data: calls, error: callsError } = await adminClient.rpc('get_recent_intents_lite_v1', {
    p_site_id: targetSiteId,
    p_date_from: fromIso,
    p_date_to: toIso,
    p_limit: 50,
    p_ads_only: false
  });

  if (callsError) {
    logError('Panel RPC fetch failed', { error: callsError.message });
  }

  const processedCalls = (calls || []).filter((c: any) => {
    const s = (c.status || '').toLowerCase();
    if (s === 'confirmed' || s === 'junk' || s === 'g_trash') return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Top Bar */}
      <div className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
              <span className="text-xs font-black text-slate-200">OM</span>
            </div>
            <div>
              <div className="text-sm font-black text-white leading-tight">{site?.name || 'OpsMantik'}</div>
              <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-slate-500">Revenue Command</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Live</span>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="max-w-xl mx-auto px-4 py-6">
        <PanelFeed initialCalls={processedCalls as unknown as import('@/lib/types/hunter').HunterIntent[]} />
      </div>
    </div>
  );
}
