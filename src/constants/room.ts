import type { CampaignFilters, CreateRoomRequest, SessionType } from '../types';

export const LANGUAGE_OPTIONS = ['Українська', 'English'] as const;
export const SESSION_TYPE_OPTIONS: SessionType[] = ['Один постріл', 'Коротка', 'Довга'];
export const MAX_PLAYERS_PER_ROOM = 8;

export type FilterFieldConfig = {
  key: Exclude<keyof CampaignFilters, 'worldConcept'>;
  label: string;
  options: string[];
};

export const FILTER_FIELD_CONFIG: FilterFieldConfig[] = [
  {
    key: 'setting',
    label: 'Сетинг',
    options: [
      'Темне фентезі',
      'Високе фентезі',
      'Меч і чаклунство',
      'Готичний жах',
      'Міське фентезі',
      'Кіберпанк',
      'Постапокаліптична технофантазія',
      'Стімпанк',
      'Космоопера',
    ],
  },
  {
    key: 'tone',
    label: 'Тон',
    options: [
      'Похмурий та серйозний',
      'Героїчний',
      'Містичний',
      'Політична інтрига',
      'Виживання',
      'Трагікомічний',
      'Абсурдний',
    ],
  },
  {
    key: 'structure',
    label: 'Структура',
    options: [
      'Дослідження підземель',
      'Пісочниця',
      'Лінійний сюжет',
      'Розслідування',
      'Пограбування',
      'Експедиція',
      'Війна фракцій',
    ],
  },
  {
    key: 'combatIntensity',
    label: 'Інтенсивність бою',
    options: ['Дуже висока', 'Висока', 'Середня', 'Низька'],
  },
  {
    key: 'magicLevel',
    label: 'Магія',
    options: ['Дуже низька магія', 'Низька магія', 'Середня магія', 'Висока магія', 'Нестабільна магія'],
  },
  {
    key: 'darknessLevel',
    label: 'Жорсткість',
    options: ['Сімейний', 'Стандартний', 'Темний', 'Жорсткий'],
  },
];

export function createDefaultFilters(): CampaignFilters {
  return {
    setting: 'Темне фентезі',
    tone: 'Похмурий та серйозний',
    structure: 'Дослідження підземель',
    combatIntensity: 'Висока',
    magicLevel: 'Середня магія',
    darknessLevel: 'Стандартний',
    worldConcept: '',
  };
}

export function createDefaultHostForm(): CreateRoomRequest {
  return {
    hostName: 'Майстер',
    title: 'Тінь Короля Ліча',
    language: 'Українська',
    filters: createDefaultFilters(),
    sessionType: 'Один постріл',
  };
}
