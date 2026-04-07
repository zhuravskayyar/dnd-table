import type { Room } from '../../types';
import { cn } from '../../lib/utils';
import { formatClockTime } from '../../utils/time';
import { SectionPanel } from '../ui/SectionPanel';

type MessageLogProps = {
  messages: Room['messages'];
};

function getMessageClassName(authorType: Room['messages'][number]['authorType']) {
  switch (authorType) {
    case 'dm':
      return 'chat-message-ai border-[#4a8bd4]';
    case 'player':
      return 'chat-message-user border-[#5cd44a]';
    case 'host':
      return 'border-[#e6c27a] bg-[rgba(230,194,122,0.08)]';
    default:
      return 'chat-message-system';
  }
}

export function MessageLog({ messages }: MessageLogProps) {
  return (
    <SectionPanel title="Журнал кімнати">
      <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-3 custom-scrollbar">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn('rounded-sm border p-3', getMessageClassName(message.authorType))}
          >
            <div className="mb-2 flex items-center justify-between gap-2 text-xs uppercase tracking-[0.2em]">
              <span className="text-[#e6c27a]">{message.authorName}</span>
              <span className="text-[#bba389]">{formatClockTime(message.createdAt)}</span>
            </div>
            <div className="text-sm whitespace-pre-wrap rpg-text">{message.content}</div>
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}
