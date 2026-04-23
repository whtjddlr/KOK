import { MapPin, X } from 'lucide-react';
import { Participant } from '../types';

interface ParticipantCardProps {
  participant: Participant;
  onRemove: (id: string) => void;
  onSaveFriend?: (id: string) => void;
  isSavedFriend?: boolean;
  color: string;
}

export function ParticipantCard({
  participant,
  onRemove,
  onSaveFriend,
  isSavedFriend = false,
  color,
}: ParticipantCardProps) {
  return (
    <div className="rounded-2xl border border-[#f0f0f0] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: color }}
        >
          <span className="text-sm">{participant.name.charAt(0)}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[#1a1a2e]">{participant.name}</h3>
            <button
              type="button"
              onClick={() => onRemove(participant.id)}
              className="flex h-6 w-6 items-center justify-center text-[#9ca3af] transition-colors hover:text-[#ef4444]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-sm text-[#6b7280]">
            <MapPin className="h-4 w-4" />
            <span className="truncate">{participant.location}</span>
            {participant.locationSource === 'current' && (
              <span className="rounded-full bg-[#eef7ff] px-2 py-0.5 text-[11px] text-[#3466a8]">
                현재 위치
              </span>
            )}
          </div>

          <div className="hidden mt-2 text-xs text-[#9ca3af]">
            최대 {participant.maxTravelTime}분까지 이동 가능
          </div>

          {onSaveFriend && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => onSaveFriend(participant.id)}
                disabled={isSavedFriend}
                className="rounded-full bg-[#f5f1eb] px-3 py-1.5 text-[11px] text-[#44505b] transition-transform active:scale-95 disabled:opacity-55"
              >
                {isSavedFriend ? '저장됨' : '친구 저장'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
