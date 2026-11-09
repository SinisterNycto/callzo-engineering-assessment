import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { AccountsTable } from '../components/AccountsTable.jsx';
import { DateRangeFilter } from '../components/DateRangeFilter.jsx';
import { StatTiles } from '../components/StatTiles.jsx';
import { UsageChart } from '../components/UsageChart.jsx';
import { Button } from '../components/ui/Button.jsx';
import { inputClass, selectClass } from '../components/ui/Field.jsx';
import { EmptyState, ErrorState, RefreshBar } from '../components/ui/States.jsx';
import { useAccounts } from '../hooks/useAccounts.js';
import { useDebouncedCallback } from '../hooks/useDebouncedCallback.js';
import { navigate } from '../hooks/useLocation.js';
import { useSummary } from '../hooks/useSummary.js';
import { accountsToCsv } from '../lib/csv.js';
import { formatDay, formatNumber, formatTime } from '../lib/format.js';
import {
  COUNTRIES, PAGE_SIZES, PLANS, STATUSES, clearFilters, hasActiveFilters,
  queryFromSearch, searchFromQuery, toApiParams, updateQuery,
} from '../lib/query.js';
import { capitalise } from '../lib/settingsForm.js';

const SORT_LABELS = {
  id: 'ID', name: 'name', company: 'company', country: 'country', plan: 'plan', status: 'status',
  signup_date: 'signup date', current_month_minutes: 'minutes', current_month_sms: 'SMS',
  cost_cents: 'cost', last_active: 'last active',
};

function LiveToggle({ on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="inline-flex h-10 items-center gap-2.5 rounded-full border border-line bg-white pl-2 pr-4 text-sm font-semibold"
    >
      <span aria-hidden="true" className={`relative h-6 w-10 rounded-full transition-colors ${on ? 'bg-brand-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-1 size-4 rounded-full bg-white shadow transition-[left] ${on ? 'left-5' : 'left-1'}`} />
      </span>
      Live updates
    </button>
  );
}

function SearchBox({ value, onSearch }) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const debounced = useDebouncedCallback(onSearch, 350);

  return (
    <form
      role="search"
      className="min-w-0 flex-1 basis-full sm:basis-64"
      onSubmit={(e) => {
        e.preventDefault();
        debounced.cancel();
        onSearch(text);
      }}
    >
      <label htmlFor={id} className="sr-only">Search accounts</label>
      <div className="relative">
        <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3 3" strokeLinecap="round" />
        </svg>
        <input
          id={id}
          type="search"
          className={`${inputClass} pl-9`}
          placeholder="Search name, email or company"
          value={text}
          maxLength={100}
          onChange={(e) => {
            setText(e.target.value);
            debounced(e.target.value);
          }}
        />
      </div>
    </form>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1 sm:flex-none">
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} className={`${selectClass} sm:w-36`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{label}</option>
        {options.map((o) => <option key={o} value={o}>{o.length === 2 ? o : capitalise(o)}</option>)}
      </select>
    </div>
  );
}

