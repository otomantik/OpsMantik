import { redirect } from 'next/navigation';

interface PreviewPanelPageProps {
  params: Promise<{ siteId: string }>;
}

export default async function PreviewPanelPage({ params }: PreviewPanelPageProps) {
  const { siteId } = await params;
  if (!siteId) {
    redirect('/admin/sites?error=missing_site');
  }
  redirect(`/api/admin/panel-preview?siteId=${siteId}&mode=rw`);
}
