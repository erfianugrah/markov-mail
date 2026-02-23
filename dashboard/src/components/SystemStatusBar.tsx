import { useState, useEffect } from 'react';
import { getSystemConfig, type SystemConfig } from '../lib/api';
import { Shield, Activity, Settings, AlertTriangle, CheckCircle } from 'lucide-react';

interface SystemStatusBarProps {
  apiKey: string;
}

export default function SystemStatusBar({ apiKey }: SystemStatusBarProps) {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSystemConfig(apiKey)
      .then((cfg) => { if (!cancelled) setConfig(cfg); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [apiKey]);

  if (error) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
        <AlertTriangle size={14} />
        <span>Failed to load system config</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted/50 border border-border animate-pulse">
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-4 w-40 bg-muted rounded" />
      </div>
    );
  }

  const features = config.features || {};
  const enabledCount = Object.values(features).filter(Boolean).length;
  const totalCount = Object.keys(features).length;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 rounded-lg bg-muted/30 border border-border text-sm">
      {/* Thresholds */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Shield size={14} className="text-primary" />
        <span>Thresholds:</span>
        <span className="font-mono font-medium text-red-400">block &ge; {config.riskThresholds.block}</span>
        <span className="text-muted-foreground/50">|</span>
        <span className="font-mono font-medium text-yellow-400">warn &ge; {config.riskThresholds.warn}</span>
      </div>

      <div className="hidden sm:block w-px h-4 bg-border" />

      {/* Model Version */}
      {config.modelVersion && (
        <>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Activity size={14} className="text-green-400" />
            <span>Model:</span>
            <span className="font-mono font-medium text-foreground">{config.modelVersion}</span>
          </div>
          <div className="hidden sm:block w-px h-4 bg-border" />
        </>
      )}

      {/* Feature Flags */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Settings size={14} className="text-blue-400" />
        <span>Features:</span>
        <span className="font-medium text-foreground">{enabledCount}/{totalCount} enabled</span>
      </div>

      <div className="hidden sm:block w-px h-4 bg-border" />

      {/* Status */}
      <div className="flex items-center gap-1.5 text-green-400">
        <CheckCircle size={14} />
        <span className="font-medium">Active</span>
      </div>

      {/* Logout */}
      <div className="ml-auto">
        <a
          href="/dashboard/logout"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign out
        </a>
      </div>
    </div>
  );
}
