import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PlayerCharacter } from '../../types';
import { parseInventoryText, toInventoryText } from '../../utils/inventory';
import { FormField } from '../ui/FormField';
import { SectionCard } from '../ui/SectionCard';

type HostCharacterEditorProps = {
  character: PlayerCharacter;
  disabled: boolean;
  busy: boolean;
  onSave: (character: PlayerCharacter) => Promise<void> | void;
};

export function HostCharacterEditor({
  character,
  disabled,
  busy,
  onSave,
}: HostCharacterEditorProps) {
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    try {
      setLocalError(null);
      void onSave({
        playerId: character.playerId,
        displayName: String(formData.get('displayName') ?? '').trim(),
        bioSummary: String(formData.get('bioSummary') ?? '').trim(),
        backstory: String(formData.get('backstory') ?? '').trim(),
        motivation: String(formData.get('motivation') ?? '').trim(),
        classFantasy: String(formData.get('classFantasy') ?? '').trim(),
        inventory: parseInventoryText(String(formData.get('inventory') ?? '')),
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не вдалося зібрати лист персонажа.');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <SectionCard className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row">
          <FormField label="Ім'я персонажа">
            <input name="displayName" className="rpg-input" defaultValue={character.displayName} disabled={disabled} />
          </FormField>
          <FormField label="Короткий опис">
            <input name="bioSummary" className="rpg-input" defaultValue={character.bioSummary} disabled={disabled} />
          </FormField>
        </div>
        <FormField label="Передісторія">
          <textarea name="backstory" className="rpg-input min-h-24" defaultValue={character.backstory} disabled={disabled} />
        </FormField>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Мотивація">
            <textarea name="motivation" className="rpg-input min-h-20" defaultValue={character.motivation} disabled={disabled} />
          </FormField>
          <FormField label="Фентезі-клас">
            <textarea name="classFantasy" className="rpg-input min-h-20" defaultValue={character.classFantasy} disabled={disabled} />
          </FormField>
        </div>
        <FormField label="Інвентар">
          <textarea
            name="inventory"
            className="rpg-input min-h-28 font-mono text-sm"
            defaultValue={toInventoryText(character)}
            disabled={disabled}
          />
        </FormField>
        {localError ? <p className="text-sm text-[#f2c4c4]">{localError}</p> : null}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[#caa66d]">
            Формат: <code>назва | кількість | тип | опис</code>, один предмет на рядок.
          </p>
          <button type="submit" className="rpg-button rpg-btn-blue rounded-sm px-4 py-2" disabled={disabled}>
            {busy ? 'Зберігаємо...' : 'Зберегти'}
          </button>
        </div>
      </SectionCard>
    </form>
  );
}
