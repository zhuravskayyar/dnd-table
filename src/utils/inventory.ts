import type { InventoryItem, PlayerCharacter } from '../types';

export function toInventoryText(character: PlayerCharacter) {
  return character.inventory
    .map((item) => `${item.name} | ${item.quantity} | ${item.kind} | ${item.description}`)
    .join('\n');
}

export function parseInventoryText(text: string): InventoryItem[] {
  const rows = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (rows.length === 0) {
    throw new Error('Інвентар не може бути порожнім.');
  }

  return rows.map((row) => {
    const [name, quantityText, kind, ...descriptionParts] = row.split('|').map((part) => part.trim());
    const quantity = Number(quantityText);
    const description = descriptionParts.join(' | ').trim();

    if (!name || !quantityText || !kind || !description) {
      throw new Error('Кожен рядок інвентарю має мати формат: назва | кількість | тип | опис.');
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('Кількість в інвентарі має бути цілим числом від 1.');
    }

    return { name, quantity, kind, description };
  });
}