function downloadCsv(rows) {
  const blob = new Blob([accountsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `callzo-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function SelectionBar({ selection, rowsOnPage }) {
  const count = selection.selected.size;
  const onPage = rowsOnPage.filter((r) => selection.selected.has(r.id)).length;
  return (
    <div role="status" className="min-h-0">
      {count > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-brand-50/70 px-4 py-2.5 text-sm">
          <p>
            <span className="font-bold">{formatNumber(count)} selected</span>
            <span className="text-muted"> · {onPage} on this page</span>
          </p>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => downloadCsv([...selection.selected.values()])}>Export CSV</Button>
            <Button size="sm" variant="ghost" onClick={selection.clear}>Clear</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const id = useId();
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      <p className="tabular text-muted">
        {total === 0 ? 'No results' : <>Showing <b className="text-ink">{formatNumber(first)}–{formatNumber(last)}</b> of {formatNumber(total)}</>}
      </p>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">Rows per page</label>
        <select id={id} className={`${selectClass} h-8 w-[5.5rem] text-xs`} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
        </select>
        <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <span aria-hidden="true">←</span><span className="hidden sm:inline">Prev</span>
        </Button>
        <span className="tabular whitespace-nowrap text-muted" aria-current="page">{page} / {formatNumber(lastPage)}</span>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= lastPage} aria-label="Next page">
          <span className="hidden sm:inline">Next</span><span aria-hidden="true">→</span>
        </Button>
      </div>
    </nav>
  );
}

export function OverviewPage({ search, selection }) {
  const query = useMemo(() => queryFromSearch(search), [search]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const accounts = useAccounts(toApiParams(query).toString(), { autoRefresh });
  const summary = useSummary(query.dateFrom, query.dateTo, { autoRefresh });

  // Typing in search replaces the history entry; everything else pushes one,
  // so Back undoes the last filter/sort/page change.
  const setQuery = useCallback((patch, { replace = false } = {}) => {
    navigate(`/${searchFromQuery(updateQuery(query, patch))}`, { replace });
  }, [query]);

  const rows = useMemo(() => accounts.data?.data ?? [], [accounts.data]);
  const total = accounts.data?.total ?? 0;
  const { syncRows } = selection;
  useEffect(() => syncRows(rows), [rows, syncRows]);

  // If filters or drift leave us past the last page, step back to it.
  useEffect(() => {
    if (accounts.status === 'success' && rows.length === 0 && total > 0 && query.page > 1) {
      setQuery({ page: Math.ceil(total / query.pageSize) }, { replace: true });
    }
  }, [accounts.status, rows.length, total, query.page, query.pageSize, setQuery]);

  const filtered = hasActiveFilters(query);
  const rangeText = query.dateFrom || query.dateTo
    ? `signed up ${query.dateFrom ? `from ${formatDay(query.dateFrom)}` : ''} ${query.dateTo ? `to ${formatDay(query.dateTo)}` : ''}`.trim()
    : 'all signup dates';
  const caption = `Accounts, ${rangeText}, sorted by ${SORT_LABELS[query.sortBy]} ${query.sortDir === 'asc' ? 'ascending' : 'descending'}, page ${query.page}.`;

  let tableBody;
  if (accounts.status === 'error') {
    tableBody = <ErrorState title="Couldn't load accounts" message={accounts.error?.message} onRetry={accounts.retry} />;
  } else if (accounts.status === 'success' && rows.length === 0 && total === 0) {
    tableBody = (
      <EmptyState
        title="No accounts match"
        message={filtered ? 'Nothing matches these filters. Try removing one.' : 'There are no accounts yet.'}
        action={filtered && <Button size="sm" onClick={() => navigate(`/${searchFromQuery(clearFilters(query))}`)}>Clear filters</Button>}
      />
    );
  } else {
    tableBody = (
      <AccountsTable
        rows={rows}
        loading={accounts.status === 'loading'}
        busy={accounts.status === 'refreshing'}
        sortBy={query.sortBy}
        sortDir={query.sortDir}
        onSort={(sortBy, sortDir) => setQuery({ sortBy, sortDir })}
        selected={selection.selected}
        onToggle={selection.toggle}
        onSelectPage={selection.setMany}
        changed={accounts.changed}
        changeTick={accounts.changeTick}
        caption={caption}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Accounts <span aria-hidden="true">›</span> Overview</p>
          <h1 tabIndex={-1} className="mt-1 text-3xl font-bold tracking-tight focus:outline-none sm:text-4xl">
            Account <span className="font-serif text-[1.15em] font-normal italic">usage</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {accounts.data ? `${formatNumber(total)} accounts` : 'Loading accounts'} · {rangeText}
            {accounts.updatedAt && <> · updated {formatTime(accounts.updatedAt)}</>}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
          <DateRangeFilter from={query.dateFrom} to={query.dateTo} onChange={setQuery} />
          <LiveToggle on={autoRefresh} onChange={setAutoRefresh} />
        </div>
      </header>

      <StatTiles summary={summary} />
      <UsageChart summary={summary} />

      <section aria-labelledby="accounts-title" className="relative overflow-hidden rounded-2xl border border-line bg-white">
        <RefreshBar active={accounts.status === 'refreshing'} />
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <h2 id="accounts-title" className="mr-2 w-full font-bold sm:w-auto">Accounts</h2>
          <SearchBox value={query.search} onSearch={(text) => setQuery({ search: text }, { replace: true })} />
          <FilterSelect label="Status" value={query.status} options={STATUSES} onChange={(status) => setQuery({ status })} />
          <FilterSelect label="Plan" value={query.plan} options={PLANS} onChange={(plan) => setQuery({ plan })} />
          <FilterSelect label="Country" value={query.country} options={COUNTRIES} onChange={(country) => setQuery({ country })} />
          {filtered && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/${searchFromQuery(clearFilters(query))}`)}>Clear filters</Button>
          )}
        </div>

        {accounts.pending && (
          <div role="status" className="flex flex-wrap items-center gap-3 border-b border-line bg-amber-50 px-4 py-2.5 text-sm">
            <p>Rows on this page have changed since you loaded it.</p>
            <Button size="sm" variant="secondary" onClick={accounts.showPending}>Show latest</Button>
          </div>
        )}
        {accounts.refreshError && accounts.status === 'success' && (
          <div role="status" className="flex flex-wrap items-center gap-3 border-b border-line bg-rose-50 px-4 py-2.5 text-sm text-rose-900">
            <p>Couldn't refresh. Showing data from {formatTime(accounts.updatedAt)}.</p>
            <Button size="sm" variant="secondary" onClick={accounts.retry}>Retry</Button>
          </div>
        )}
        <SelectionBar selection={selection} rowsOnPage={rows} />

        <div className="overflow-x-auto">{tableBody}</div>

        {accounts.data && accounts.status !== 'error' && total > 0 && (
          <Pagination
            page={query.page}
            pageSize={query.pageSize}
            total={total}
            onPage={(page) => setQuery({ page })}
            onPageSize={(pageSize) => setQuery({ pageSize })}
          />
        )}
      </section>
    </div>
  );
}
