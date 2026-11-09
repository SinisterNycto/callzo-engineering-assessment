const VARIANTS = {
  primary: 'bg-ink text-white hover:bg-ink-soft shadow-sm',
  brand: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-white text-ink border border-line hover:bg-canvas',
  ghost: 'text-ink-soft hover:bg-black/5',
  danger: 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50',
};

const SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
