// Loading placeholder (UI/UX Spec States: lists show 6 skeleton rows; details skeleton the grid).
export function Skeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="app-skeleton-stack" role="status" aria-label={label} data-testid="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="app-skeleton app-skeleton-row" />
      ))}
    </div>
  );
}
