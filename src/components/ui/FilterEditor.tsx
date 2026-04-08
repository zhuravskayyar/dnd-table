import { FILTER_FIELD_CONFIG } from '../../constants/room';
import type { CampaignFilters } from '../../types';
import { FormField } from './FormField';

type FilterEditorProps = {
  filters: CampaignFilters;
  onChange: (filters: CampaignFilters) => void;
};

export function FilterEditor({ filters, onChange }: FilterEditorProps) {
  const handleFilterChange = <K extends keyof CampaignFilters>(key: K, value: CampaignFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="space-y-3">
      {FILTER_FIELD_CONFIG.map((field) => (
        <div key={field.key}>
          <FormField label={field.label}>
            <select
              className="rpg-input"
              value={filters[field.key]}
              onChange={(event) => handleFilterChange(field.key, event.target.value)}
            >
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      ))}

      <div>
        <FormField label="Концепт світу">
          <textarea
            className="rpg-input min-h-32 resize-y"
            value={filters.worldConcept}
            onChange={(event) => handleFilterChange('worldConcept', event.target.value)}
            placeholder="Опиши ядро світу, головний конфлікт, особливі правила реальності, ключові фракції або атмосферну ідею."
          />
        </FormField>
        <p className="mt-2 text-sm leading-6 text-[#bba389]">
          Вільний опис, який майстер використовує як авторський задум світу. Сюди можна вписати власну ідею кампанії без обмеження preset-ами.
        </p>
      </div>

      <div>
        <label className="flex cursor-pointer items-center gap-3 rounded-sm border border-[#5c4033] bg-[rgba(10,7,5,0.6)] px-4 py-3 transition hover:bg-[rgba(20,14,10,0.8)]">
          <input
            type="checkbox"
            checked={filters.noviceMode ?? false}
            onChange={(event) => handleFilterChange('noviceMode', event.target.checked)}
            className="h-4 w-4 accent-[#d4af37]"
          />
          <div>
            <span className="text-sm font-semibold text-[#f3deac]">Режим новачка</span>
            <p className="mt-0.5 text-xs leading-5 text-[#bba389]">
              М'якша класифікація дій, підказки після кожної відповіді майстра та навчальні приклади на старті.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}
