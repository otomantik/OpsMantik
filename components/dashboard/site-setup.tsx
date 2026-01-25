'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function SiteSetup() {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const createTestSite = async () => {
    setIsCreating(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch('/api/create-test-site', {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.details 
          ? `${data.error}: ${data.details}` 
          : data.error || 'Failed to create test site';
        console.error('[SITE_SETUP] API Error:', data);
        throw new Error(errorMessage);
      }

      setSuccess(true);
      console.log('[SITE_SETUP] ✅ Test site created:', data.site);
      
      // Show the public_id to user
      if (data.site?.public_id) {
        console.log('[SITE_SETUP] Your site public_id:', data.site.public_id);
        console.log('[SITE_SETUP] Use this in test page: data-site-id="' + data.site.public_id + '"');
      }
      
      // Reload page after 2 seconds to refresh dashboard
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      console.error('[SITE_SETUP] ❌ Error:', err);
      setError(err.message || 'Unknown error');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Card className="glass border-slate-800/50 border-2 border-dashed">
      <CardHeader>
        <CardTitle className="text-lg font-mono text-slate-200">⚠️ NO SITES FOUND</CardTitle>
        <CardDescription className="font-mono text-xs text-slate-400 mt-2">
          You need at least one site to track events. Create a test site to get started.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="bg-slate-900/50 p-4 rounded border border-slate-700/50">
            <p className="font-mono text-xs text-slate-300 mb-2">
              <strong className="text-emerald-400">Test Site Details:</strong>
            </p>
            <ul className="font-mono text-xs text-slate-400 space-y-1 ml-4 list-disc">
              <li>Public ID: <code className="text-slate-300">test_site_123</code></li>
              {process.env.NODE_ENV === 'development' && (
                <li>Domain: <code className="text-slate-300">localhost:3000</code></li>
              )}
              <li>Use this in your tracker script: <code className="text-slate-300">data-site-id="test_site_123"</code></li>
            </ul>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-700/50 p-3 rounded">
              <p className="font-mono text-xs text-red-400 mb-2">❌ {error}</p>
              <p className="font-mono text-xs text-red-500/70">
                Check console for details. If site already exists, try refreshing the page.
              </p>
            </div>
          )}

          {success && (
            <div className="bg-emerald-900/20 border border-emerald-700/50 p-3 rounded">
              <p className="font-mono text-xs text-emerald-400">✅ Test site created! Reloading...</p>
            </div>
          )}

          <Button
            onClick={createTestSite}
            disabled={isCreating || success}
            className="w-full bg-emerald-600 hover:bg-emerald-700 font-mono text-sm"
          >
            {isCreating ? '⏳ Creating...' : success ? '✅ Created!' : '🚀 Create Test Site'}
          </Button>

          <p className="font-mono text-xs text-slate-500 text-center">
            After creating, you can test events on the{' '}
            <a href="/test-page" className="text-emerald-400 hover:text-emerald-300 underline">
              Test Page
            </a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
