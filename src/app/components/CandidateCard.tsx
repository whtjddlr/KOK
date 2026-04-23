import { Clock3, MapPin, Sparkles, TrainFront } from 'lucide-react';
import { meetCategories } from '../data/mockData';
import { CandidateInsight, MeetCategoryKey, SelectionModeKey } from '../types';

interface CandidateCardProps {
  insight: CandidateInsight;
  onClick?: () => void;
  selected?: boolean;
  selectedCategory: MeetCategoryKey;
  selectionMode: SelectionModeKey;
}

const categoryLabelMap = meetCategories.reduce<Record<string, string>>((acc, category) => {
  acc[category.key] = category.label;
  return acc;
}, {});

export function CandidateCard({
  insight,
  onClick,
  selected,
  selectedCategory,
  selectionMode,
}: CandidateCardProps) {
  const { candidate, travelInfo, averageDuration, allReachable, accessSummary } = insight;

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-2xl border bg-white p-4 transition-all ${
        selected
          ? 'scale-[1.01] border-[#ff7b6b] shadow-xl ring-2 ring-[#ff7b6b]'
          : 'border-transparent shadow-sm hover:shadow-md'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-lg text-[#1a1a2e]">{candidate.name}</h3>
            <span
              className={`rounded-full px-2.5 py-1 text-xs ${
                allReachable ? 'bg-[#e8faf7] text-[#128075]' : 'bg-[#fff5ef] text-[#cc6b36]'
              }`}
            >
              {allReachable ? '모두 이동 가능' : '근접 후보'}
            </span>
            <span className="rounded-full bg-[#f5f1eb] px-2.5 py-1 text-xs text-[#2d3561]">
              {candidate.drawMood}
            </span>
            <span className="rounded-full bg-[#eef2ff] px-2.5 py-1 text-xs text-[#2d3561]">
              {selectionMode === 'neighborhood' ? '동네 포함' : categoryLabelMap[selectedCategory]}
            </span>
          </div>
          <p className="text-sm text-[#6b7280]">{candidate.district}</p>
        </div>

        <div className="flex items-center gap-1 whitespace-nowrap text-xs text-[#9ca3af]">
          <Clock3 className="h-3 w-3" />
          <span>평균 {averageDuration}분</span>
        </div>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[#6b7280]">{candidate.description}</p>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-[#faf7f2] p-3">
          <div className="mb-1 flex items-center gap-2 text-xs text-[#9ca3af]">
            <Sparkles className="h-3.5 w-3.5" />
            <span>분위기</span>
          </div>
          <div className="text-sm leading-relaxed text-[#1a1a2e]">{candidate.vibe}</div>
        </div>

        <div className="rounded-2xl bg-[#faf7f2] p-3">
          <div className="mb-1 flex items-center gap-2 text-xs text-[#9ca3af]">
            <MapPin className="h-3.5 w-3.5" />
            <span>추천 모임</span>
          </div>
          <div className="text-sm leading-relaxed text-[#1a1a2e]">{candidate.bestFor}</div>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-[#edf2f5] bg-[#f8fbfd] p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-[#6b7280]">
          <TrainFront className="h-3.5 w-3.5" />
          <span>왜 후보로 떴는지</span>
        </div>
        <p className="mb-2 text-sm leading-relaxed text-[#1a1a2e]">{candidate.whyItWorks}</p>
        <p className="text-xs text-[#6b7280]">{accessSummary}</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {travelInfo.map((info) => (
          <span
            key={info.participantId}
            className="rounded-full bg-[#f5f1eb] px-3 py-1 text-xs text-[#2d3561]"
          >
            {info.participantName} {info.duration}분
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {candidate.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-[#f5f1eb] px-3 py-1 text-xs text-[#2d3561]"
          >
            #{tag}
          </span>
        ))}
      </div>
    </div>
  );
}
