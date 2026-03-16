import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { AlertTriangle, ThumbsUp, ThumbsDown, Check, ChevronDown, ChevronRight, Eye, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { correctLabel } from '../lib/api';
import { cn } from '../lib/utils';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'https://fraud.erfi.dev';

interface ReviewItem {
  email: string;
  risk_score: number;
  decision: string;
  entropy_score?: number;
  domain_reputation_score?: number;
  pattern_type?: string;
  timestamp: string;
  is_free_provider?: boolean;
  country?: string;
}

interface ReviewQueueProps {
  apiKey: string;
}

type Tab = 'fps' | 'fns' | 'boundary';

function ReviewRow({ item, apiKey, suggestedLabel }: { item: ReviewItem; apiKey: string; suggestedLabel: 0 | 1 }) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle');

  const handleCorrect = async (label: 0 | 1) => {
    setStatus('saving');
    try {
      await correctLabel(item.email, label, apiKey);
      setStatus('done');
    } catch {
      setStatus('idle');
    }
  };

  if (status === 'done') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-green-400 bg-green-500/5 rounded">
        <Check size={12} />
        <span className="font-mono truncate">{item.email}</span>
        <span className="ml-auto">Corrected</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/20 rounded group">
      <span className={cn(
        'w-1.5 h-1.5 rounded-full flex-shrink-0',
        item.decision === 'block' ? 'bg-red-400' : item.decision === 'warn' ? 'bg-yellow-400' : 'bg-green-400',
      )} />
      <span className="font-mono truncate text-foreground" title={item.email}>{item.email}</span>
      <span className="text-muted-foreground tabular-nums flex-shrink-0">{item.risk_score.toFixed(2)}</span>
      {item.country && <span className="text-muted-foreground flex-shrink-0">{item.country}</span>}
      <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost" size="sm"
          className="h-5 px-1.5 text-[10px] gap-0.5 text-green-400 hover:bg-green-500/10"
          onClick={() => handleCorrect(0)}
          disabled={status === 'saving'}
          title="Mark as legit"
        >
          <ThumbsUp size={10} />
          Legit
        </Button>
        <Button
          variant="ghost" size="sm"
          className="h-5 px-1.5 text-[10px] gap-0.5 text-red-400 hover:bg-red-500/10"
          onClick={() => handleCorrect(1)}
          disabled={status === 'saving'}
          title="Mark as fraud"
        >
          <ThumbsDown size={10} />
          Fraud
        </Button>
      </div>
    </div>
  );
}

export default function ReviewQueue({ apiKey }: ReviewQueueProps) {
  const [tab, setTab] = useState<Tab>('fps');
  const [fps, setFps] = useState<ReviewItem[]>([]);
  const [fns, setFns] = useState<ReviewItem[]>([]);
  const [boundary, setBoundary] = useState<ReviewItem[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!apiKey) return;
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/admin/review-queue?hours=24&limit=20`, {
        headers: { 'X-API-Key': apiKey },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as any;
      setFps(data.likelyFalsePositives || []);
      setFns(data.likelyFalseNegatives || []);
      setBoundary(data.boundaryCases || []);
      setSummary(data.summary || null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const tabs: { key: Tab; label: string; count: number; icon: typeof TrendingUp }[] = [
    { key: 'fps', label: 'Likely FPs', count: fps.length, icon: TrendingDown },
    { key: 'fns', label: 'Likely FNs', count: fns.length, icon: TrendingUp },
    { key: 'boundary', label: 'Uncertain', count: boundary.length, icon: Minus },
  ];

  const items = tab === 'fps' ? fps : tab === 'fns' ? fns : boundary;
  const suggestedLabel: 0 | 1 = tab === 'fns' ? 1 : 0;

  // Drift detection
  const blockRate = summary?.block_rate ?? 0;
  const driftWarning = blockRate > 70 ? 'High block rate — model may be too aggressive. Review FPs and correct labels.'
    : blockRate < 20 ? 'Low block rate — model may be too permissive. Review FNs and correct labels.'
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Eye size={18} className="text-primary" />
              Review Queue
            </CardTitle>
            <CardDescription>
              Likely misclassifications from the last 24 hours — correct labels to improve the model
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="text-xs">
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Drift alert */}
        {driftWarning && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Model drift detected</div>
              <div className="text-yellow-400/80 mt-0.5">{driftWarning}</div>
            </div>
          </div>
        )}

        {/* Summary stats */}
        {summary && (
          <div className="flex gap-4 text-[11px] text-muted-foreground">
            <span>Total: <strong className="text-foreground">{Math.round(summary.total || 0).toLocaleString()}</strong></span>
            <span>Block: <strong className="text-red-400">{(summary.block_rate || 0).toFixed(1)}%</strong></span>
            <span>Warn: <strong className="text-yellow-400">{(summary.warn_rate || 0).toFixed(1)}%</strong></span>
            <span>Allow: <strong className="text-green-400">{(summary.allow_rate || 0).toFixed(1)}%</strong></span>
            <span>Avg score: <strong className="text-foreground">{(summary.avg_score || 0).toFixed(2)}</strong></span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-muted/30 rounded-lg p-0.5">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex-1 justify-center',
                tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon size={12} />
              {t.label}
              {t.count > 0 && (
                <span className={cn(
                  'px-1.5 py-0 rounded-full text-[10px] tabular-nums',
                  tab === t.key ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Guidance text */}
        <div className="text-[11px] text-muted-foreground bg-muted/10 rounded px-3 py-2">
          {tab === 'fps' && 'These emails were blocked or warned but look legitimate (low entropy, non-disposable domains). Click "Legit" to correct the label — the model learns from corrections on the next retrain.'}
          {tab === 'fns' && 'These emails were allowed but have suspicious signals (high entropy or risky domain reputation). Click "Fraud" if they look fake.'}
          {tab === 'boundary' && 'These emails scored near the decision boundary — the model is least confident about them. Your corrections here have the highest training impact.'}
        </div>

        {/* Items list */}
        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-muted/30 rounded animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="text-xs text-destructive py-4 text-center">{error}</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">
            No items to review. {tab === 'fps' ? 'No suspicious blocks detected.' : tab === 'fns' ? 'No suspicious allows detected.' : 'No boundary cases found.'}
          </div>
        ) : (
          <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
            {items.map((item, i) => (
              <ReviewRow key={`${item.email}-${i}`} item={item} apiKey={apiKey} suggestedLabel={suggestedLabel} />
            ))}
          </div>
        )}

        {/* Batch action hint */}
        {items.length > 5 && (
          <div className="text-[10px] text-muted-foreground text-center">
            Hover over any row to correct its label. Corrections get 5x weight in the next training run.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
