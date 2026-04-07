import type { PlayerCharacter } from '../../types';
import { SectionCard } from '../ui/SectionCard';

type CharacterSheetCardProps = {
  character: PlayerCharacter;
  compact?: boolean;
};

export function CharacterSheetCard({ character, compact = false }: CharacterSheetCardProps) {
  return (
    <SectionCard>
      <div className="mb-2 flex items-center justify-between gap-4">
        <h3 className="text-lg rpg-title">{character.displayName}</h3>
        <span className="text-xs uppercase tracking-[0.2em] text-[#d4af37]">{character.classFantasy}</span>
      </div>
      <p className="mb-3 text-sm rpg-text">{character.bioSummary}</p>
      {!compact ? <p className="mb-3 text-sm whitespace-pre-wrap rpg-text">{character.backstory}</p> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="border border-[#2b2018] bg-[rgba(255,255,255,0.03)] p-3">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#d4af37]">Мотивація</p>
          <p className="text-sm whitespace-pre-wrap rpg-text">{character.motivation}</p>
        </div>
        <div className="border border-[#2b2018] bg-[rgba(255,255,255,0.03)] p-3">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#d4af37]">Інвентар</p>
          <ul className="space-y-2">
            {character.inventory.map((item) => (
              <li key={`${item.name}-${item.kind}`} className="text-sm text-[#e6d5c3]">
                <strong>{item.name}</strong> x{item.quantity}
                <div className="text-xs text-[#c6b39f]">{item.kind} • {item.description}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}
