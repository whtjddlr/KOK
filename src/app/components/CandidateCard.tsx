import { MapPin, Clock } from 'lucide-react';
import { Candidate } from '../types';

interface CandidateCardProps {
  candidate: Candidate;
  onClick?: () => void;
  selected?: boolean;
}

export function CandidateCard({ candidate, onClick, selected }: CandidateCardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl p-4 transition-all cursor-pointer ${
        selected
          ? 'ring-2 ring-[#ff7b6b] shadow-lg scale-[1.02]'
          : 'shadow-sm hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-lg text-[#1a1a2e] mb-1">{candidate.name}</h3>
          <p className="text-sm text-[#6b7280]">{candidate.vibe}</p>
        </div>
        <div className="flex items-center gap-1 text-xs text-[#9ca3af]">
          <Clock className="w-3 h-3" />
          <span>{Math.round(candidate.averageDistance)}km</span>
        </div>
      </div>

      <p className="text-sm text-[#6b7280] mb-3">{candidate.description}</p>

      <div className="flex gap-2 flex-wrap">
        {candidate.tags.map((tag) => (
          <span
            key={tag}
            className="px-3 py-1 bg-[#f5f1eb] text-[#2d3561] text-xs rounded-full"
          >
            #{tag}
          </span>
        ))}
      </div>
    </div>
  );
}
