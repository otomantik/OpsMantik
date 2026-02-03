import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function AdminSitesLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-[1920px] mx-auto">
        {/* Header Skeleton */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="h-9 w-64 bg-muted rounded animate-pulse mb-2"></div>
            <div className="h-5 w-96 bg-muted/70 rounded animate-pulse"></div>
          </div>
          <div className="h-9 w-32 bg-muted rounded animate-pulse"></div>
        </div>

        {/* Card Skeleton */}
        <Card>
          <CardHeader>
            <div className="h-6 w-32 bg-muted rounded animate-pulse mb-2"></div>
            <div className="h-4 w-64 bg-muted/70 rounded animate-pulse"></div>
          </CardHeader>
          <CardContent>
            {/* Search Input Skeleton */}
            <div className="mb-4">
              <div className="h-10 w-full bg-muted rounded animate-pulse"></div>
            </div>

            {/* Table Skeleton */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <th key={i} className="p-3">
                        <div className="h-4 w-20 bg-muted/70 rounded animate-pulse"></div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map((row) => (
                    <tr key={row} className="border-b border-border">
                      {[1, 2, 3, 4, 5, 6, 7].map((cell) => (
                        <td key={cell} className="p-3">
                          <div className="h-4 w-24 bg-muted/50 rounded animate-pulse"></div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
