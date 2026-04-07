import { SectionCard } from '../ui/SectionCard';

type SummaryBlockProps = {
  title: string;
  content: string;
};

export function SummaryBlock({ title, content }: SummaryBlockProps) {
  return (
    <SectionCard>
      <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#d4af37]">{title}</p>
      <p className="rpg-text text-sm whitespace-pre-wrap">{content}</p>
    </SectionCard>
  );
}
