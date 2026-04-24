import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Coffee,
  Compass,
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
  TravelInfo,
  TravelMode,
} from '../types';
import { MapView } from './MapView';
import { useWinnerTravelInfo } from '../hooks/useWinnerTravelInfo';
import { buildNaverMapReservationLink, buildNaverMapSearchLink } from '../lib/naver-links';

interface ResultScreenProps {
  winner: Candidate;
  participants: Participant[];
  selectedCategory: MeetCategoryKey;
  selectionMode: SelectionModeKey;
  currentUser?: AuthUser | null;
  redrawControl?: {
    isOnlineRoom: boolean;
    voteCount: number;
    requiredVotes: number;
    hasRequested: boolean;
    hasMajority: boolean;
    canReset: boolean;
    isBusy: boolean;
    message: string | null;
    onRequest: () => void;
  } | null;
  onBack: () => void;
  onNewDraw: () => void;
}

const PARTICIPANT_COLORS = ['#ff7b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#f59e0b', '#ec4899'];

function getNaverMapKeyword(place: ContentRecommendationItem) {
  return [place.name, place.roadAddress || place.address].filter(Boolean).join(' ');
}

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

function getTravelSummary(travelInfo: TravelInfo[]) {
  if (!travelInfo.length) {
    return {
      averageDuration: 0,
      averageDistance: 0,
      spreadDuration: 0,
      maxDuration: 0,
    };
  }

  const durations = travelInfo.map((item) => item.duration);
  const averageDuration = Math.round(
    durations.reduce((sum, duration) => sum + duration, 0) / travelInfo.length,
  );
  const averageDistance =
    Math.round(
      (travelInfo.reduce((sum, item) => sum + item.distance, 0) / travelInfo.length) * 10,
    ) / 10;

  return {
    averageDuration,
    averageDistance,
    spreadDuration: Math.max(...durations) - Math.min(...durations),
    maxDuration: Math.max(...durations),
  };
}

function getTravelSourceLabel(mode: TravelMode, travelInfo: TravelInfo[]) {
  if (mode === 'transit') {
    return travelInfo.every((item) => item.source === 'transit') ? 'ODsay' : '예상 포함';
  }

  return travelInfo.every((item) => item.source === 'directions') ? '네이버 길찾기' : '예상 포함';
}

function getInitialTravelMode(participants: Participant[]): TravelMode {
  return participants.some((participant) => participant.travelMode === 'car') ? 'car' : 'transit';
}

