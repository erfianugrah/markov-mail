import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { SlidersHorizontal, Eye, Save, AlertCircle, CheckCircle } from 'lucide-react';
import { previewThresholds, applyThresholds, getSystemConfig } from '../lib/api';
import { cn } from '../lib/utils';

interface ThresholdTunerProps {
  apiKey: string;
}

interface Preview {
  totalValidations: number;
  current: { allow: number; warn: number; block: number };
  projected: { allow: number; warn: number; block: number };
  changes: { total: number; toAllow: number; toWarn: number; toBlock: number };
}

export default function ThresholdTuner({ apiKey }: ThresholdTunerProps) {
  const [warn, setWarn] = useState(0.56);
  const [block, setBlock] = useState(0.88);
  const [liveWarn, setLiveWarn] = useState(0.56);
  const [liveBlock, setLiveBlock] = useState(0.88);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load current thresholds
  useEffect(() => {
    getSystemConfig(apiKey).then(cfg => {
      setWarn(cfg.riskThresholds.warn);
      setBlock(cfg.riskThresholds.block);
      setLiveWarn(cfg.riskThresholds.warn);
      setLiveBlock(cfg.riskThresholds.block);
    }).catch(() => {});
  }, [apiKey]);

  const handlePreview = useCallback(async () => {
    if (warn >= block) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await previewThresholds(warn, block, 24, apiKey);
      setPreview(result);
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Preview failed' });
    } finally {
      setLoading(false);
    }
  }, [warn, block, apiKey]);

  const handleApply = async () => {
    if (warn >= block) return;
    setSaving(true);
    setMessage(null);
    try {
      await applyThresholds(warn, block, apiKey);
      setLiveWarn(warn);
      setLiveBlock(block);
      setMessage({ type: 'success', text: `Thresholds updated: warn=${warn.toFixed(2)}, block=${block.toFixed(2)}` });
      setPreview(null);
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Apply failed' });
    } finally {
      setSaving(false);
    }
  };

  const isDirty = warn !== liveWarn || block !== liveBlock;
  const isValid = warn > 0 && warn < block && block <= 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-primary" />
          Threshold Tuning
        </CardTitle>
        <CardDescription>
          Adjust warn/block thresholds and preview the impact on recent traffic
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sliders */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-yellow-400">Warn Threshold</label>
              <span className="font-mono text-xs text-foreground tabular-nums">{warn.toFixed(2)}</span>
            </div>
            <input
              type="range" min="0.05" max="0.95" step="0.01"
              value={warn}
              onChange={e => { setWarn(parseFloat(e.target.value)); setPreview(null); }}
              className="w-full h-1.5 rounded-full appearance-none bg-muted cursor-pointer accent-yellow-400"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-red-400">Block Threshold</label>
              <span className="font-mono text-xs text-foreground tabular-nums">{block.toFixed(2)}</span>
            </div>
            <input
              type="range" min="0.05" max="0.95" step="0.01"
              value={block}
              onChange={e => { setBlock(parseFloat(e.target.value)); setPreview(null); }}
              className="w-full h-1.5 rounded-full appearance-none bg-muted cursor-pointer accent-red-400"
            />
          </div>
        </div>

        {!isValid && (
          <div className="text-xs text-destructive">Warn must be less than block, both between 0 and 1.</div>
        )}

        {/* Score bar visualization */}
        <div className="relative h-6 rounded-full overflow-hidden bg-muted/50 border border-border">
          <div className="absolute inset-y-0 left-0 bg-green-500/20" style={{ width: `${warn * 100}%` }} />
          <div className="absolute inset-y-0 bg-yellow-500/20" style={{ left: `${warn * 100}%`, width: `${(block - warn) * 100}%` }} />
          <div className="absolute inset-y-0 right-0 bg-red-500/20" style={{ width: `${(1 - block) * 100}%` }} />
          {/* Markers */}
          <div className="absolute inset-y-0 w-px bg-yellow-400/60" style={{ left: `${warn * 100}%` }} />
          <div className="absolute inset-y-0 w-px bg-red-400/60" style={{ left: `${block * 100}%` }} />
          {/* Labels */}
          <span className="absolute top-0.5 text-[9px] font-medium text-green-400" style={{ left: `${warn * 50}%`, transform: 'translateX(-50%)' }}>allow</span>
          <span className="absolute top-0.5 text-[9px] font-medium text-yellow-400" style={{ left: `${(warn + block) * 50}%`, transform: 'translateX(-50%)' }}>warn</span>
          <span className="absolute top-0.5 text-[9px] font-medium text-red-400" style={{ left: `${(1 + block) * 50}%`, transform: 'translateX(-50%)' }}>block</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={handlePreview}
            disabled={loading || !isValid}
            className="gap-1.5"
          >
            <Eye size={14} />
            {loading ? 'Loading...' : 'Preview Impact'}
          </Button>
          {isDirty && preview && (
            <Button
              size="sm"
              onClick={handleApply}
              disabled={saving || !isValid}
              className="gap-1.5"
            >
              <Save size={14} />
              {saving ? 'Applying...' : 'Apply'}
            </Button>
          )}
        </div>

        {/* Preview results */}
        {preview && (
          <div className="bg-muted/20 rounded-lg p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Impact on {preview.totalValidations.toLocaleString()} validations (last 24h):
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] text-muted-foreground">Allow</div>
                <div className="text-sm tabular-nums">
                  <span className="text-muted-foreground">{preview.current.allow}</span>
                  <span className="text-muted-foreground/50 mx-1">&rarr;</span>
                  <span className="text-green-400 font-medium">{preview.projected.allow}</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">Warn</div>
                <div className="text-sm tabular-nums">
                  <span className="text-muted-foreground">{preview.current.warn}</span>
                  <span className="text-muted-foreground/50 mx-1">&rarr;</span>
                  <span className="text-yellow-400 font-medium">{preview.projected.warn}</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">Block</div>
                <div className="text-sm tabular-nums">
                  <span className="text-muted-foreground">{preview.current.block}</span>
                  <span className="text-muted-foreground/50 mx-1">&rarr;</span>
                  <span className="text-red-400 font-medium">{preview.projected.block}</span>
                </div>
              </div>
            </div>
            {preview.changes.total > 0 && (
              <div className="text-xs text-muted-foreground">
                {preview.changes.total} validations would change decision
                {preview.changes.toAllow > 0 && <span className="text-green-400"> (+{preview.changes.toAllow} to allow)</span>}
                {preview.changes.toWarn > 0 && <span className="text-yellow-400"> (+{preview.changes.toWarn} to warn)</span>}
                {preview.changes.toBlock > 0 && <span className="text-red-400"> (+{preview.changes.toBlock} to block)</span>}
              </div>
            )}
          </div>
        )}

        {/* Status message */}
        {message && (
          <div className={cn(
            'flex items-center gap-2 text-xs px-3 py-2 rounded-lg',
            message.type === 'success'
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20',
          )}>
            {message.type === 'success' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
            {message.text}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
