import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronRight as ChevronExpand, AlertCircle, X, ThumbsUp, ThumbsDown, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { correctLabel } from '../lib/api';

interface Validation {
  timestamp: string;
  email: string;
  decision: string;
  risk_score: number;
  block_reason?: string;
  country?: string;
  pattern_type?: string;
  is_disposable?: boolean;
  is_free_provider?: boolean;
  entropy_score?: number;
  bot_score?: number;
  tld_risk_score?: number;
  domain_reputation_score?: number;
  model_version?: string;
  latency?: number;
  client_ip?: string;
  fingerprint_hash?: string;
  decision_tree_reason?: string;
  pattern_confidence?: number;
}

interface ValidationTableProps {
  apiKey: string;
  hours?: number;
}

// --- Pagination hook (adapted from gatekeeper) ---
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

function usePagination<T>(items: T[], defaultPageSize = 25) {
  const [page, setPageRaw] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(defaultPageSize);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const clampedPage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (clampedPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, clampedPage, pageSize]);

  const setPage = useCallback(
    (p: number) => setPageRaw(Math.max(1, Math.min(p, totalPages))),
    [totalPages],
  );

  const setPageSize = useCallback((size: number) => {
    setPageSizeRaw(size);
    setPageRaw(1);
  }, []);

  return { pageItems, page: clampedPage, pageSize, totalItems, totalPages, setPage, setPageSize };
}

// --- Page number generator with ellipsis ---
function getPageNumbers(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: number[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) pages.push(-1);
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push(-1);
  pages.push(total);
  return pages;
}

// Badge thresholds — kept in sync with config/production/config.json
const BLOCK_THRESHOLD = 0.88;
const WARN_THRESHOLD = 0.56;

// --- Badges ---
function RiskBadge({ score }: { score: number }) {
  const color = score >= BLOCK_THRESHOLD
    ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : score >= WARN_THRESHOLD
      ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
      : 'bg-green-500/15 text-green-400 border-green-500/30';
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border tabular-nums', color)}>
      {score.toFixed(2)}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  const color = decision === 'allow'
    ? 'bg-green-500/15 text-green-400 border-green-500/30'
    : decision === 'block'
      ? 'bg-red-500/15 text-red-400 border-red-500/30'
      : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30';
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', color)}>
      {decision}
    </span>
  );
}

// --- Detail field ---
function DetailField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground text-[11px] uppercase tracking-wider">{label}</span>
      <div className="font-mono text-xs text-foreground mt-0.5 truncate" title={value || ''}>
        {value || '—'}
      </div>
    </div>
  );
}

// --- Label correction inline component ---
function LabelCorrection({ email, decision, apiKey }: { email: string; decision: string; apiKey: string }) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle');
  const [result, setResult] = useState<string | null>(null);

  const handleCorrect = async (label: 0 | 1) => {
    setStatus('saving');
    try {
      const res = await correctLabel(email, label, apiKey);
      setResult(res.message || 'Saved');
      setStatus('done');
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Failed');
      setStatus('idle');
    }
  };

  if (status === 'done') {
    return (
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30 text-xs text-green-400">
        <Check size={12} />
        <span>{result}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
      <span className="text-[11px] text-muted-foreground">Wrong decision?</span>
      {decision === 'block' || decision === 'warn' ? (
        <Button
          variant="ghost" size="sm"
          className="h-6 px-2 text-[11px] gap-1 text-green-400 hover:text-green-300 hover:bg-green-500/10"
          onClick={(e) => { e.stopPropagation(); handleCorrect(0); }}
          disabled={status === 'saving'}
        >
          <ThumbsUp size={11} />
          Actually legit
        </Button>
      ) : (
        <Button
          variant="ghost" size="sm"
          className="h-6 px-2 text-[11px] gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/10"
          onClick={(e) => { e.stopPropagation(); handleCorrect(1); }}
          disabled={status === 'saving'}
        >
          <ThumbsDown size={11} />
          Actually fraud
        </Button>
      )}
    </div>
  );
}

