import { Car, MapPin, TrainFront, X } from 'lucide-react';
import { Participant } from '../types';
import { getParticipantGenderLabel } from '../lib/gender';
import { getSafeLocationLabel } from '../lib/service-area';

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
  const travelMode = participant.travelMode ?? 'transit';
  const TravelIcon = travelMode === 'car' ? Car : TrainFront;

  return (
    <div className="rounded-[1.25rem] border border-[#f0edf0] bg-white px-3 py-3 shadow-[0_8px_22px_rgba(26,26,46,0.05)]">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          {participant.avatarUrl ? (
            <img
              src={participant.avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-sm font-bold">{participant.name.charAt(0)}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-sm font-semibold text-[#1f2a44]">{participant.name}</div>
            <button
              type="button"
              onClick={() => onRemove(participant.id)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#9ca3af] transition-colors hover:bg-[#ffdad6] hover:text-[#ba1a1a]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-w-0 items-center gap-1.5 text-xs text-[#76777e]">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{getSafeLocationLabel(participant.location)}</span>
            {participant.locationSource === 'current' && (
              <span className="shrink-0 rounded-full bg-[#d9e2ff] px-2 py-0.5 text-[10px] text-[#3b4662]">
                현재 위치
              </span>
            )}
            {participant.gender && participant.gender !== 'unspecified' && (
              <span className="shrink-0 rounded-full bg-[#f5f1eb] px-2 py-0.5 text-[10px] text-[#45464d]">
                {getParticipantGenderLabel(participant.gender)}
              </span>
            )}
          </div>

          <div className="hidden mt-1 text-xs text-[#9ca3af]">
            최대 {participant.maxTravelTime}분까지 이동 가능
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="inline-flex items-center gap-1 rounded-full bg-[#f5f1eb] px-2.5 py-1 text-[11px] text-[#45464d]">
            <TravelIcon className="h-3 w-3" />
            {travelMode === 'car' ? '자차' : '대중'}
          </div>
          {onSaveFriend && (
            <button
              type="button"
              onClick={() => onSaveFriend(participant.id)}
              disabled={isSavedFriend}
              className="rounded-full bg-[#f5f1eb] px-2.5 py-1 text-[10px] text-[#45464d] transition-transform active:scale-95 disabled:opacity-55"
            >
              {isSavedFriend ? '저장됨' : '저장'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
