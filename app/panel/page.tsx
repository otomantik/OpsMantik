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
      <div className="flex flex-col items-center justify-center min-h-screen bg-white text-slate-500">
        <h1 className="text-xl font-black text-slate-900 mb-2">Yetkisiz Giriş</h1>
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
        <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-10 text-center space-y-4">
            <h1 className="text-2xl font-black mb-2">Kurulum Bekleniyor</h1>
            <p className="text-sm text-slate-500 font-medium">
              Bu panel henüz ilk kurulumunu tamamlamamış. Lütfen yönetici ile iletişime geçin.
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-slate-50">
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
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Top Bar (Light) */}
      <div className="border-b border-slate-100 bg-white/80 backdrop-blur-md sticky top-0 z-40 transition-all border-b border-slate-100">
        <div className="max-w-xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center shadow-lg shadow-slate-900/10">
              <span className="text-[10px] font-black text-white tracking-widest">OM</span>
            </div>
            <div>
              <div className="text-sm font-black text-slate-900 leading-none">{site?.name || 'OpsMantik'}</div>
              <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">Focus Deck</div>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-100">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[9px] font-black text-emerald-700 uppercase tracking-widest leading-none">Canlı</span>
          </div>
        </div>
      </div>

      {/* Surface */}
      <div className="max-w-xl mx-auto px-4 py-8">
        <PanelFeed initialCalls={processedCalls as unknown as import('@/lib/types/hunter').HunterIntent[]} />
      </div>
    </div>
  );
}
