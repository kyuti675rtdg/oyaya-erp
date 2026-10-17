/**
 * Skeleton loaders with shimmer effect — layout-matched placeholders
 * for the dashboard while data is fetching.
 */
function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-lg ${className}`} aria-hidden="true" />;
}

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

export function SkeletonKpiCard() {
  return (
    <div className={cardShell} role="status" aria-label="Loading statistic">
      <div className="flex items-start justify-between gap-3">
        <Bar className="h-4 w-24" />
        <Bar className="h-10 w-10 !rounded-xl" />
      </div>
      <Bar className="mt-3 h-8 w-2/3" />
      <Bar className="mt-3 h-4 w-1/2" />
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-5" aria-label="Loading dashboard">
      {/* Row 1: hero + status cards */}
      <div className="grid grid-cols-12 gap-4">
        <div className={`${cardShell} col-span-12 lg:col-span-7`}>
          <Bar className="h-8 w-56" />
          <Bar className="mt-2 h-4 w-72" />
        </div>
        <div className={`${cardShell} col-span-12 sm:col-span-6 lg:col-span-3`}>
          <Bar className="h-6 w-32" />
          <Bar className="mt-2 h-4 w-40" />
        </div>
        <div className={`${cardShell} col-span-12 sm:col-span-6 lg:col-span-2`}>
          <Bar className="h-6 w-16" />
          <Bar className="mt-2 h-4 w-24" />
        </div>
      </div>

      {/* Row 2: 5 KPI pillars */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SkeletonKpiCard />
        <SkeletonKpiCard />
        <SkeletonKpiCard />
        <SkeletonKpiCard />
        <SkeletonKpiCard />
      </div>

      {/* Row 3: charts + donut + stock */}
      <div className="grid grid-cols-12 gap-4">
        <div className={`${cardShell} col-span-12 lg:col-span-5`}>
          <Bar className="mb-4 h-6 w-40" />
          <Bar className="h-64 w-full !rounded-xl" />
        </div>
        <div className={`${cardShell} col-span-12 md:col-span-6 lg:col-span-4`}>
          <Bar className="mb-4 h-6 w-40" />
          <div className="flex justify-center">
            <Bar className="h-44 w-44 !rounded-full" />
          </div>
          <Bar className="mt-4 h-4 w-full" />
          <Bar className="mt-2 h-4 w-full" />
        </div>
        <div className={`${cardShell} col-span-12 md:col-span-6 lg:col-span-3`}>
          <Bar className="mb-4 h-6 w-32" />
          {[0, 1, 2, 3].map((i) => (
            <Bar key={i} className="mb-3 h-10 w-full" />
          ))}
        </div>
      </div>

      {/* Row 4: quality + procurement + quick access */}
      <div className="grid grid-cols-12 gap-4">
        <div className={`${cardShell} col-span-12 lg:col-span-5`}>
          <Bar className="mb-4 h-6 w-36" />
          <Bar className="h-56 w-full !rounded-xl" />
        </div>
        <div className={`${cardShell} col-span-12 lg:col-span-4`}>
          <Bar className="mb-4 h-6 w-40" />
          {[0, 1, 2, 3].map((i) => (
            <Bar key={i} className="mb-2.5 h-10 w-full" />
          ))}
        </div>
        <div className={`${cardShell} col-span-12 lg:col-span-3`}>
          <Bar className="mb-4 h-6 w-28" />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Bar key={i} className="h-16 w-full !rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
