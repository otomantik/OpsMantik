'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { debugLog, debugWarn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // Check if user is already logged in
  useEffect(() => {
    const checkUser = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        router.push('/dashboard');
      } else {
        setIsChecking(false);
      }
    };
    
    checkUser();
  }, [router]);

  const handleSignIn = async () => {
    setIsLoading(true);
    
    const supabase = createClient();
    
    // Compute redirectTo using NEXT_PUBLIC_PRIMARY_DOMAIN
    const primaryDomain = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN;
    let redirectTo: string;
    
    if (primaryDomain) {
      redirectTo = `https://console.${primaryDomain}/auth/callback`;
    } else {
      // Fallback to current origin (development only)
      redirectTo = `${window.location.origin}/auth/callback`;
      
      debugWarn('[AUTH] NEXT_PUBLIC_PRIMARY_DOMAIN not set. Using fallback:', redirectTo);
    }
    
    debugLog('[AUTH] Google OAuth redirectTo:', redirectTo);
    
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
    });
    
    if (error) {
      console.error('Auth error:', error);
      setIsLoading(false);
      return;
    }
    
    if (data.url) {
      // Redirect to OAuth provider
      window.location.href = data.url;
    } else {
      setIsLoading(false);
    }
  };

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">OPSMANTIK</h1>
          <p className="mt-2 text-gray-600">Google Ads Attribution & Lead Intelligence</p>
        </div>
        <Button 
          onClick={handleSignIn} 
          disabled={isLoading}
          className="w-full" 
          size="lg"
        >
          {isLoading ? 'Redirecting...' : 'Sign in with Google'}
        </Button>
      </div>
    </div>
  );
}
