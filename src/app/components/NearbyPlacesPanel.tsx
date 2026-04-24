import { ExternalLink, LoaderCircle, MapPin, Sparkles } from 'lucide-react';
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
          ? 'rounded-xl bg-[#f8fbfd] p-3'
          : 'rounded-3xl border border-[#eceff3] bg-white p-4 shadow-sm'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[#1a1a2e]">
            <Sparkles className="h-4 w-4 text-[#ff7b6b]" />
            <h3 className={compact ? 'text-sm font-medium' : 'text-base'}>
              {candidate.name} 근처 정보
            </h3>
          </div>
          <p className={`${compact ? 'text-xs' : 'text-sm'} mt-1 leading-relaxed text-[#6b7280]`}>
            {error ?? message ?? `${candidate.name} 주변 정보를 자동으로 찾고 있어요.`}
          </p>
        </div>
        <div className="hidden rounded-full bg-[#f5f1eb] px-3 py-1 text-xs text-[#44505b] sm:block">
          인기순 자동 검색
        </div>
      </div>

      {status === 'loading' && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-[#faf7f2] px-4 py-3 text-sm text-[#6b7280]">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          근처 장소를 모으는 중이에요.
        </div>
      )}

      {status === 'idle' && !visibleSections.length && onSearch && (
        <button
          type="button"
          onClick={onSearch}
          className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-[#1f2a44] px-4 text-sm text-white transition-transform active:scale-95"
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
                      ? 'bg-[#1f2a44] text-white shadow-sm'
                      : 'bg-[#f5f1eb] text-[#44505b]'
                  }`}
                >
                  {section.label} {section.items.length}
                </button>
              );
            })}
          </div>

          {activeSection && (
            <div className="mt-4 space-y-2">
              {activeSection.items.slice(0, compact ? 3 : activeSection.items.length).map((place) => (
                <div
                  key={place.id}
                  className="rounded-xl border border-[#edf2f5] bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-[#1a1a2e]">{place.name}</div>
                      <div className="mt-1 text-xs text-[#6b7280]">
                        {place.categoryPath || place.description}
                      </div>
                    </div>

                    <a
                        href={buildNaverMapSearchLink(place.name || place.query || candidate.name)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-full bg-white px-3 text-xs text-[#1a1a2e] shadow-sm transition-transform active:scale-95"
                      >
                        보기
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-xs text-[#6b7280]">
                    <MapPin className="h-3.5 w-3.5 text-[#ff7b6b]" />
                    <span>{place.roadAddress || place.address || `${candidate.name} 근처`}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {status === 'ready' && visibleSections.length === 0 && !error && (
        <div className="mt-4 rounded-2xl border border-dashed border-[#d9e0e7] bg-[#fafaf8] px-4 py-5 text-sm text-[#6b7280]">
          아직 바로 보여줄 만한 근처 정보를 찾지 못했어요.
        </div>
      )}
    </section>
  );
}
