import { ChevronDown, ChevronUp, MapPin, Minus } from 'lucide-react';
import { NearbyPlacesPanel } from './NearbyPlacesPanel';
import { getMinorityBenefitProfile, inferMetroAreaLabel } from '../lib/meeting';
import { CandidateInsight, NearbyPlaceCategory, NearbyPlaceSection } from '../types';

interface CandidateCardProps {
  insight: CandidateInsight;
  onClick?: () => void;
  onExclude?: () => void;
  selected?: boolean;
  expanded?: boolean;
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
      className: 'bg-[#CFEBDF] text-[#93000a]',
    };
  }

  if (candidateId.startsWith('thrill-local-')) {
    return {
      label: '극단 로컬',
      className: 'bg-[#fff0eb] text-[#0CA178]',
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
      className: 'bg-[#F0F5F2] text-[#44534C]',
    };
  }

  return null;
}

export function CandidateCard({
  insight,
  onClick,
  onExclude,
  selected,
  expanded = false,
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
      className={`rounded-[1.35rem] border bg-white shadow-[0_10px_30px_rgba(20,35,29,0.06)] transition-all ${
        selected
          ? 'border-[#12B886] ring-2 ring-[#12B886]/20'
          : 'border-[#EEF3F0] hover:border-[#c6c6ce] hover:shadow-[0_18px_42px_rgba(20,35,29,0.1)]'
      }`}
    >
      <div
        onClick={onClick}
        className="group flex cursor-pointer items-center gap-3 px-3.5 py-4 sm:gap-4 sm:px-4"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] bg-[#F0F5F2] text-[#16241D]">
          <MapPin className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 break-keep text-base font-semibold leading-snug tracking-normal text-[#16241D] line-clamp-2">
              {candidate.name}
            </div>
            <span className="shrink-0 rounded-full bg-[#F5F9F7] px-2.5 py-1 text-[11px] text-[#44534C]">
              {metroAreaLabel}
            </span>
          </div>

          {(candidateGroup || minorityBenefitProfile) && (
            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
              {candidateGroup && (
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${candidateGroup.className}`}>
                  {candidateGroup.label}
                </span>
              )}
              {minorityBenefitProfile && (
                <span className="shrink-0 rounded-full bg-[#E6F7F0] px-2.5 py-1 text-[11px] text-[#0CA178]">
                  효율 후보
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1 rounded-full bg-[#F5F9F7] px-3 py-1.5 text-xs font-bold text-[#6E7C75] sm:inline-flex">
            {expanded ? '접기' : '보기'}
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onExclude?.();
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F0F5F2] text-[#6E7C75] transition-colors hover:bg-[#CFEBDF] hover:text-[#0CA178]"
            aria-label={`${candidate.name} 후보 제외`}
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#F0F5F2] px-4 pb-4 pt-3">
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
