import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
}

interface ValidationTableProps {
  apiKey: string;
  hours?: number;
}

export default function ValidationTable({ apiKey, hours = 24 }: ValidationTableProps) {
  const [validations, setValidations] = useState<Validation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
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
            is_disposable
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
      <div className="rounded-lg border bg-card p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-muted rounded w-full"></div>
          <div className="h-4 bg-muted rounded w-full"></div>
          <div className="h-4 bg-muted rounded w-full"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
        <p className="text-sm font-medium text-destructive">Failed to load validations</p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
      </div>
    );
  }

  const startIndex = page * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedData = validations.slice(startIndex, endIndex);
  const totalPages = Math.ceil(validations.length / pageSize);

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground">Recent Validations</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Email validation attempts in the last {hours} hours
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-4 text-sm font-medium text-muted-foreground">Timestamp</th>
              <th className="text-left p-4 text-sm font-medium text-muted-foreground">Email</th>
              <th className="text-left p-4 text-sm font-medium text-muted-foreground">Decision</th>
              <th className="text-left p-4 text-sm font-medium text-muted-foreground">Risk Score</th>
              <th className="text-left p-4 text-sm font-medium text-muted-foreground">Reason</th>
              <th className="text-left p-4 text-sm font-medium text-muted-foreground">Country</th>
              <th className="text-left p-4 text-sm font-medium text-muted-foreground">Pattern</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No validations found
                </td>
              </tr>
            ) : (
              paginatedData.map((validation, idx) => (
                <tr
                  key={`${validation.timestamp}-${idx}`}
                  className="hover:bg-muted/30 transition-colors"
                >
                  <td className="p-4 text-sm text-foreground">
                    {new Date(validation.timestamp).toLocaleString()}
                  </td>
                  <td className="p-4 text-sm text-foreground font-mono">
                    {validation.email}
                  </td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        validation.decision === 'allow'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : validation.decision === 'block'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                          : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                      }`}
                    >
                      {validation.decision}
                    </span>
                  </td>
                  <td className="p-4">
                    <span
                      className={`text-sm font-semibold ${
                        validation.risk_score >= 70
                          ? 'text-red-600 dark:text-red-400'
                          : validation.risk_score >= 40
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : 'text-green-600 dark:text-green-400'
                      }`}
                    >
                      {validation.risk_score.toFixed(1)}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground max-w-xs truncate">
                    {validation.block_reason || '-'}
                  </td>
                  <td className="p-4 text-sm text-foreground">
                    {validation.country || '-'}
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {validation.pattern_type || '-'}
                    {validation.is_disposable && (
                      <span className="ml-1 text-xs text-destructive">(disposable)</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-4 border-t border-border flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {startIndex + 1}-{Math.min(endIndex, validations.length)} of {validations.length}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 0}
            >
              <ChevronLeft size={16} />
              Previous
            </Button>
            <span className="text-sm text-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages - 1}
            >
              Next
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
