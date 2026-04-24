import { Clock3, Minus } from 'lucide-react';
import { NearbyPlacesPanel } from './NearbyPlacesPanel';
import { inferMetroAreaLabel } from '../lib/meeting';
import { CandidateInsight, NearbyPlaceCategory, NearbyPlaceSection } from '../types';

interface CandidateCardProps {
  insight: CandidateInsight;
  onClick?: () => void;
  onExclude?: () => void;
  selected?: boolean;
  nearbySections?: NearbyPlaceSection[];
  activeNearbyCategory?: NearbyPlaceCategory;
  onNearbyCategoryChange?: (category: NearbyPlaceCategory) => void;
  nearbyStatus?: 'idle' | 'loading' | 'ready' | 'error';
  nearbyMessage?: string | null;
  nearbyError?: string | null;
}

export function CandidateCard({
  insight,
  onClick,
  onExclude,
  selected,
  nearbySections = [],
  activeNearbyCategory = 'restaurant',
  onNearbyCategoryChange,
  nearbyStatus = 'idle',
  nearbyMessage = null,
  nearbyError = null,
}: CandidateCardProps) {
  const { candidate, averageDuration, allReachable } = insight;
  const metroAreaLabel = inferMetroAreaLabel(candidate);

  return (
    <div
      className={`rounded-xl border bg-white shadow-sm transition-all ${
        selected
          ? 'border-[#ff7b6b] ring-2 ring-[#ff7b6b]/20'
          : 'border-[#e8edf3] hover:border-[#d7e0e8]'
      }`}
    >
      <div
        onClick={onClick}
        className="group flex cursor-pointer items-center gap-3 px-3 py-3"
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onExclude?.();
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f5f1eb] text-[#6b7280] transition-colors hover:bg-[#ffe7e2] hover:text-[#d95f4d]"
          aria-label={`${candidate.name} 후보 제외`}
        >
          <Minus className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-base font-medium text-[#1a1a2e]">{candidate.name}</div>
            <span className="shrink-0 rounded-full bg-[#eef4ff] px-2 py-0.5 text-[11px] text-[#35548c]">
              {metroAreaLabel}
            </span>
            {allReachable && (
              <span className="hidden shrink-0 rounded-full bg-[#e8faf7] px-2 py-0.5 text-[11px] text-[#128075] sm:inline-flex">
                가능
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-sm text-[#7a8491]">{candidate.district}</div>
        </div>

        <div className="flex shrink-0 items-center gap-1 text-xs text-[#8a94a2]">
          <Clock3 className="h-3.5 w-3.5" />
          {averageDuration}분
        </div>
      </div>

      {selected && (
        <div className="border-t border-[#edf1f4] px-3 pb-3 pt-3">
          <NearbyPlacesPanel
            candidate={candidate}
            sections={nearbySections}
            activeCategory={activeNearbyCategory}
            onCategoryChange={onNearbyCategoryChange ?? (() => undefined)}
            status={nearbyStatus}
            message={nearbyMessage}
            error={nearbyError}
            compact
          />
        </div>
      )}
    </div>
  );
}
