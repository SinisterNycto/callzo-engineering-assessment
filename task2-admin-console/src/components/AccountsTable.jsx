import { useEffect, useRef } from 'react';
import { formatCents, formatDay, formatNumber } from '../lib/format.js';
import { Link } from './Link.jsx';
import { PlanBadge, StatusBadge } from './ui/Badge.jsx';
import { Skeleton } from './ui/States.jsx';

// `hide` = Tailwind classes that hide a column below a breakpoint, so at
// 375px only checkbox / name / cost / action remain.
const COLUMNS = [
  { key: 'name', label: 'Account', sortable: true },
  { key: 'company', label: 'Company', sortable: true, hide: 'hidden md:table-cell' },
  { key: 'country', label: 'Country', sortable: true, hide: 'hidden xl:table-cell' },
  { key: 'plan', label: 'Plan', sortable: true, hide: 'hidden sm:table-cell' },
  { key: 'status', label: 'Status', sortable: true, hide: 'hidden lg:table-cell' },
  { key: 'signup_date', label: 'Signed up', sortable: true, hide: 'hidden xl:table-cell' },
  { key: 'current_month_minutes', label: 'Minutes', sortable: true, numeric: true, hide: 'hidden md:table-cell' },
  { key: 'current_month_sms', label: 'SMS', sortable: true, numeric: true, hide: 'hidden lg:table-cell' },
  { key: 'cost_cents', label: 'Cost', sortable: true, numeric: true, width: 'w-28 md:w-auto' },
  { key: 'last_active', label: 'Last active', sortable: true, hide: 'hidden 2xl:table-cell' },
];

const SKELETON_ROWS = 10;
const ROW_HEIGHT = 'h-[60px]';

function SortIcon({ direction }) {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
      <path d="M6 2 9 5H3z" fill="currentColor" opacity={direction === 'asc' ? 1 : 0.25} />
      <path d="M6 10 3 7h6z" fill="currentColor" opacity={direction === 'desc' ? 1 : 0.25} />
    </svg>
  );
}

function HeaderCell({ column, sortBy, sortDir, onSort }) {
  const active = sortBy === column.key;
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined;
  const nextDir = active && sortDir === 'asc' ? 'desc' : 'asc';
  return (
    <th scope="col" aria-sort={ariaSort} className={`px-3 py-2.5 font-semibold ${column.numeric ? 'text-right' : 'text-left'} ${column.hide ?? ''} ${column.width ?? ''}`}>
      <button
        type="button"
        onClick={() => onSort(column.key, nextDir)}
        className={`inline-flex items-center gap-1 rounded-md px-1 -mx-1 hover:text-ink ${active ? 'text-ink' : ''} ${column.numeric ? 'flex-row-reverse' : ''}`}
      >
        {column.label}
        <SortIcon direction={active ? sortDir : null} />
        <span className="sr-only">, sort {nextDir === 'asc' ? 'ascending' : 'descending'}</span>
      </button>
    </th>
  );
}

// Changed values get a short highlight. The `key` change remounts just this
// span, which replays the CSS animation; nothing else in the row re-mounts.
function LiveValue({ changed, tick, children }) {
  return (
    <span key={changed ? `t${tick}` : 'static'} className={`-mx-1 rounded px-1 ${changed ? 'animate-flash' : ''}`}>
      {children}
    </span>
  );
}

function PageCheckbox({ rows, selected, onSelectPage }) {
  const ref = useRef(null);
  const onPage = rows.filter((r) => selected.has(r.id)).length;
  const all = rows.length > 0 && onPage === rows.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = onPage > 0 && !all;
  }, [onPage, all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-4 accent-brand-600"
      checked={all}
      disabled={rows.length === 0}
      onChange={() => onSelectPage(rows, !all)}
      aria-label="Select all accounts on this page"
    />
  );
}

export function AccountsTable({ rows, loading, busy, sortBy, sortDir, onSort, selected, onToggle, onSelectPage, changed, changeTick, caption }) {
  return (
    <table className="w-full table-fixed border-collapse text-sm md:table-auto" aria-busy={busy || loading}>
      <caption className="sr-only">{caption}</caption>
      <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
        <tr>
          <th scope="col" className="w-11 py-2.5 pl-4 pr-1 text-left">
            <PageCheckbox rows={rows} selected={selected} onSelectPage={onSelectPage} />
          </th>
          {COLUMNS.map((column) => (
            <HeaderCell key={column.key} column={column} sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          ))}
          <th scope="col" className="w-20 py-2.5 pl-3 pr-4 text-right"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody className={`divide-y divide-line transition-opacity ${busy ? 'opacity-55' : ''}`}>
        {loading
          ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <tr key={i} className={ROW_HEIGHT}>
              <td className="pl-4 pr-1"><Skeleton className="size-4" /></td>
              {COLUMNS.map((c) => (
                <td key={c.key} className={`px-3 ${c.hide ?? ''}`}><Skeleton className={`h-3.5 ${c.key === 'name' ? 'w-32' : 'w-14'} ${c.numeric ? 'ml-auto' : ''}`} /></td>
              ))}
              <td className="pr-4" />
            </tr>
          ))
          : rows.map((row) => {
            const isSelected = selected.has(row.id);
            const rowChanges = changed.get(row.id);
            const live = (field, content) => <LiveValue changed={rowChanges?.has(field)} tick={changeTick}>{content}</LiveValue>;
            return (
              <tr key={row.id} className={`${ROW_HEIGHT} ${isSelected ? 'bg-brand-50/60' : 'hover:bg-canvas/70'}`}>
                <td className="py-2 pl-4 pr-1">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={isSelected}
                    onChange={() => onToggle(row)}
                    aria-label={`Select ${row.name}, ${row.company}`}
                  />
                </td>
                <td className="truncate px-3 py-2">
                  <p className="truncate font-semibold">{row.name}</p>
                  <p className="truncate text-xs text-muted">
                    <span className="md:hidden">{row.company} · </span>{row.email}
                  </p>
                </td>
                <td className="hidden truncate px-3 py-2 md:table-cell">{row.company}</td>
                <td className="hidden px-3 py-2 xl:table-cell">{row.country}</td>
                <td className="hidden px-3 py-2 sm:table-cell">{live('plan', <PlanBadge plan={row.plan} />)}</td>
                <td className="hidden px-3 py-2 lg:table-cell">{live('status', <StatusBadge status={row.status} />)}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-ink-soft xl:table-cell">{formatDay(row.signup_date)}</td>
                <td className="tabular hidden px-3 py-2 text-right md:table-cell">{live('current_month_minutes', formatNumber(row.current_month_minutes))}</td>
                <td className="tabular hidden px-3 py-2 text-right lg:table-cell">{live('current_month_sms', formatNumber(row.current_month_sms))}</td>
                <td className="tabular whitespace-nowrap px-3 py-2 text-right font-semibold">{live('cost_cents', formatCents(row.cost_cents))}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-ink-soft 2xl:table-cell">{live('last_active', formatDay(row.last_active))}</td>
                <td className="py-2 pl-3 pr-4 text-right">
                  <Link
                    href={`/accounts/${row.id}/settings`}
                    className="inline-flex h-8 items-center rounded-full border border-line bg-white px-3 text-xs font-semibold hover:bg-canvas"
                  >
                    Edit<span className="sr-only"> settings for {row.name}</span>
                  </Link>
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}