export function ResultScreen({
  winner,
  participants,
  selectedCategory,
  selectionMode: _selectionMode,
  currentUser = null,
  redrawControl = null,
  onBack,
  onNewDraw,
}: ResultScreenProps) {
  const initialCategory = useMemo(
    () => getInitialCategory(selectedCategory, currentUser),
    [currentUser, selectedCategory],
  );
  const activeMeetCategory =
    meetCategories.find((category) => category.key === selectedCategory) ?? meetCategories[0];
  const initialTravelMode = useMemo(() => getInitialTravelMode(participants), [participants]);
  const [showMap, setShowMap] = useState(true);
  const [contentCategory, setContentCategory] = useState<ContentCategoryKey>(initialCategory);
  const [detailQuery, setDetailQuery] = useState(() =>
    getInitialDetail(initialCategory, currentUser),
  );
  const [searchInput, setSearchInput] = useState(detailQuery);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>(initialTravelMode);
  const {
    transitTravelInfo,
    carTravelInfo,
    status: carTravelStatus,
    error: carTravelError,
    transitStatus,
    transitError,
  } = useWinnerTravelInfo(participants, winner);

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
  const redrawButtonLabel = !redrawControl
    ? '지역 다시 뽑기'
    : redrawControl.canReset
      ? '지역 다시 뽑기'
      : redrawControl.hasMajority
        ? '담당자 대기'
        : redrawControl.hasRequested
          ? `동의 완료 ${redrawControl.voteCount}/${redrawControl.requiredVotes}`
          : `다시뽑기 동의 ${redrawControl.voteCount}/${redrawControl.requiredVotes}`;
  const redrawButtonDisabled = Boolean(
    redrawControl?.isBusy ||
      (redrawControl &&
        !redrawControl.canReset &&
        (redrawControl.hasRequested || redrawControl.hasMajority)),
  );

  const handleRedrawClick = () => {
    if (!redrawControl || redrawControl.canReset) {
      onNewDraw();
      return;
    }

    redrawControl.onRequest();
  };

  const rankedMapPlaces = useMemo(
    () => buildNearbyPlaces(contentCategory, query, recommendationItems),
    [contentCategory, query, recommendationItems],
  );
  const transitSummary = useMemo(
    () => getTravelSummary(transitTravelInfo),
    [transitTravelInfo],
  );
  const carSummary = useMemo(() => getTravelSummary(carTravelInfo), [carTravelInfo]);
  const selectedTravelInfo = travelMode === 'transit' ? transitTravelInfo : carTravelInfo;
  const selectedTravelSummary = travelMode === 'transit' ? transitSummary : carSummary;
  const selectedTravelSourceLabel = getTravelSourceLabel(travelMode, selectedTravelInfo);

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
    setTravelMode(initialTravelMode);
  }, [winner.id, selectedCategory, currentUser, initialTravelMode]);

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
    <div className="min-h-screen bg-[#fbf8fb] pb-28 text-[#1f2a44]">
      <header className="sticky top-0 z-30 flex items-center justify-between rounded-b-[2rem] bg-[#f5f1eb]/88 px-6 py-4 shadow-[0_10px_30px_rgba(26,26,46,0.08)] backdrop-blur-md">
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1f2a44] text-white shadow-sm">
          <Compass className="h-5 w-5" />
        </button>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-2xl font-black tracking-[-0.06em] text-[#1f2a44]">
          Drop
        </h1>
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f0edf0] text-[#1f2a44] shadow-sm">
          <MapPin className="h-5 w-5 fill-current" />
        </button>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8">
        {!redrawControl?.isOnlineRoom && (
          <button
            onClick={onBack}
            className="mb-6 inline-flex h-11 items-center gap-2 rounded-full bg-white/90 px-4 text-sm text-[#1f2a44] shadow-sm"
          >
            <ChevronLeft className="h-4 w-4" />
            다시 고르기
          </button>
        )}

        <div className="mb-8 rounded-[2rem] bg-transparent p-4 text-center">
          <div className="mb-3 flex justify-center">
            <Sparkles className="h-16 w-16 rotate-12 text-[#c6c6ce]" />
          </div>
          <div className="text-sm font-semibold tracking-[-0.02em] text-[#45464d]">오늘의 약속 지역</div>
          <div className="mt-2 flex items-center justify-center gap-2 text-4xl font-black tracking-[-0.07em] text-[#1f2a44]">
            {winner.name}
            <MapPin className="h-7 w-7 fill-[#ff7b6b] text-[#ff7b6b]" />
          </div>
          <div className="mt-2 text-sm text-[#76777e]">{winner.district}</div>
        </div>

        <div className="mb-6 rounded-[1.75rem] bg-white p-5 shadow-[0_10px_30px_rgba(26,26,46,0.08)]">
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
              <div className="mb-2 text-sm text-[#76777e]">확정된 장소</div>
              <div className="text-2xl font-bold tracking-[-0.05em] text-[#1f2a44]">{winner.name}</div>
              <div className="mt-1 text-sm text-[#76777e]">{winner.district}</div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => setShowMap((previous) => !previous)}
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#f5f1eb] px-5 text-sm text-[#1a1a2e] transition-transform active:scale-95"
              >
                {showMap ? '지도 접기' : '지도 보기'}
              </button>
              <button
                onClick={handleRedrawClick}
                disabled={redrawButtonDisabled}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#1f2a44] px-5 text-sm text-white transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {redrawButtonLabel}
                <RefreshCcw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {redrawControl?.isOnlineRoom && (
            <div className="mt-4 rounded-2xl bg-[#f8fafc] px-4 py-3 text-sm text-[#667085]">
              {redrawControl.canReset
                ? '과반 동의 완료. 추첨 담당자가 다시 열 수 있어요.'
                : redrawControl.hasMajority
                  ? '과반 동의 완료. 추첨 담당자를 기다리는 중이에요.'
                  : `다시뽑기는 ${redrawControl.requiredVotes}명 이상 동의하면 열립니다.`}
              {redrawControl.message ? (
                <div className="mt-2 text-[#c15b3d]">{redrawControl.message}</div>
              ) : null}
            </div>
          )}

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

        <section className="mb-6 rounded-[1.75rem] bg-white p-5 shadow-[0_10px_30px_rgba(26,26,46,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xl font-bold tracking-[-0.04em] text-[#1f2a44]">이동 정보</div>
              <div className="mt-1 text-sm text-[#76777e]">
                평균 {selectedTravelSummary.averageDuration}분 · 편차{' '}
                {selectedTravelSummary.spreadDuration}분 · {selectedTravelSourceLabel}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-full bg-[#f5f1eb] p-1">
              {[
                { key: 'transit' as const, label: '대중교통', summary: transitSummary },
                { key: 'car' as const, label: '자동차', summary: carSummary },
              ].map((item) => {
                const active = travelMode === item.key;

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTravelMode(item.key)}
                    className={`rounded-xl px-4 py-2 text-sm transition-all ${
                      active ? 'bg-[#1f2a44] text-white shadow-sm' : 'text-[#45464d]'
                    }`}
                  >
                    <span className="block">{item.label}</span>
                    <span className={`text-xs ${active ? 'text-white/75' : 'text-[#7a8491]'}`}>
                      평균 {item.summary.averageDuration}분
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {selectedTravelInfo.map((info, index) => {
              const color = PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length];
              const isCar = travelMode === 'car';
              const feeText =
                isCar && info.source === 'directions'
                  ? `유류비 ${Math.round(info.fuelPrice ?? 0).toLocaleString()}원${
                      info.tollFare ? ` · 통행료 ${Math.round(info.tollFare).toLocaleString()}원` : ''
                    }`
                  : isCar
                    ? `예상 유류비 ${Math.round(info.cost).toLocaleString()}원`
                    : info.source === 'transit'
                      ? `${Math.round(info.cost).toLocaleString()}원 · 환승 ${info.transferCount ?? 0}회`
                      : `약 ${Math.round(info.cost).toLocaleString()}원`;

              return (
                <div key={`${travelMode}:${info.participantId}`} className="rounded-[1.5rem] border border-[#f0edf0] bg-[#fbf8fb] p-4 shadow-[0_8px_22px_rgba(26,26,46,0.04)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm text-white"
                        style={{ backgroundColor: color }}
                      >
                        {info.participantName.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#1f2a44]">
                          {info.participantName}
                        </div>
                        <div className="mt-0.5 text-xs text-[#7a8491]">{feeText}</div>
                        {info.routeSummary ? (
                          <div className="mt-1 truncate text-xs text-[#44505b]">
                            {info.routeSummary}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="text-xl font-black tracking-[-0.05em] text-[#1f2a44]">{info.duration}분</div>
                      <div className="text-xs text-[#7a8491]">{info.distance}km</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {travelMode === 'transit' && transitStatus !== 'ready' ? (
            <div className="mt-4 rounded-2xl bg-[#f8fbfd] px-4 py-3 text-xs text-[#6b7280]">
              {transitError ?? 'ODsay 대중교통 경로를 확인하는 중입니다.'}
            </div>
          ) : null}

          {travelMode === 'car' && carTravelStatus !== 'ready' ? (
            <div className="mt-4 rounded-2xl bg-[#f8fbfd] px-4 py-3 text-xs text-[#6b7280]">
              {carTravelError ?? '자동차 경로를 확인하는 중입니다.'}
            </div>
          ) : null}
        </section>

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

        <section className="mb-6 rounded-[1.75rem] bg-white p-5 shadow-[0_10px_30px_rgba(26,26,46,0.08)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#1a1a2e]">
                <Sparkles className="h-4 w-4 text-[#ff7b6b]" />
                <h3 className="text-xl font-bold tracking-[-0.04em]">주변 추천</h3>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-[#6b7280]">
                카테고리를 고르면 근처 인기 장소를 바로 보여줘요.
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
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
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

          <div className="mt-5 rounded-[1.5rem] border border-[#f0edf0] bg-[#f5f1eb] p-4">
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

        <section className="rounded-[1.75rem] bg-white p-5 shadow-[0_10px_30px_rgba(26,26,46,0.08)]">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xl font-bold tracking-[-0.04em] text-[#1f2a44]">
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
            <div className="mt-5 rounded-[1.5rem] border border-[#f0edf0] bg-[#fbf8fb] p-5">
              <div className="mb-2 flex items-center gap-2 text-xs text-[#6b7280]">
                <span className="rounded-full bg-[#fff2ee] px-3 py-1 text-[#ff7b6b]">
                  TOP {selectedPlace.rank}
                </span>
                <span>현재 추천 카드</span>
              </div>
              <div className="text-2xl font-bold tracking-[-0.05em] text-[#1f2a44]">{selectedPlace.name}</div>
              <div className="mt-1 text-sm text-[#6b7280]">
                {selectedPlace.categoryPath || selectedPlace.description}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={buildNaverMapSearchLink(getNaverMapKeyword(selectedPlace))}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#1f2a44] px-5 text-sm text-white transition-transform active:scale-95"
                >
                  네이버 바로가기
                  <ExternalLink className="h-4 w-4" />
                </a>
                <a
                  href={buildNaverMapReservationLink(getNaverMapKeyword(selectedPlace))}
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
                    className={`rounded-[1.5rem] border p-4 text-left shadow-[0_8px_22px_rgba(26,26,46,0.04)] transition-transform active:scale-[0.99] ${
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
                          href={buildNaverMapSearchLink(getNaverMapKeyword(item))}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm text-[#1a1a2e] shadow-sm transition-transform active:scale-95"
                        >
                          네이버 보기
                          <ExternalLink className="h-4 w-4" />
                        </a>
                        <a
                          href={buildNaverMapReservationLink(getNaverMapKeyword(item))}
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
