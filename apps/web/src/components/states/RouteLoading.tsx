// Route loading UI (app/**/loading.tsx): shown at once on navigation while the next screen's server
// render streams in. A Tactical HUD (B) outline of the screen: the title bar, then cut-corner panels
// laid out like the screen that is coming (a card grid, a table, a list or a detail page).
export type RouteLoadingLayout = 'grid' | 'table' | 'list' | 'detail';

const PANELS: Record<RouteLoadingLayout, number> = { grid: 6, table: 1, list: 4, detail: 2 };

export function RouteLoading({ layout = 'list', label = 'Loading' }: { layout?: RouteLoadingLayout; label?: string }) {
  return (
    <div className="app-route-loading" data-layout={layout} role="status" aria-label={label} data-testid="route-loading">
      <span className="app-skeleton app-route-loading-title" />
      <span className="app-skeleton app-route-loading-tabs" />
      <div className="app-route-loading-body">
        {Array.from({ length: PANELS[layout] }, (_, i) => (
          <div key={i} className="app-route-loading-panel">
            {layout === 'table'
              ? Array.from({ length: 8 }, (_, r) => <span key={r} className="app-skeleton app-route-loading-row" />)
              : (
                  <>
                    <span className="app-skeleton app-route-loading-line is-head" />
                    <span className="app-skeleton app-route-loading-line" />
                    <span className="app-skeleton app-route-loading-line is-short" />
                  </>
                )}
          </div>
        ))}
      </div>
    </div>
  );
}