// --- Main component ---
export default function ValidationTable({ apiKey, hours = 24 }: ValidationTableProps) {
  const [validations, setValidations] = useState<Validation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { pageItems, page, pageSize, totalItems, totalPages, setPage, setPageSize } = usePagination(validations, 25);

  // Compute global start index for keying expanded rows
  const startIndex = (page - 1) * pageSize;

  const toggleExpanded = useCallback((globalIdx: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(globalIdx)) next.delete(globalIdx);
      else next.add(globalIdx);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => setExpandedIds(new Set()), []);

  useEffect(() => {
    async function fetchValidations() {
      if (!apiKey) return;
      try {
        setLoading(true);
        setError(null);

        const query = `
          SELECT
            timestamp,
            email_local_part || '@' || domain as email,
            decision,
            risk_score,
            block_reason,
            country,
            pattern_type,
            is_disposable,
            is_free_provider,
            entropy_score,
            bot_score,
            tld_risk_score,
            domain_reputation_score,
            model_version,
            latency,
            client_ip,
            fingerprint_hash,
            decision_tree_reason,
            pattern_confidence
          FROM validations
          WHERE timestamp >= datetime('now', '-${hours} hours')
          ORDER BY timestamp DESC
          LIMIT 500
        `;

        const API_BASE = import.meta.env.PUBLIC_API_URL || 'https://fraud.erfi.dev';
        const response = await fetch(`${API_BASE}/admin/analytics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          body: JSON.stringify({ query }),
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();
        setValidations(data.results || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load validations');
      } finally {
        setLoading(false);
      }
    }
    fetchValidations();
  }, [apiKey, hours]);

  // Clear expanded rows when page changes
  useEffect(() => { setExpandedIds(new Set()); }, [page]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Validations</CardTitle>
          <CardDescription>Loading validation data...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-10 bg-muted/50 rounded animate-pulse"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle size={20} />
            Failed to Load Validations
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pageNumbers = getPageNumbers(page, totalPages);
  const paginationStart = startIndex + 1;
  const paginationEnd = Math.min(startIndex + pageSize, totalItems);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle>Recent Validations</CardTitle>
            <CardDescription>
              Email validation attempts in the last {hours} hours ({validations.length} total)
            </CardDescription>
          </div>
          {expandedIds.size > 0 && (
            <Button variant="ghost" size="sm" onClick={collapseAll} className="gap-1.5 text-muted-foreground hover:text-foreground">
              <X size={14} />
              Collapse all ({expandedIds.size})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="border border-border rounded-lg overflow-hidden mx-6 mb-6">
          <div className="overflow-x-auto">
            <table className="w-full min-w-full table-fixed" aria-label="Recent email validations">
              <colgroup>
                <col className="w-[140px]" />
                <col className="w-[220px]" />
                <col className="w-[90px]" />
                <col className="w-[70px]" />
                <col className="w-[180px]" />
                <col className="w-[80px]" />
                <col className="w-[140px]" />
              </colgroup>
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Timestamp</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Email</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Decision</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Risk</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Block Reason</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Country</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Pattern</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No validations found in the last {hours} hours
                    </td>
                  </tr>
                ) : (
                  pageItems.map((validation, idx) => {
                    const globalIdx = startIndex + idx;
                    const isExpanded = expandedIds.has(globalIdx);
                    return (
                      <React.Fragment key={`row-${globalIdx}`}>
                        <tr
                          className={cn(
                            'border-t border-border cursor-pointer select-none transition-colors',
                            isExpanded ? 'bg-muted/30 hover:bg-muted/40' : 'hover:bg-muted/20',
                          )}
                          onClick={() => toggleExpanded(globalIdx)}
                        >
                          <td className="px-3 py-3 text-sm text-foreground whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <ChevronExpand
                                size={14}
                                className={cn(
                                  'text-muted-foreground flex-shrink-0 transition-transform duration-150',
                                  isExpanded && 'rotate-90',
                                )}
                              />
                              {new Date(validation.timestamp).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-sm">
                            <div className="font-mono text-xs text-foreground truncate" title={validation.email}>
                              {validation.email}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <DecisionBadge decision={validation.decision} />
                          </td>
                          <td className="px-3 py-3">
                            <RiskBadge score={validation.risk_score} />
                          </td>
                          <td className="px-3 py-3 text-sm text-muted-foreground">
                            <div className="truncate" title={validation.block_reason || ''}>
                              {validation.block_reason || '—'}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-sm text-foreground">
                            <div className="truncate">{validation.country || '—'}</div>
                          </td>
                          <td className="px-3 py-3 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1 truncate">
                              <span className="truncate">{validation.pattern_type || '—'}</span>
                              {!!validation.is_disposable && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive border border-destructive/20 flex-shrink-0">
                                  disposable
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-t border-border/50 bg-muted/20">
                            <td colSpan={7} className="px-6 py-4">
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
                                <DetailField label="Entropy" value={validation.entropy_score?.toFixed(3)} />
                                <DetailField label="Bot Score" value={validation.bot_score?.toFixed(2)} />
                                <DetailField label="TLD Risk" value={validation.tld_risk_score?.toFixed(3)} />
                                <DetailField label="Domain Reputation" value={validation.domain_reputation_score?.toFixed(3)} />
                                <DetailField label="Pattern Confidence" value={validation.pattern_confidence?.toFixed(3)} />
                                <DetailField label="Model Version" value={validation.model_version} />
                                <DetailField label="Latency" value={validation.latency ? `${validation.latency.toFixed(1)}ms` : undefined} />
                                <DetailField label="Free Provider" value={validation.is_free_provider ? 'Yes' : 'No'} />
                                <DetailField label="Tree Reason" value={validation.decision_tree_reason} />
                                <DetailField label="Fingerprint" value={validation.fingerprint_hash?.slice(0, 12)} />
                                <DetailField label="Client IP" value={validation.client_ip} />
                              </div>
                              {/* Label correction buttons */}
                              <LabelCorrection email={validation.email} decision={validation.decision} apiKey={apiKey} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalItems > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 border-t border-border bg-muted/20 gap-3">
              {/* Left: item range + page size */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {paginationStart}–{paginationEnd} of {totalItems} validations
                </span>
                <select
                  value={pageSize}
                  onChange={e => setPageSize(Number(e.target.value))}
                  className="text-xs text-muted-foreground bg-transparent border border-border rounded px-1.5 py-1 cursor-pointer hover:border-muted-foreground/40 focus:outline-none focus:border-primary/50"
                >
                  {PAGE_SIZE_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt} / page</option>
                  ))}
                </select>
              </div>

              {/* Right: page navigation */}
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setPage(1)} disabled={page === 1} title="First page" className="h-7 w-7 p-0">
                    <ChevronsLeft size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPage(page - 1)} disabled={page === 1} title="Previous" className="h-7 w-7 p-0">
                    <ChevronLeft size={14} />
                  </Button>

                  {pageNumbers.map((p, i) =>
                    p === -1 ? (
                      <span key={`ellipsis-${i}`} className="text-xs text-muted-foreground px-1">...</span>
                    ) : (
                      <Button
                        key={p}
                        variant={p === page ? 'outline' : 'ghost'}
                        size="sm"
                        onClick={() => setPage(p)}
                        className={cn(
                          'h-7 min-w-[1.75rem] px-1.5 text-xs tabular-nums',
                          p === page && 'border-primary/50 text-primary',
                        )}
                      >
                        {p}
                      </Button>
                    ),
                  )}

                  <Button variant="ghost" size="sm" onClick={() => setPage(page + 1)} disabled={page === totalPages} title="Next" className="h-7 w-7 p-0">
                    <ChevronRight size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPage(totalPages)} disabled={page === totalPages} title="Last page" className="h-7 w-7 p-0">
                    <ChevronsRight size={14} />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
