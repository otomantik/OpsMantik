'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';

interface QualificationQueueProps {
  siteId: string;
}

export function QualificationQueue({ siteId }: QualificationQueueProps) {
  // TODO: Fetch unscored intents (lead_score = 0 AND status = 'intent')
  // This is a placeholder for P0 implementation
  
  const unscoredCount = 0; // Placeholder

  if (unscoredCount === 0) {
    return (
      <Card className="border-2 border-dashed border-border bg-muted/20">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Icons.check className="w-16 h-16 text-green-500 mb-4" />
          <h3 className="text-xl font-semibold mb-2">All Caught Up!</h3>
          <p className="text-muted-foreground max-w-md">
            No pending intents to qualify. New intents from Google Ads will appear here automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">
            Intent Qualification Queue
          </CardTitle>
          <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">
            {unscoredCount} Pending
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <p className="text-muted-foreground">
              🚧 Intent qualification cards coming soon (P0)...
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              You'll be able to score and qualify intents directly here.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
