import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { translate } from '@/lib/i18n/t';
import { panelSitePath, panelOciPath, panelInstallPath } from '@/lib/auth/site-operational-route';
export function PanelChrome({
  siteId,
  siteName,
  locale,
  isReadOnlyPreview,
  active,
  children,
}: {
  siteId: string;
  siteName: string;
  locale: string;
  isReadOnlyPreview?: boolean;
  active: 'desk' | 'oci' | 'install';
  children: React.ReactNode;
}) {
  const deskHref = panelSitePath(siteId);
  const ociHref = panelOciPath(siteId);
  const installHref = panelInstallPath(siteId);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <header className="border-b border-slate-100 bg-white/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-xl mx-auto px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center">
              <span className="text-[10px] font-black text-white tracking-widest">
                {translate(locale, 'panel.brandMonogram')}
              </span>
            </div>
            <div>
              <p className="text-sm font-black text-slate-900 leading-none">{siteName}</p>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">
                {active === 'install'
                  ? translate(locale, 'panel.install.title')
                  : translate(locale, 'panel.focusDeck')}
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href={deskHref}
              className={
                active === 'desk'
                  ? 'px-2 py-1 rounded-md bg-slate-900 text-white text-[10px] font-black uppercase'
                  : 'px-2 py-1 text-[10px] font-black uppercase text-slate-600'
              }
            >
              {translate(locale, 'panel.nav.desk')}
            </Link>
            <Link
              href={ociHref}
              className={
                active === 'oci'
                  ? 'px-2 py-1 rounded-md bg-slate-900 text-white text-[10px] font-black uppercase'
                  : 'px-2 py-1 text-[10px] font-black uppercase text-slate-600'
              }
            >
              {translate(locale, 'panel.nav.oci')}
            </Link>
            <Link
              href={installHref}
              className={
                active === 'install'
                  ? 'px-2 py-1 rounded-md bg-slate-900 text-white text-[10px] font-black uppercase'
                  : 'px-2 py-1 text-[10px] font-black uppercase text-slate-600'
              }
            >
              {translate(locale, 'panel.nav.install')}
            </Link>
            <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-50 rounded-full border border-emerald-100 text-[9px] font-black text-emerald-700 uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {translate(locale, 'panel.live')}
            </span>
            {isReadOnlyPreview ? (
              <span className="px-2 py-1 text-[9px] font-black uppercase text-amber-800 bg-amber-50 border border-amber-200 rounded-full">
                {translate(locale, 'panel.previewBadge')}
              </span>
            ) : null}
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="h-8 inline-flex items-center px-2 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                title={translate(locale, 'dashboard.signOut')}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 py-6 space-y-4">{children}</main>
    </div>
  );
}
