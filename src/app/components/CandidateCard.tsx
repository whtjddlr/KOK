import { MapPin, Minus } from 'lucide-react';
import { NearbyPlacesPanel } from './NearbyPlacesPanel';
import { getMinorityBenefitProfile, inferMetroAreaLabel } from '../lib/meeting';
import { CandidateInsight, NearbyPlaceCategory, NearbyPlaceSection } from '../types';

interface CandidateCardProps {
  insight: CandidateInsight;
  onClick?: () => void;
  onExclude?: () => void;
  selected?: boolean;
  nearbySections?: NearbyPlaceSection[];
  activeNearbyCategory?: NearbyPlaceCategory;
  onNearbyCategoryChange?: (category: NearbyPlaceCategory) => void;
  onNearbySearch?: () => void;
  nearbyStatus?: 'idle' | 'loading' | 'ready' | 'error';
  nearbyMessage?: string | null;
  nearbyError?: string | null;
}

function getCandidateGroup(candidateId: string) {
  if (candidateId.startsWith('thrill-hyper-')) {
    return {
      label: '집앞 상권',
      className: 'bg-[#ffdad6] text-[#93000a]',
    };
  }

  if (candidateId.startsWith('thrill-local-')) {
    return {
      label: '극단 로컬',
      className: 'bg-[#fff0eb] text-[#a6392e]',
    };
  }

  if (candidateId.startsWith('participant-near-')) {
    return {
      label: '동네 상권',
      className: 'bg-[#e5fbf8] text-[#00504c]',
    };
  }

  if (candidateId.startsWith('midpoint-') || candidateId.startsWith('close-range-')) {
    return {
      label: '중간 후보',
      className: 'bg-[#f0edf0] text-[#45464d]',
    };
  }

  return null;
}

export function CandidateCard({
  insight,
  onClick,
  onExclude,
  selected,
  nearbySections = [],
  activeNearbyCategory = 'restaurant',
  onNearbyCategoryChange,
  onNearbySearch,
  nearbyStatus = 'idle',
  nearbyMessage = null,
  nearbyError = null,
}: CandidateCardProps) {
  const { candidate } = insight;
  const metroAreaLabel = inferMetroAreaLabel(candidate);
  const candidateGroup = getCandidateGroup(candidate.id);
  const minorityBenefitProfile = getMinorityBenefitProfile(insight);

  return (
    <div
      className={`rounded-[1.35rem] border bg-white shadow-[0_10px_30px_rgba(26,26,46,0.06)] transition-all ${
        selected
          ? 'border-[#ff7b6b] ring-2 ring-[#ff7b6b]/20'
          : 'border-[#e4e2e4] hover:border-[#c6c6ce] hover:shadow-[0_18px_42px_rgba(26,26,46,0.1)]'
      }`}
    >
      <div
        onClick={onClick}
        className="group flex cursor-pointer items-center gap-4 px-4 py-4"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] bg-[#f0edf0] text-[#1f2a44]">
          <MapPin className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-base font-semibold tracking-[-0.03em] text-[#1f2a44]">{candidate.name}</div>
            <span className="shrink-0 rounded-full bg-[#f5f1eb] px-2.5 py-1 text-[11px] text-[#45464d]">
              {metroAreaLabel}
            </span>
            {candidateGroup && (
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${candidateGroup.className}`}>
                {candidateGroup.label}
              </span>
            )}
            {minorityBenefitProfile && (
              <span className="shrink-0 rounded-full bg-[#eef4ff] px-2.5 py-1 text-[11px] text-[#2d5aa7]">
                효율 후보
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onExclude?.();
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f0edf0] text-[#76777e] transition-colors hover:bg-[#ffdad6] hover:text-[#ba1a1a]"
            aria-label={`${candidate.name} 후보 제외`}
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {selected && (
        <div className="border-t border-[#f0edf0] px-4 pb-4 pt-3">
          <NearbyPlacesPanel
            candidate={candidate}
            sections={nearbySections}
            activeCategory={activeNearbyCategory}
            onCategoryChange={onNearbyCategoryChange ?? (() => undefined)}
            onSearch={onNearbySearch}
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
