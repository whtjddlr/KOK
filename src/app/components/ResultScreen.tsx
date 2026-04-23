import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Coffee,
  ExternalLink,
  Gamepad2,
  MapPin,
  RefreshCcw,
  Search,
  Shuffle,
  Sparkles,
  Theater,
  UtensilsCrossed,
  Wine,
} from 'lucide-react';
import { AuthUser, preferenceVibeOptions } from '../lib/auth';
import { meetCategories } from '../data/mockData';
import {
  ContentCategoryKey,
  contentCategoryDefinitions,
  contentCategoryOrder,
  ContentRecommendationItem,
  getDefaultContentCategory,
  getRandomCategoryDetail,
  getRandomContentCategory,
  useContentRecommendations,
} from '../hooks/useContentRecommendations';
import {
  Candidate,
  MeetCategoryKey,
  NearbyPlace,
  NearbyPlaceCategory,
  Participant,
  SelectionModeKey,
} from '../types';
import { MapView } from './MapView';

interface ResultScreenProps {
  winner: Candidate;
  participants: Participant[];
  selectedCategory: MeetCategoryKey;
  selectionMode: SelectionModeKey;
  currentUser?: AuthUser | null;
  onBack: () => void;
  onNewDraw: () => void;
}

const PARTICIPANT_COLORS = ['#ff7b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#f59e0b', '#ec4899'];

const contentCategoryIcons = {
  restaurant: UtensilsCrossed,
  cafe: Coffee,
  drink: Wine,
  culture: Theater,
  activity: Gamepad2,
} as const;

function getInitialCategory(
  selectedCategory: MeetCategoryKey,
  currentUser?: AuthUser | null,
): ContentCategoryKey {
  const preferred = currentUser?.preferences.favoriteCategories.find((category) =>
    contentCategoryOrder.includes(category),
  );

  return preferred ?? getDefaultContentCategory(selectedCategory);
}

function getInitialDetail(
  category: ContentCategoryKey,
  currentUser?: AuthUser | null,
) {
  const availableDetails = contentCategoryDefinitions[category].details;
  const preferredKeyword = currentUser?.preferences.favoriteKeywords.find((keyword) =>
    availableDetails.includes(keyword),
  );

  return preferredKeyword ?? currentUser?.preferences.favoriteKeywords[0] ?? getRandomCategoryDetail(category);
}

function mapContentCategoryToNearbyCategory(
  category: ContentCategoryKey,
): NearbyPlaceCategory {
  if (category === 'restaurant') {
    return 'restaurant';
  }

  if (category === 'cafe') {
    return 'cafe';
  }

  return 'activity';
}

function buildNearbyPlaces(
  category: ContentCategoryKey,
  query: string,
  items: ContentRecommendationItem[],
): NearbyPlace[] {
  const mappedCategory = mapContentCategoryToNearbyCategory(category);

  return items
    .filter((item) => item.coordinates)
    .slice(0, 5)
    .map((item) => ({
      id: `result:${item.id}`,
      name: item.name,
      category: mappedCategory,
      label: `TOP ${item.rank}`,
      query,
      description: item.description,
      categoryPath: item.categoryPath,
      address: item.address,
      roadAddress: item.roadAddress,
      link: item.link || item.naverSearchLink,
      coordinates: item.coordinates,
    }));
}

