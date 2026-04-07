import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Panel } from './Panel';

type SectionPanelProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function SectionPanel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: SectionPanelProps) {
  return (
    <Panel as="section" tone="sub" className={cn('p-5', className)}>
      <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl rpg-title">{title}</h2>
          {subtitle ? <p className="rpg-text text-sm">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      <div className={bodyClassName}>{children}</div>
    </Panel>
  );
}
