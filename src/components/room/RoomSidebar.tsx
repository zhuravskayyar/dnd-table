import { STRICT_HOST_RULES } from '../../constants/hostRules';
import { MAX_PLAYERS_PER_ROOM } from '../../constants/room';
import type { Room } from '../../types';
import { formatClockTime } from '../../utils/time';
import { SectionCard } from '../ui/SectionCard';
import { SectionPanel } from '../ui/SectionPanel';

type RoomSidebarProps = {
  room: Room;
};

export function RoomSidebar({ room }: RoomSidebarProps) {
  const pendingPlayerName = room.pendingResolution
    ? room.participants.find((participant) => participant.id === room.pendingResolution?.playerId)?.displayName ?? 'Невідомий'
    : null;
  const currentCheck = room.pendingResolution
    ? room.pendingResolution.steps[room.pendingResolution.currentStepIndex] ?? null
    : null;
  const currentTarget = currentCheck?.targetActorId
    ? room.sceneActors.find((actor) => actor.id === currentCheck.targetActorId) ?? null
    : null;

  return (
    <SectionPanel title="Стан кімнати">
      <div className="space-y-3 text-sm rpg-text">
        <div><strong>Тон:</strong> {room.filters.tone}</div>
        <div><strong>Сетинг:</strong> {room.filters.setting}</div>
        <div><strong>Гравців:</strong> {room.characters.length} / {MAX_PLAYERS_PER_ROOM}</div>
        <div><strong>Оновлено:</strong> {formatClockTime(room.updatedAt)}</div>
        {room.filters.worldConcept.trim() ? <div><strong>Концепт:</strong> {room.filters.worldConcept}</div> : null}
      </div>

      <SectionCard className="mt-4">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#d4af37]">
          {STRICT_HOST_RULES.uiTerminology.activeCheckTitle}
        </p>
        {room.pendingResolution && currentCheck ? (
          <div className="space-y-2 text-sm text-[#f2d7a6]">
            <div><strong>Гравець:</strong> {pendingPlayerName}</div>
            <div><strong>Крок:</strong> {room.pendingResolution.currentStepIndex + 1}/{room.pendingResolution.steps.length}</div>
            <div><strong>Перевірка:</strong> {currentCheck.label}</div>
            <div><strong>Тип:</strong> {currentCheck.type}</div>
            <div><strong>{STRICT_HOST_RULES.uiTerminology.stakesLabel}:</strong> {currentCheck.stakes}</div>
            <div><strong>{STRICT_HOST_RULES.uiTerminology.nextActorLabel}:</strong> {pendingPlayerName} кидає d20</div>
            {currentCheck.itemName ? <div><strong>Предмет:</strong> {currentCheck.itemName}</div> : null}
            {currentTarget ? <div><strong>Ціль:</strong> {currentTarget.name}</div> : null}
          </div>
        ) : (
          <p className="text-sm text-[#c6b39f]">Активного ланцюжка перевірок немає.</p>
        )}
      </SectionCard>

      {room.pendingResolution?.resolvedChecks.length ? (
        <SectionCard className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#d4af37]">
            {STRICT_HOST_RULES.uiTerminology.historyTitle}
          </p>
          <div className="space-y-2 text-sm text-[#e6d5c3]">
            {room.pendingResolution.resolvedChecks.map((check) => (
              <div key={check.stepId}>
                <strong>{check.type}:</strong> {check.result} ({check.outcome})
                <div><strong>{STRICT_HOST_RULES.uiTerminology.consequenceLabel}:</strong> {check.consequence}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </SectionPanel>
  );
}
