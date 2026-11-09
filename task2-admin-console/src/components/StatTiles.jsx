import { formatCentsCompact, formatCompact, formatNumber } from '../lib/format.js';
import { sparkline, totals } from '../lib/series.js';
import { Skeleton } from './ui/States.jsx';

const TILES = [
  { key: 'accounts', label: 'Accounts', note: 'signed up in range', spark: 'signups', format: formatNumber },
  { key: 'minutes', label: 'Minutes', note: 'this month, those accounts', spark: 'minutes', format: formatCompact },
  { key: 'sms', label: 'SMS', note: 'this month, those accounts', spark: 'sms', format: formatCompact },
  { key: 'cost_cents', label: 'Billed', note: 'this month, those accounts', spark: 'cost_cents', format: formatCentsCompact },
];

function Sparkbars({ values }) {
  const max = Math.max(...values, 1);
  return (
    <div aria-hidden="true" className="flex h-9 items-end gap-[3px]">
      {values.map((v, i) => (
        <span
          // Bars are positional and never reorder, so the index is a stable key.
          key={i}
          className="w-full rounded-[3px] bg-data/80 transition-[height] duration-500"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function StatTiles({ summary }) {
  const series = summary.data?.series ?? [];
  const sums = totals(series);
  const values = { ...sums, accounts: summary.data?.total_accounts ?? 0 };
  const loading = summary.status === 'loading';
  const failed = summary.status === 'error';

  return (
    <section aria-label="Totals for the selected range" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {TILES.map((tile) => (
        <div key={tile.key} className="min-w-0 rounded-2xl border border-line bg-white p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{tile.label}</p>
          <div className="mt-2 h-9">
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="tabular truncate text-2xl font-bold tracking-tight sm:text-3xl">
                {failed ? <span className="text-slate-300" aria-label="Unavailable">—</span> : tile.format(values[tile.key])}
              </p>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted">{tile.note}</p>
          <div className="mt-3 hidden sm:block">
            {loading || failed ? <Skeleton className={`h-9 w-full ${failed ? 'animate-none opacity-50' : ''}`} /> : <Sparkbars values={sparkline(series, tile.spark)} />}
          </div>
        </div>
      ))}
    </section>
  );
}
