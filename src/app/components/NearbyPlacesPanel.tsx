import { ExternalLink, MapPin, Sparkles } from 'lucide-react';
import { Candidate, NearbyPlaceCategory, NearbyPlaceSection } from '../types';
import { buildNaverMapSearchLink } from '../lib/naver-links';

interface NearbyPlacesPanelProps {
  candidate: Candidate | null;
  sections: NearbyPlaceSection[];
  activeCategory: NearbyPlaceCategory;
  onCategoryChange: (category: NearbyPlaceCategory) => void;
  onSearch?: () => void;
  status: 'idle' | 'loading' | 'ready' | 'error';
  message: string | null;
  error: string | null;
  compact?: boolean;
}

export function NearbyPlacesPanel({
  candidate,
  sections,
  activeCategory,
  onCategoryChange,
  onSearch,
  status,
  message,
  error,
  compact = false,
}: NearbyPlacesPanelProps) {
  if (!candidate) {
    return null;
  }

  const visibleSections = sections.filter((section) => section.items.length > 0);
  const activeSection =
    visibleSections.find((section) => section.key === activeCategory) ?? visibleSections[0] ?? null;

  return (
    <section
      className={
        compact
          ? 'rounded-xl bg-[#F5F9F7] p-3'
          : 'rounded-3xl border border-[#eceff3] bg-white p-4 shadow-sm'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[#16241D]">
            <Sparkles className="h-4 w-4 text-[#FF6B5F]" />
            <h3 className={compact ? 'text-sm font-medium' : 'text-base'}>
              {candidate.name} 근처 정보
            </h3>
          </div>
          <p className={`${compact ? 'text-xs' : 'text-sm'} mt-1 leading-relaxed text-[#6E7C75]`}>
	            {error ?? message ?? '근처 찾는 중'}
          </p>
        </div>
      </div>

      {status === 'loading' && (
        <div className="kok-loading-card mt-4 rounded-2xl bg-[#FFF0EE] px-4 py-3 text-sm text-[#6E7C75]">
          <div className="flex items-center gap-3">
            <div className="kok-route-loader scale-75">
              <span />
            </div>
            <div className="min-w-0 flex-1">
	              <div className="font-semibold text-[#16241D]">근처 찾는 중</div>
            </div>
          </div>
          <div className="mt-3 kok-loading-progress" />
        </div>
      )}

      {status === 'idle' && !visibleSections.length && onSearch && (
        <button
          type="button"
          onClick={onSearch}
          className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-[#16241D] px-4 text-sm text-white transition-transform active:scale-95"
        >
          근처 정보 보기
        </button>
      )}

      {visibleSections.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {visibleSections.map((section) => {
              const active = activeSection?.key === section.key;

              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => onCategoryChange(section.key)}
                  className={`rounded-full px-3 py-1.5 text-sm transition-all ${
                    active
                      ? 'bg-[#16241D] text-white shadow-sm'
                      : 'bg-[#FFFFFF] text-[#44505b]'
                  }`}
                >
                  {section.label} {section.items.length}
                </button>
              );
            })}
          </div>

          {activeSection && (
            <div className="kok-stagger-list mt-4 space-y-2">
              {activeSection.items.slice(0, compact ? 3 : activeSection.items.length).map((place) => (
                <div
                  key={place.id}
                  className="rounded-xl border border-[#E4EFE9] bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-[#16241D]">{place.name}</div>
                      <div className="mt-1 text-xs text-[#6E7C75]">
                        {place.categoryPath || place.description}
                      </div>
                    </div>

                    <a
                        href={buildNaverMapSearchLink(place.name || place.query || candidate.name)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-full bg-white px-3 text-xs text-[#16241D] shadow-sm transition-transform active:scale-95"
                      >
                        보기
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-xs text-[#6E7C75]">
                    <MapPin className="h-3.5 w-3.5 text-[#FF6B5F]" />
                    <span>{place.roadAddress || place.address || `${candidate.name} 근처`}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {status === 'ready' && visibleSections.length === 0 && !error && (
        <div className="mt-4 rounded-2xl border border-dashed border-[#E4EFE9] bg-[#FAFCFB] px-4 py-5 text-sm text-[#6E7C75]">
	          근처 정보 없음
        </div>
      )}
    </section>
  );
}
