import type { ReactNode } from 'react';

type FormFieldProps = {
  label: string;
  children: ReactNode;
};

export function FormField({ label, children }: FormFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm uppercase tracking-[0.2em] text-[#d4af37]">{label}</span>
      {children}
    </label>
  );
}
