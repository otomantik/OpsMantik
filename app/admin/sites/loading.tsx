import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminSitesLoading() {
  return (
    <div className="min-h-screen bg-[#020617] p-6">
      <div className="max-w-[1920px] mx-auto">
        {/* Header Skeleton */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="h-9 w-64 bg-slate-800/40 rounded animate-pulse mb-2"></div>
            <div className="h-5 w-96 bg-slate-800/30 rounded animate-pulse"></div>
          </div>
          <div className="h-9 w-32 bg-slate-800/40 rounded animate-pulse"></div>
        </div>

        {/* Card Skeleton */}
        <Card className="glass border-slate-800/50">
          <CardHeader>
            <div className="h-6 w-32 bg-slate-800/40 rounded animate-pulse mb-2"></div>
            <div className="h-4 w-64 bg-slate-800/30 rounded animate-pulse"></div>
          </CardHeader>
          <CardContent>
            {/* Search Input Skeleton */}
            <div className="mb-4">
              <div className="h-10 w-full bg-slate-800/40 rounded animate-pulse"></div>
            </div>

            {/* Table Skeleton */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <th key={i} className="p-3">
                        <div className="h-4 w-20 bg-slate-800/30 rounded animate-pulse"></div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map((row) => (
                    <tr key={row} className="border-b border-slate-800/30">
                      {[1, 2, 3, 4, 5, 6, 7].map((cell) => (
                        <td key={cell} className="p-3">
                          <div className="h-4 w-24 bg-slate-800/20 rounded animate-pulse"></div>
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
