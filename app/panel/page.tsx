import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { PanelOnboarding } from '@/components/dashboard/panel-onboarding';
import { PanelFeed } from '../../components/dashboard/panel-feed';
import { logError } from '@/lib/logging/logger';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PanelRoute() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Find user's site
  // Check if owner first
  let targetSiteId: string | null = null;
  const { data: ownedSite } = await adminClient
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
    
  if (ownedSite) {
    targetSiteId = ownedSite.id;
  } else {
    // Check memberships
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
      <div className="flex flex-col items-center justify-center min-h-screen text-slate-500">
        <h1 className="text-2xl font-bold text-slate-800">Yetkisiz Giriş</h1>
        <p>Hesabınıza kayıtlı bir site bulunamadı.</p>
      </div>
    );
  }

  // Get site configuration
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

  // Enforce Onboarding Gate
  const isUniversalConfigured = pipelineStages && pipelineStages.some(s => s.id === 'g_4' || s.id === 'g_3');

  if (!baseValue || !isUniversalConfigured) {
    if (!canWriteSiteConfig) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-800/70 p-6">
            <h1 className="text-xl font-black mb-2">Kurulum Bekleniyor</h1>
            <p className="text-sm text-slate-300">
              Bu panel henüz ilk kurulumunu tamamlamamış. Devam etmek için site sahibi veya admin kullanıcının panel ayarlarını kaydetmesi gerekiyor.
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-slate-900">
         <PanelOnboarding siteId={targetSiteId} />
      </div>
    );
  }

  // Fetch recent active calls (last 50) with FULL details
  const { data: calls, error: callsError } = await adminClient
    .from('calls')
    .select(`
      *,
      sessions(*)
    `)
    .eq('site_id', targetSiteId)
    .order('created_at', { ascending: false })
    .limit(50);
    
  if (callsError) {
    logError('Panel fetch failed', { error: callsError.message });
  }

  const processedCalls = (calls || []).filter(c => {
    if (c.status === 'g_trash' || c.status === 'junk') return false;
    
    // Hide completed (macro) conversions from the pending feed
    const stageDef = pipelineStages?.find(s => s.id === c.status);
    if (stageDef && (stageDef.is_macro || stageDef.multiplier === 1)) return false;
    
    return true;
  });

  return (
      <div className="min-h-screen bg-[#F8FAFC] pb-20 selection:bg-blue-100 font-sans">
         {/* Premium Top Navigation Area */}
         <div className="max-w-xl mx-auto px-6 pt-8 sm:pt-12 pb-4 sm:pb-6">
            <div className="flex flex-col items-center text-center mb-8 sm:mb-12">
               <div className="relative mb-6">
                  <div className="absolute -inset-2 sm:-inset-4 bg-blue-500/10 rounded-[3rem] blur-2xl animate-pulse" />
                  <div className="relative w-20 h-20 sm:w-22 sm:h-22 rounded-[1.75rem] sm:rounded-[2.25rem] bg-white border border-slate-100 text-slate-900 flex items-center justify-center font-black text-2xl sm:text-3xl shadow-[0_20px_40px_rgba(0,0,0,0.08)]">
                     OM
                  </div>
               </div>
               <div className="space-y-2">
                  <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 leading-none">
                    {site?.name || 'Aksiyon Paneli'}
                  </h1>
                  <div className="flex items-center justify-center gap-3">
                    <div className="h-px w-6 bg-slate-200" />
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em]">Revenue Command Center</p>
                    <div className="h-px w-6 bg-slate-200" />
                  </div>
               </div>
            </div>
           
           <PanelFeed initialCalls={processedCalls as unknown as import('@/lib/types/hunter').HunterIntent[]} />
        </div>
     </div>
  );
}
