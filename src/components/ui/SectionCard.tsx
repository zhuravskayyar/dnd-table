import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type SectionCardProps = {
  children: ReactNode;
  className?: string;
};

export function SectionCard({ children, className }: SectionCardProps) {
  return (
    <div className={cn('rounded-sm border border-[#3a281c] bg-[#0a0705] p-4', className)}>
      {children}
    </div>
  );
}
