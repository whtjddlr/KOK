import { Clock3, MapPin, Sparkles, TrainFront } from 'lucide-react';
import { CandidateInsight } from '../types';

interface CandidateCardProps {
  insight: CandidateInsight;
  onClick?: () => void;
  selected?: boolean;
}

export function CandidateCard({ insight, onClick, selected }: CandidateCardProps) {
  const { candidate, travelInfo, averageDuration, allReachable, accessSummary } = insight;

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl p-4 transition-all cursor-pointer ${
        selected
          ? 'ring-2 ring-[#ff7b6b] shadow-xl scale-[1.01]'
          : 'shadow-sm hover:shadow-md border border-transparent'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-lg text-[#1a1a2e]">{candidate.name}</h3>
            <span
              className={`px-2.5 py-1 rounded-full text-xs ${
                allReachable ? 'bg-[#e8faf7] text-[#128075]' : 'bg-[#fff5ef] text-[#cc6b36]'
              }`}
            >
              {allReachable ? '모두 이동 가능' : '근접 후보'}
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs bg-[#f5f1eb] text-[#2d3561]">
              {candidate.drawMood}
            </span>
          </div>
          <p className="text-sm text-[#6b7280]">{candidate.district}</p>
        </div>
        <div className="flex items-center gap-1 text-xs text-[#9ca3af] whitespace-nowrap">
          <Clock3 className="w-3 h-3" />
          <span>평균 {averageDuration}분</span>
        </div>
      </div>

      <p className="text-sm text-[#6b7280] leading-relaxed mb-4">{candidate.description}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-2xl bg-[#faf7f2] p-3">
          <div className="flex items-center gap-2 text-xs text-[#9ca3af] mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>분위기</span>
          </div>
          <div className="text-sm text-[#1a1a2e] leading-relaxed">{candidate.vibe}</div>
        </div>
        <div className="rounded-2xl bg-[#faf7f2] p-3">
          <div className="flex items-center gap-2 text-xs text-[#9ca3af] mb-1">
            <MapPin className="w-3.5 h-3.5" />
            <span>추천 모임</span>
          </div>
          <div className="text-sm text-[#1a1a2e] leading-relaxed">{candidate.bestFor}</div>
        </div>
      </div>

      <div className="rounded-2xl bg-[#f8fbfd] border border-[#edf2f5] p-3 mb-4">
        <div className="flex items-center gap-2 text-xs text-[#6b7280] mb-2">
          <TrainFront className="w-3.5 h-3.5" />
          <span>왜 후보로 떴는지</span>
        </div>
        <p className="text-sm text-[#1a1a2e] leading-relaxed mb-2">{candidate.whyItWorks}</p>
        <p className="text-xs text-[#6b7280]">{accessSummary}</p>
      </div>

      <div className="flex gap-2 flex-wrap mb-4">
        {travelInfo.map((info) => (
          <span
            key={info.participantId}
            className="px-3 py-1 bg-[#f5f1eb] text-[#2d3561] text-xs rounded-full"
          >
            {info.participantName} {info.duration}분
          </span>
        ))}
      </div>

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
