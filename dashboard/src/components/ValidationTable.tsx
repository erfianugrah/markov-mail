import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Button } from './ui/button';

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

function RiskBadge({ score }: { score: number }) {
  const getColorClass = () => {
    if (score >= 70) return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800';
    if (score >= 40) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
    return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800';
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getColorClass()}`}>
      {score.toFixed(1)}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  const getColorClass = () => {
    if (decision === 'allow') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800';
    if (decision === 'block') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800';
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getColorClass()}`}>
      {decision}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="font-mono text-xs text-foreground mt-0.5 truncate" title={value || ''}>
        {value || '—'}
      </div>
    </div>
  );
}

export default function ValidationTable({ apiKey, hours = 24 }: ValidationTableProps) {
  const [validations, setValidations] = useState<Validation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const pageSize = 10;

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
          LIMIT 100
        `;

        const API_BASE = import.meta.env.PUBLIC_API_URL || 'https://fraud.erfi.dev';
        const response = await fetch(`${API_BASE}/admin/analytics`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
          },
          body: JSON.stringify({ query }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

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

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Validations</CardTitle>
          <CardDescription>Loading validation data...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-muted/50 rounded animate-pulse"></div>
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

  const startIndex = page * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedData = validations.slice(startIndex, endIndex);
  const totalPages = Math.ceil(validations.length / pageSize);

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
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-foreground">
                    Timestamp
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-foreground">
                    Email
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-foreground">
                    Decision
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-foreground">
                    Risk
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-foreground">
                    Block Reason
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-foreground">
                    Country
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-foreground">
                    Pattern
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No validations found in the last {hours} hours
                    </td>
                  </tr>
                ) : (
                  paginatedData.map((validation, idx) => {
                    const globalIdx = startIndex + idx;
                    const isExpanded = expandedRow === globalIdx;
                    return (
                      <React.Fragment key={`row-${validation.timestamp}-${idx}`}>
                        <tr
                          className="border-t border-border hover:bg-muted/40 transition-colors cursor-pointer"
                          onClick={() => setExpandedRow(isExpanded ? null : globalIdx)}
                        >
                          <td className="px-3 py-3.5 text-sm text-foreground whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {isExpanded ? <ChevronUp size={14} className="text-muted-foreground flex-shrink-0" /> : <ChevronDown size={14} className="text-muted-foreground flex-shrink-0" />}
                              {new Date(validation.timestamp).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 text-sm">
                            <div className="font-mono text-xs text-foreground truncate" title={validation.email}>
                              {validation.email}
                            </div>
                          </td>
                          <td className="px-3 py-3.5">
                            <DecisionBadge decision={validation.decision} />
                          </td>
                          <td className="px-3 py-3.5">
                            <RiskBadge score={validation.risk_score} />
                          </td>
                          <td className="px-3 py-3.5 text-sm text-muted-foreground">
                            <div className="truncate" title={validation.block_reason || ''}>
                              {validation.block_reason || '—'}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 text-sm text-foreground">
                            <div className="truncate" title={validation.country || ''}>
                              {validation.country || '—'}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1 truncate">
                              <span className="truncate" title={validation.pattern_type || ''}>{validation.pattern_type || '—'}</span>
                              {validation.is_disposable && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-destructive/10 text-destructive border border-destructive/20 flex-shrink-0">
                                  disposable
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`detail-${validation.timestamp}-${idx}`} className="border-t border-border/50 bg-muted/20">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-sm">
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
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  Showing <span className="font-medium text-foreground">{startIndex + 1}</span> to{' '}
                  <span className="font-medium text-foreground">{Math.min(endIndex, validations.length)}</span> of{' '}
                  <span className="font-medium text-foreground">{validations.length}</span> results
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 0}
                  className="gap-1"
                >
                  <ChevronLeft size={16} />
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">Page</span>
                  <span className="text-sm font-medium text-foreground">{page + 1}</span>
                  <span className="text-sm text-muted-foreground">of</span>
                  <span className="text-sm font-medium text-foreground">{totalPages}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages - 1}
                  className="gap-1"
                >
                  Next
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
