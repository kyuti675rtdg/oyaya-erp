/**
 * Skeleton loaders with shimmer effect — layout-matched placeholders
 * for the dashboard while data is fetching.
 */
function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-lg ${className}`} aria-hidden="true" />;
}

const cardShell =
  'rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(76,29,149,0.06),0_4px_16px_rgba(76,29,149,0.05)]';

export function SkeletonKpiCard() {
  return (
    <div className={cardShell} role="status" aria-label="Loading statistic">
      <div className="flex items-start justify-between">
        <Bar className="h-11 w-11 !rounded-xl" />
        <Bar className="h-6 w-16 !rounded-full" />
      </div>
      <Bar className="mt-4 h-8 w-2/3" />
      <Bar className="mt-2 h-4 w-1/2" />
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-6" aria-label="Loading dashboard">
      {/* Greeting */}
      <div>
        <Bar className="h-8 w-56" />
        <Bar className="mt-2 h-4 w-72" />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SkeletonKpiCard />
        <SkeletonKpiCard />
        <SkeletonKpiCard />
        <SkeletonKpiCard />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className={`${cardShell} xl:col-span-2`}>
          <Bar className="mb-4 h-6 w-40" />
          <Bar className="h-56 w-full !rounded-xl" />
        </div>
        <div className={cardShell}>
          <Bar className="mb-4 h-6 w-40" />
          <div className="flex justify-center">
            <Bar className="h-44 w-44 !rounded-full" />
          </div>
          <Bar className="mt-4 h-4 w-full" />
          <Bar className="mt-2 h-4 w-full" />
        </div>
      </div>

      {/* Table */}
      <div className={cardShell}>
        <div className="mb-4 flex items-center justify-between">
          <Bar className="h-6 w-36" />
          <Bar className="h-9 w-48 !rounded-xl" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <Bar key={i} className="mb-2.5 h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
