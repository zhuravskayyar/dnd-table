import type { Room } from '../../types';
import { SectionCard } from '../ui/SectionCard';
import { SectionPanel } from '../ui/SectionPanel';

type SceneActorsPanelProps = {
  room: Room;
};

export function SceneActorsPanel({ room }: SceneActorsPanelProps) {
  return (
    <SectionPanel title="Учасники сцени">
      {room.sceneActors.length === 0 ? (
        <SectionCard className="text-sm text-[#c6b39f]">
          Ще немає активних NPC або монстрів у поточній серверній сцені.
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {room.sceneActors.map((actor) => (
            <div key={actor.id}>
              <SectionCard>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <strong className="text-[#e6c27a]">{actor.name}</strong>
                  <span className="text-xs uppercase tracking-[0.2em] text-[#d4af37]">{actor.kind}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm text-[#e6d5c3]">
                  <div><strong>Роль:</strong> {actor.role}</div>
                  <div><strong>Локація:</strong> {actor.currentLocation}</div>
                  <div><strong>Уважність:</strong> {actor.awareness}</div>
                  <div><strong>Поранення:</strong> {actor.woundState}</div>
                </div>
                <p className="mt-2 text-xs text-[#c6b39f]">{actor.notes}</p>
              </SectionCard>
            </div>
          ))}
        </div>
      )}
    </SectionPanel>
  );
}
