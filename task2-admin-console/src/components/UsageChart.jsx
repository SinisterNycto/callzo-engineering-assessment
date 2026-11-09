import { useId, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCents, formatCentsCompact, formatCompact, formatDay, formatDayShort, formatMonth, formatNumber, formatTime } from '../lib/format.js';
import { METRICS, bucketSeries } from '../lib/series.js';
import { EmptyState, ErrorState, RefreshBar, Skeleton } from './ui/States.jsx';

const CHART_HEIGHT = 280;

const GRANULARITY_LABEL = { day: 'per day', week: 'per week', month: 'per month' };

function formatValue(metric, value, compact = false) {
  if (metric === 'cost') return compact ? formatCentsCompact(value) : formatCents(value);
  return compact ? formatCompact(value) : formatNumber(value);
}

function formatTick(granularity, iso) {
  return granularity === 'month' ? formatMonth(iso) : formatDayShort(iso);
}

function ChartTooltip({ active, payload, metric, granularity }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const prefix = { day: '', week: 'Week of ', month: '' }[granularity];
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 text-sm shadow-lg">
      <p className="text-xs text-muted">{prefix}{granularity === 'month' ? formatMonth(point.date) : formatDay(point.date)}</p>
      <p className="tabular font-bold">{formatValue(metric, point[METRICS[metric].field])} <span className="font-medium text-muted">{METRICS[metric].label.toLowerCase()}</span></p>
      {point.partial && <p className="text-xs text-amber-700">Partial {granularity}: the range covers only part of it</p>}
    </div>
  );
}

function MetricToggle({ value, onChange }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Metric" className="inline-flex rounded-full border border-line bg-canvas p-1">
      {Object.entries(METRICS).map(([key, { label }]) => (
        <label
          key={key}
          className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600 ${
            value === key ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          <input type="radio" name={name} value={key} checked={value === key} onChange={() => onChange(key)} className="sr-only" />
          {label}
        </label>
      ))}
    </div>
  );
}

export function UsageChart({ summary }) {
  const [metric, setMetric] = useState('minutes');
  const series = summary.data?.series;
  const { granularity, points } = useMemo(() => bucketSeries(series ?? []), [series]);
  const field = METRICS[metric].field;

  const peak = points.reduce((best, p) => (p[field] > (best?.[field] ?? -1) ? p : best), null);
  const description = points.length
    ? `${METRICS[metric].label} ${GRANULARITY_LABEL[granularity]}, ${formatDay(points[0].date)} to ${formatDay(points[points.length - 1].date)}. Peak ${formatValue(metric, peak[field])}.`
    : '';

  let body;
  if (summary.status === 'loading') {
    body = <Skeleton className="h-full w-full rounded-xl" />;
  } else if (summary.status === 'error') {
    body = <ErrorState compact title="Couldn't load the chart" message="The summary service failed three times in a row. The accounts table below isn't affected." onRetry={summary.retry} />;
  } else if (points.length === 0) {
    body = <EmptyState title="No usage in this range" message="Try a wider signup date range." />;
  } else {
    body = (
      <div role="img" aria-label={description} className="h-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-data)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--color-data)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eceef2" strokeDasharray="3 4" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => formatTick(granularity, d)}
              tick={{ fontSize: 11, fill: '#5f6878' }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />
            <YAxis
              tickFormatter={(v) => formatValue(metric, v, true)}
              tick={{ fontSize: 11, fill: '#5f6878' }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip content={<ChartTooltip metric={metric} granularity={granularity} />} cursor={{ stroke: '#c7cdd8' }} />
            <Area
              type="monotone"
              dataKey={field}
              stroke="var(--color-data)"
              strokeWidth={2}
              fill="url(#usageFill)"
              // Animating on every poll makes the chart twitch; draw it once.
              isAnimationActive={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <section aria-labelledby="chart-title" aria-busy={summary.status === 'refreshing'} className="relative rounded-2xl border border-line bg-white p-4 sm:p-5">
      <RefreshBar active={summary.status === 'refreshing'} />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="chart-title" className="font-bold">Usage by signup date</h2>
          <p className="text-sm text-muted">
            {summary.data ? `${METRICS[metric].label} ${GRANULARITY_LABEL[granularity]} for accounts that signed up in the range` : 'Accounts that signed up in the range'}
            {points.length > 1 && points[points.length - 1].partial && ` · last ${granularity} is partial`}
          </p>
        </div>
        <MetricToggle value={metric} onChange={setMetric} />
      </div>
      <div style={{ height: CHART_HEIGHT }}>{body}</div>
      {summary.refreshError && summary.data && (
        <p className="mt-3 text-xs text-muted" role="status">
          Couldn't refresh. Showing data from {formatTime(summary.updatedAt)}.{' '}
          <button type="button" className="font-semibold text-brand-700 underline underline-offset-2" onClick={summary.retry}>Retry now</button>
        </p>
      )}
    </section>
  );
}