export function ResultScreen({
  winner,
  participants,
  selectedCategory,
  selectionMode: _selectionMode,
  currentUser = null,
  onBack,
  onNewDraw,
}: ResultScreenProps) {
  const initialCategory = useMemo(
    () => getInitialCategory(selectedCategory, currentUser),
    [currentUser, selectedCategory],
  );
  const activeMeetCategory =
    meetCategories.find((category) => category.key === selectedCategory) ?? meetCategories[0];
  const [showMap, setShowMap] = useState(true);
  const [contentCategory, setContentCategory] = useState<ContentCategoryKey>(initialCategory);
  const [detailQuery, setDetailQuery] = useState(() =>
    getInitialDetail(initialCategory, currentUser),
  );
  const [searchInput, setSearchInput] = useState(detailQuery);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  const contentMeta = contentCategoryDefinitions[contentCategory];
  const {
    items: recommendationItems,
    status: recommendationStatus,
    message: recommendationMessage,
    error: recommendationError,
    query,
  } = useContentRecommendations(winner, contentCategory, detailQuery);

  const selectedPlace =
    recommendationItems.find((item) => item.id === selectedPlaceId) ??
    recommendationItems[0] ??
    null;

  const rankedMapPlaces = useMemo(
    () => buildNearbyPlaces(contentCategory, query, recommendationItems),
    [contentCategory, query, recommendationItems],
  );

  const recommendedDetailButtons = useMemo(() => {
    const preferred = currentUser?.preferences.favoriteKeywords ?? [];
    const defaults = contentMeta.details;
    const ordered = [...preferred, ...defaults];

    return ordered.filter((detail, index) => ordered.indexOf(detail) === index).slice(0, 6);
  }, [contentMeta.details, currentUser?.preferences.favoriteKeywords]);

  const preferenceSummary = useMemo(() => {
    if (!currentUser) {
      return null;
    }

    const vibeLabel =
      preferenceVibeOptions.find((option) => option.value === currentUser.preferences.vibe)?.label ??
      '';
    const categoryLabels = currentUser.preferences.favoriteCategories
      .map(
        (category) =>
          contentCategoryDefinitions[category as ContentCategoryKey]?.label ?? category,
      )
      .slice(0, 2);

    return {
      vibeLabel,
      categoryLabels,
      keywords: currentUser.preferences.favoriteKeywords.slice(0, 3),
    };
  }, [currentUser]);

  useEffect(() => {
    const nextCategory = getInitialCategory(selectedCategory, currentUser);
    const nextDetail = getInitialDetail(nextCategory, currentUser);

    setContentCategory(nextCategory);
    setDetailQuery(nextDetail);
    setSearchInput(nextDetail);
    setSelectedPlaceId(null);
    setShowMap(true);
  }, [winner.id, selectedCategory, currentUser]);

  useEffect(() => {
    setSearchInput(detailQuery);
  }, [detailQuery]);

  useEffect(() => {
    if (!recommendationItems.length) {
      setSelectedPlaceId(null);
      return;
    }

    if (!selectedPlaceId || !recommendationItems.some((item) => item.id === selectedPlaceId)) {
      setSelectedPlaceId(recommendationItems[0].id);
    }
  }, [recommendationItems, selectedPlaceId]);

  const handleChangeCategory = (category: ContentCategoryKey) => {
    const nextDetail = getInitialDetail(category, currentUser);
    setContentCategory(category);
    setDetailQuery(nextDetail);
    setSearchInput(nextDetail);
  };

  const handleRandomizeCategory = () => {
    const randomCategory = getRandomContentCategory();
    handleChangeCategory(randomCategory);
  };

  const handleRandomizeDetail = () => {
    const categoryDetails = recommendedDetailButtons;
    const nextDetail =
      categoryDetails[Math.floor(Math.random() * categoryDetails.length)] ??
      getRandomCategoryDetail(contentCategory);
    setDetailQuery(nextDetail);
    setSearchInput(nextDetail);
  };

  const handleSubmitSearch = () => {
    const normalized = searchInput.trim();
    if (!normalized) {
      return;
    }

    setDetailQuery(normalized);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fafaf8] via-[#f5f1eb] to-[#e8dfd0]">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <button
          onClick={onBack}
          className="mb-6 inline-flex h-11 items-center gap-2 rounded-full bg-white/90 px-4 text-sm text-[#1a1a2e] shadow-sm"
        >
          <ChevronLeft className="h-4 w-4" />
          다시 고르기
        </button>

        <div className="mb-6 rounded-[28px] bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap gap-2">
            <div
              className="inline-flex items-center rounded-full px-4 py-2 text-sm"
              style={{
                backgroundColor: `${activeMeetCategory.accent}18`,
                color: activeMeetCategory.accent,
              }}
            >
              {activeMeetCategory.label}
            </div>
            <div className="inline-flex items-center rounded-full bg-[#f5f1eb] px-4 py-2 text-sm text-[#44505b]">
              확정 지역
            </div>
            {preferenceSummary ? (
              <div className="inline-flex items-center rounded-full bg-[#fff4e8] px-4 py-2 text-sm text-[#b45b1d]">
                {currentUser?.name}님 취향 반영
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-2 text-sm text-[#6b7280]">오늘의 약속 지역</div>
              <div className="text-3xl text-[#1a1a2e]">{winner.name}</div>
              <div className="mt-1 text-sm text-[#6b7280]">{winner.district}</div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => setShowMap((previous) => !previous)}
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#f5f1eb] px-5 text-sm text-[#1a1a2e] transition-transform active:scale-95"
              >
                {showMap ? '지도 접기' : '지도 보기'}
              </button>
              <button
                onClick={onNewDraw}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#1f2a44] px-5 text-sm text-white transition-transform active:scale-95"
              >
                지역 다시 뽑기
                <RefreshCcw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {preferenceSummary ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {preferenceSummary.categoryLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-[#f5f1eb] px-3 py-1 text-xs text-[#44505b]"
                >
                  {label}
                </span>
              ))}
              {preferenceSummary.vibeLabel ? (
                <span className="rounded-full bg-[#f5f1eb] px-3 py-1 text-xs text-[#44505b]">
                  {preferenceSummary.vibeLabel}
                </span>
              ) : null}
              {preferenceSummary.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="rounded-full bg-[#f5f1eb] px-3 py-1 text-xs text-[#44505b]"
                >
                  {keyword}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {showMap && (
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-lg text-[#1a1a2e]">인기 장소 지도</div>
                <div className="mt-1 text-sm text-[#6b7280]">
                  리뷰 많은 순 상위 장소를 먼저 지도에 올려두었어요.
                </div>
              </div>
              {rankedMapPlaces.length ? (
                <div className="rounded-full bg-white/90 px-4 py-2 text-xs text-[#44505b] shadow-sm">
                  Top {rankedMapPlaces.length}
                </div>
              ) : null}
            </div>
            <MapView
              participants={participants}
              candidates={[winner]}
              selectedCandidate={winner}
              reachableCandidateIds={[winner.id]}
              nearbyPlaces={rankedMapPlaces}
              colors={PARTICIPANT_COLORS}
            />
          </div>
        )}

        <section className="mb-6 rounded-[28px] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#1a1a2e]">
                <Sparkles className="h-4 w-4 text-[#ff7b6b]" />
                <h3 className="text-lg">다음 코스 추천</h3>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-[#6b7280]">
                큰 카테고리를 정한 뒤 세부 키워드까지 바로 검색해 드릴게요.
              </p>
            </div>

            <button
              onClick={handleRandomizeCategory}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#f5f1eb] px-4 text-sm text-[#1a1a2e] transition-transform active:scale-95"
            >
              카테고리 랜덤
              <Shuffle className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {contentCategoryOrder.map((category) => {
              const meta = contentCategoryDefinitions[category];
              const Icon = contentCategoryIcons[category];
              const active = category === contentCategory;

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => handleChangeCategory(category)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-all ${
                    active ? 'text-white shadow-sm' : 'bg-[#f5f1eb] text-[#44505b]'
                  }`}
                  style={
                    active
                      ? {
                          backgroundColor: meta.accent,
                        }
                      : undefined
                  }
                >
                  <Icon className="h-4 w-4" />
                  {meta.label}
                </button>
              );
            })}
          </div>

          <div className="mt-5 rounded-[24px] border border-[#edf2f5] bg-[#faf7f2] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm text-[#1a1a2e]">{contentMeta.label} 세부 추천</div>
                <div className="mt-1 text-xs text-[#6b7280]">
                  직접 입력도 되고, 랜덤으로 다시 돌릴 수도 있어요.
                </div>
              </div>

              <button
                onClick={handleRandomizeDetail}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm text-[#1a1a2e] shadow-sm transition-transform active:scale-95"
              >
                세부 랜덤
                <Shuffle className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {recommendedDetailButtons.map((detail) => {
                const active = detailQuery === detail;

                return (
                  <button
                    key={detail}
                    type="button"
                    onClick={() => {
                      setDetailQuery(detail);
                      setSearchInput(detail);
                    }}
                    className={`rounded-full px-4 py-2 text-sm transition-all ${
                      active ? 'bg-[#1f2a44] text-white shadow-sm' : 'bg-white text-[#44505b]'
                    }`}
                  >
                    {detail}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-col gap-2 md:flex-row">
              <div className="flex items-center gap-3 rounded-2xl border border-[#edf2f5] bg-white px-4 py-3 md:flex-1">
                <Search className="h-4 w-4 text-[#6b7280]" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleSubmitSearch();
                    }
                  }}
                  placeholder={contentMeta.placeholder}
                  className="w-full bg-transparent text-sm text-[#1a1a2e] outline-none placeholder:text-[#9ca3af]"
                />
              </div>

              <button
                onClick={handleSubmitSearch}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#1f2a44] px-5 text-sm text-white transition-transform active:scale-95"
              >
                검색
                <Search className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-lg text-[#1a1a2e]">
                {winner.name} 근처 {detailQuery}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-[#6b7280]">
                {recommendationError ??
                  recommendationMessage ??
                  `${winner.name} 근처 ${contentMeta.label}를 바로 찾고 있어요.`}
              </p>
            </div>

            {query ? (
              <div className="rounded-full bg-[#f5f1eb] px-4 py-2 text-xs text-[#44505b]">
                검색어: {query}
              </div>
            ) : null}
          </div>

          {selectedPlace && (
            <div className="mt-5 rounded-[24px] border border-[#edf2f5] bg-[#f8fbfd] p-5">
              <div className="mb-2 flex items-center gap-2 text-xs text-[#6b7280]">
                <span className="rounded-full bg-[#fff2ee] px-3 py-1 text-[#ff7b6b]">
                  TOP {selectedPlace.rank}
                </span>
                <span>현재 추천 카드</span>
              </div>
              <div className="text-2xl text-[#1a1a2e]">{selectedPlace.name}</div>
              <div className="mt-1 text-sm text-[#6b7280]">
                {selectedPlace.categoryPath || selectedPlace.description}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={selectedPlace.link || selectedPlace.naverSearchLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#1f2a44] px-5 text-sm text-white transition-transform active:scale-95"
                >
                  네이버 바로가기
                  <ExternalLink className="h-4 w-4" />
                </a>
                <a
                  href={selectedPlace.reservationSearchLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#f5f1eb] px-5 text-sm text-[#1a1a2e] transition-transform active:scale-95"
                >
                  예약 검색
                  <Search className="h-4 w-4" />
                </a>
              </div>
            </div>
          )}

          {recommendationStatus === 'loading' && (
            <div className="mt-5 rounded-2xl bg-[#faf7f2] px-4 py-4 text-sm text-[#6b7280]">
              {winner.name} 근처 인기 장소를 찾는 중이에요.
            </div>
          )}

          {recommendationStatus === 'ready' && recommendationItems.length > 0 && (
            <div className="mt-5 grid gap-3">
              {recommendationItems.map((item) => {
                const active = selectedPlace?.id === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedPlaceId(item.id)}
                    className={`rounded-[24px] border p-4 text-left shadow-sm transition-transform active:scale-[0.99] ${
                      active ? 'border-[#1f2a44] bg-white' : 'border-[#edf2f5] bg-[#fbfcfd]'
                    }`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap gap-2">
                          <span className="rounded-full bg-[#fff2ee] px-3 py-1 text-xs text-[#ff7b6b]">
                            TOP {item.rank}
                          </span>
                          {item.coordinates ? (
                            <span className="rounded-full bg-[#eef4ff] px-3 py-1 text-xs text-[#2d5aa7]">
                              지도 표시
                            </span>
                          ) : null}
                        </div>
                        <div className="text-lg text-[#1a1a2e]">{item.name}</div>
                        <div className="mt-1 text-sm text-[#6b7280]">
                          {item.categoryPath || item.description}
                        </div>

                        <div className="mt-3 flex items-center gap-2 text-xs text-[#6b7280]">
                          <MapPin className="h-3.5 w-3.5 text-[#ff7b6b]" />
                          <span>{item.roadAddress || item.address || `${winner.name} 근처`}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <a
                          href={item.link || item.naverSearchLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm text-[#1a1a2e] shadow-sm transition-transform active:scale-95"
                        >
                          네이버 보기
                          <ExternalLink className="h-4 w-4" />
                        </a>
                        <a
                          href={item.reservationSearchLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#f5f1eb] px-4 text-sm text-[#1a1a2e] transition-transform active:scale-95"
                        >
                          예약 검색
                          <Search className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {recommendationStatus === 'ready' && recommendationItems.length === 0 && !recommendationError && (
            <div className="mt-5 rounded-2xl border border-dashed border-[#d9e0e7] bg-[#fafaf8] px-4 py-6 text-sm text-[#6b7280]">
              아직 맞는 결과가 없어요. 세부 키워드를 바꾸거나 랜덤으로 다시 돌려보세요.
            </div>
          )}

          {recommendationStatus === 'error' && (
            <div className="mt-5 rounded-2xl border border-[#ffd9cf] bg-[#fff5f2] px-4 py-4 text-sm text-[#c15b3d]">
              {recommendationError}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
