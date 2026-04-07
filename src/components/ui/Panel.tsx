import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type PanelProps = {
  as?: 'div' | 'section';
  tone?: 'main' | 'sub';
  className?: string;
  children: ReactNode;
};

export function Panel({
  as: Tag = 'div',
  tone = 'sub',
  className,
  children,
}: PanelProps) {
  return (
    <Tag className={cn(tone === 'main' ? 'rpg-main-panel' : 'rpg-sub-panel', className)}>
      {children}
    </Tag>
  );
}
