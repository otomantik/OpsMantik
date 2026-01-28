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
    <Card className="border-2 border-dashed">
      <CardHeader>
        <CardTitle className="text-base font-semibold">No sites found</CardTitle>
        <CardDescription className="text-sm text-muted-foreground mt-2">
          You need at least one site to track events. Create a test site to get started.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="bg-muted p-4 rounded border border-border">
            <p className="text-sm text-foreground mb-2">
              <strong className="text-emerald-700">Test Site Details:</strong>
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
              <li>Public ID: <code className="text-foreground">test_site_123</code></li>
              {process.env.NODE_ENV === 'development' && (
                <li>Domain: <code className="text-foreground">localhost:3000</code></li>
              )}
              <li>Use this in your tracker script: <code className="text-foreground">data-site-id="test_site_123"</code></li>
            </ul>
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 p-3 rounded">
              <p className="text-sm text-destructive mb-2">Error: {error}</p>
              <p className="text-sm text-muted-foreground">
                Check console for details. If site already exists, try refreshing the page.
              </p>
            </div>
          )}

          {success && (
            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded">
              <p className="text-sm text-emerald-700">Test site created! Reloading...</p>
            </div>
          )}

          <Button
            onClick={createTestSite}
            disabled={isCreating || success}
            className="w-full"
          >
            {isCreating ? '⏳ Creating...' : success ? '✅ Created!' : '🚀 Create Test Site'}
          </Button>

          <p className="text-sm text-muted-foreground text-center">
            After creating, you can test events on the{' '}
            <a href="/test-page" className="text-emerald-700 hover:text-emerald-800 underline">
              Test Page
            </a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
