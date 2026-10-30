import type { ComponentProps, ReactNode } from 'react';

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

type ButtonProps = ComponentProps<'button'> & { variant?: 'primary' | 'ghost' | 'danger' };

export function Button({ variant = 'primary', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border-2 border-ink px-5 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-brand text-white shadow-cta hover:bg-brand-dark',
        variant === 'ghost' && 'bg-white text-ink hover:bg-paper-2',
        variant === 'danger' && 'bg-white text-brand hover:bg-paper-2',
        className,
      )}
      {...props}
    />
  );
}

export const linkClass =
  'font-semibold text-brand underline decoration-2 underline-offset-2 hover:text-brand-dark';

type FieldProps = Omit<ComponentProps<'input'>, 'id'> & {
  id: string;
  label: string;
  hint?: string;
};

export function Field({ id, label, hint, className, ...props }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <input
        id={id}
        name={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cx(
          'min-h-11 rounded-xl border-2 border-ink bg-white px-3.5 text-[15px] placeholder:text-soft',
          className,
        )}
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-xs text-soft">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="rounded-panel border-2 border-ink bg-white p-5 shadow-pop sm:p-6">
      <h2 className="m-0 font-display text-2xl font-semibold">{title}</h2>
      {description && <p className="mt-1 mb-0 text-[13px] text-muted">{description}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function FormMessage({
  kind,
  children,
}: {
  kind: 'error' | 'success';
  children: ReactNode;
}) {
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className={cx(
        'm-0 rounded-xl border-2 px-3.5 py-2.5 text-[13px] font-semibold',
        kind === 'error' ? 'border-brand bg-brand/10 text-brand-dark' : 'border-ink bg-pop/40',
      )}
    >
      {children}
    </p>
  );
}
