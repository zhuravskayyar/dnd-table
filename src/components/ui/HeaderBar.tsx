import { cn } from '../../lib/utils';

type HeaderBarProps = {
  title: string;
  subtitle: string;
  className?: string;
};

export function HeaderBar({ title, subtitle, className }: HeaderBarProps) {
  return (
    <div className={cn('mb-6 border-b-2 border-[#5c4033] pb-4', className)}>
      <h1 className="text-3xl rpg-title">{title}</h1>
      <p className="rpg-text">{subtitle}</p>
    </div>
  );
}
