import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/auth/is-admin';
import { resolveLandingRoute } from '@/lib/auth/landing-route';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const userIsAdmin = await isAdmin();
    const { data: sites } = await supabase.from('sites').select('id').limit(1);
    const route = resolveLandingRoute({ isAdmin: userIsAdmin, siteCount: sites?.length ?? 0 });
    redirect(route);
  } else {
    redirect('/login');
  }
}
