const STATUS_STYLES = {
  active: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  trial: 'bg-amber-50 text-amber-800 ring-amber-200',
  suspended: 'bg-rose-50 text-rose-800 ring-rose-200',
};

const STATUS_DOT = {
  active: 'bg-emerald-500',
  trial: 'bg-amber-500',
  suspended: 'bg-rose-500',
};

const PLAN_STYLES = {
  basic: 'bg-slate-50 text-slate-700 ring-slate-200',
  pro: 'bg-brand-50 text-brand-700 ring-brand-200',
  enterprise: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
};

const base = 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset whitespace-nowrap';

export function StatusBadge({ status }) {
  return (
    <span className={`${base} ${STATUS_STYLES[status] ?? STATUS_STYLES.active}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${STATUS_DOT[status] ?? 'bg-slate-400'}`} />
      {status}
    </span>
  );
}

export function PlanBadge({ plan }) {
  return <span className={`${base} ${PLAN_STYLES[plan] ?? PLAN_STYLES.basic}`}>{plan}</span>;
}
