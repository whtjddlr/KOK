import { X, MapPin } from 'lucide-react';
import { Participant } from '../types';

interface ParticipantCardProps {
  participant: Participant;
  onRemove: (id: string) => void;
  color: string;
}

export function ParticipantCard({ participant, onRemove, color }: ParticipantCardProps) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#f0f0f0]">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0"
          style={{ backgroundColor: color }}
        >
          <span className="text-sm">{participant.name.charAt(0)}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[#1a1a2e]">{participant.name}</h3>
            <button
              onClick={() => onRemove(participant.id)}
              className="w-6 h-6 flex items-center justify-center text-[#9ca3af] hover:text-[#ef4444] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-sm text-[#6b7280]">
            <MapPin className="w-4 h-4" />
            <span className="truncate">{participant.location}</span>
          </div>

          {participant.maxTravelTime && (
            <div className="mt-2 text-xs text-[#9ca3af]">
              최대 {participant.maxTravelTime}분 이동 가능
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
