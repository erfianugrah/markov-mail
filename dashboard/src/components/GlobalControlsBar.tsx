import { RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

interface GlobalControlsBarProps {
  autoRefresh: boolean;
  refreshInterval: number;
  onAutoRefreshChange: (enabled: boolean) => void;
  onRefreshIntervalChange: (interval: number) => void;
  onManualRefresh?: () => void;
  isLoading?: boolean;
}

/**
 * GlobalControlsBar provides unified dashboard controls
 * Includes auto-refresh and manual refresh controls
 */
export function GlobalControlsBar({
  autoRefresh,
  refreshInterval,
  onAutoRefreshChange,
  onRefreshIntervalChange,
  onManualRefresh,
  isLoading = false,
}: GlobalControlsBarProps) {
  return (
    <div className="p-4 bg-card border border-border rounded-lg shadow-sm">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* Auto-refresh & Manual Refresh */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Manual Refresh Button */}
          {onManualRefresh && (
            <Button
              variant="secondary"
              onClick={onManualRefresh}
              disabled={isLoading}
              className="gap-2"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </Button>
          )}

          {/* Auto-refresh Toggle */}
          <label className="flex items-center gap-2 cursor-pointer px-3 py-2 bg-secondary rounded-md hover:bg-secondary/80 transition-colors">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => onAutoRefreshChange(e.target.checked)}
              className="w-4 h-4 accent-primary cursor-pointer"
            />
            <span className="text-sm text-foreground whitespace-nowrap">Auto-refresh</span>
          </label>

          {/* Refresh Interval Selector */}
          {autoRefresh && (
            <select
              value={refreshInterval}
              onChange={(e) => onRefreshIntervalChange(parseInt(e.target.value))}
              className="px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={120}>2min</option>
              <option value={300}>5min</option>
            </select>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Info text */}
        <div className="text-sm text-muted-foreground">
          {autoRefresh ? (
            <span>Refreshing every {refreshInterval}s</span>
          ) : (
            <span>Auto-refresh disabled</span>
          )}
        </div>
      </div>
    </div>
  );
}
