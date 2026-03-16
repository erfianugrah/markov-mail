import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { AlertCircle, Database, Play, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'https://fraud.erfi.dev';

interface DatasetStats {
  total: number;
  fraud: number;
  legit: number;
  sources: Record<string, number>;
  oldestTimestamp?: string;
  newestTimestamp?: string;
}

interface TrainingHistoryEntry {
  id: number;
  timestamp: string;
  event: string;
  model_version?: string;
  total_samples?: number;
  accuracy?: number;
  training_duration?: number;
  error_message?: string;
  trigger_type?: string;
}

interface TrainingPanelProps {
  apiKey: string;
}

export default function TrainingPanel({ apiKey }: TrainingPanelProps) {
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [history, setHistory] = useState<TrainingHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [training, setTraining] = useState(false);
  const [trainResult, setTrainResult] = useState<string | null>(null);

  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };

  const fetchData = useCallback(async () => {
    if (!apiKey) return;
    try {
      setLoading(true);
      setError(null);

      const [statsRes, historyRes] = await Promise.all([
        fetch(`${API_BASE}/admin/training/dataset`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/admin/training/status`, { headers }).then(r => r.json()),
      ]);

      setStats(statsRes.metadata || null);
      setHistory((historyRes.history || []).slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load training data');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const triggerTraining = async () => {
    setTraining(true);
    setTrainResult(null);
    try {
      const res = await fetch(`${API_BASE}/admin/training/trigger`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ nTrees: 20, maxDepth: 6, minSamplesLeaf: 20 }),
      });
      const data = await res.json() as any;
      const cr = data.containerResponse;
      if (cr?.guardrails?.passed) {
        const rec = cr.guardrails.recommendation;
        setTrainResult(
          `deployed:Model ${cr.modelVersion || 'unknown'} trained and deployed successfully. ` +
          `${cr.stats?.totalSamples || 0} samples, ${(cr.stats?.meanOobAccuracy * 100 || 0).toFixed(1)}% OOB accuracy.` +
          (rec ? ` Thresholds: warn=${rec.warnThreshold}, block=${rec.blockThreshold}.` : '')
        );
      } else if (cr?.guardrails?.failures?.length) {
        const failure = cr.guardrails.failures[0];
        let advice = '';
        if (failure.includes('threshold pair')) {
          advice = ' Try: correct more labels in the Review Queue to improve training data quality, or lower guardrail constraints in src/training/guardrails.ts.';
        } else if (failure.includes('calibration')) {
          advice = ' The model needs more diverse training data. Correct labels for both FPs and FNs to improve class balance.';
        } else if (failure.includes('size')) {
          advice = ' Reduce nTrees or maxDepth to shrink the model.';
        }
        setTrainResult(`failed:Guardrails rejected the model: ${failure}.${advice}`);
      } else if (cr?.error) {
        setTrainResult(`failed:${cr.error}`);
      } else {
        setTrainResult(data.message || 'Training completed');
      }
      fetchData();
    } catch (e) {
      setTrainResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTraining(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Model Training</CardTitle>
          <CardDescription>Loading training pipeline status...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-muted/50 rounded animate-pulse"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle size={18} />
            Training Pipeline
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const fraudRatio = stats && stats.total > 0 ? (stats.fraud / stats.total * 100).toFixed(1) : '0';
  const legitRatio = stats && stats.total > 0 ? (stats.legit / stats.total * 100).toFixed(1) : '0';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database size={18} className="text-primary" />
              Model Training
            </CardTitle>
            <CardDescription>Container-based retraining pipeline</CardDescription>
          </div>
          <Button
            size="sm"
            onClick={triggerTraining}
            disabled={training || !stats || stats.total < 100}
            className="gap-1.5"
          >
            {training ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {training ? 'Training...' : 'Train Now'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Training result banner */}
        {trainResult && (() => {
          const isSuccess = trainResult.startsWith('deployed:');
          const isFail = trainResult.startsWith('failed:');
          const text = trainResult.replace(/^(deployed|failed):/, '');
          return (
            <div className={cn(
              'flex items-start gap-2 px-3 py-2 rounded-lg text-xs leading-relaxed',
              isSuccess ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : isFail ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
            )}>
              {isSuccess ? <CheckCircle size={14} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />}
              <span>{text}</span>
            </div>
          );
        })()}

        {/* Dataset stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Samples</div>
            <div className="text-lg font-semibold tabular-nums text-foreground">{stats?.total?.toLocaleString() || 0}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Fraud</div>
            <div className="text-lg font-semibold tabular-nums text-red-400">{stats?.fraud?.toLocaleString() || 0}</div>
            <div className="text-[10px] text-muted-foreground">{fraudRatio}%</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Legit</div>
            <div className="text-lg font-semibold tabular-nums text-green-400">{stats?.legit?.toLocaleString() || 0}</div>
            <div className="text-[10px] text-muted-foreground">{legitRatio}%</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Sources</div>
            <div className="text-lg font-semibold tabular-nums text-foreground">{stats?.sources ? Object.keys(stats.sources).length : 0}</div>
          </div>
        </div>

        {stats && stats.total < 100 && (
          <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
            Minimum 100 samples required to train. Currently at {stats.total}. Send more emails through /validate to collect data.
          </div>
        )}

        {/* Training history */}
        {history.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Recent Activity</div>
            <div className="space-y-1">
              {history.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/20">
                  {entry.event === 'training_completed' ? (
                    <CheckCircle size={12} className="text-green-400 flex-shrink-0" />
                  ) : entry.event === 'training_failed' ? (
                    <XCircle size={12} className="text-red-400 flex-shrink-0" />
                  ) : (
                    <Clock size={12} className="text-muted-foreground flex-shrink-0" />
                  )}
                  <span className="text-muted-foreground truncate">
                    {new Date(entry.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={cn(
                    'font-mono truncate',
                    entry.event.includes('completed') ? 'text-green-400' :
                    entry.event.includes('failed') ? 'text-red-400' : 'text-foreground',
                  )}>
                    {entry.event.replace(/_/g, ' ')}
                  </span>
                  {entry.model_version && (
                    <span className="text-muted-foreground ml-auto flex-shrink-0 font-mono">{entry.model_version}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
