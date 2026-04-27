import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Coffee,
  Compass,
  Copy,
  ExternalLink,
  Gamepad2,
  Home,
  MapPin,
  RefreshCcw,
  Search,
  Share2,
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
  getContentCategoryDetails,
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
  TravelRouteStep,
  WinnerRouteSnapshot,
} from '../types';
import { MapView } from './MapView';
import { useWinnerTravelInfo } from '../hooks/useWinnerTravelInfo';
import { buildNaverMapReservationLink, buildNaverMapSearchLink } from '../lib/naver-links';
import { buildGroupGenderContext } from '../lib/gender';
import { fetchNearbySearchResults, type NearbySearchItem } from '../lib/naver-local-search';

interface ResultScreenProps {
  winner: Candidate;
  participants: Participant[];
  selectedCategory: MeetCategoryKey;
  selectionMode: SelectionModeKey;
  currentUser?: AuthUser | null;
  routeSnapshot?: WinnerRouteSnapshot | null;
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
  onHome: () => void;
}

const PARTICIPANT_COLORS = ['#ff7b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#f59e0b', '#ec4899'];

type DisplayTravelMode = TravelMode | 'preferred';
type ParkingSearchStatus = 'idle' | 'loading' | 'ready' | 'empty';

interface ParkingPlace {
  id: string;
  name: string;
  categoryPath: string;
  address: string;
  link: string;
}

const PARKING_RESULT_LIMIT = 4;
const PARKING_KEYWORDS = ['주차', 'parking', '파킹', '공영', '민영'];

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
  selectedMeetCategory: MeetCategoryKey,
  groupGenderContext = '',
  currentUser?: AuthUser | null,
) {
  const availableDetails = getContentCategoryDetails(category, selectedMeetCategory, groupGenderContext);
  const preferredKeyword = currentUser?.preferences.favoriteKeywords.find((keyword) =>
    availableDetails.includes(keyword),
  );

  if (preferredKeyword) {
    return preferredKeyword;
  }

  if (selectedMeetCategory !== 'date' && currentUser?.preferences.favoriteKeywords[0]) {
    return currentUser.preferences.favoriteKeywords[0];
  }

  return getRandomCategoryDetail(category, selectedMeetCategory, groupGenderContext);
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

function getParkingSearchQueries(winner: Candidate) {
  return [
    `${winner.name} 주차장`,
    `${winner.name} 공영주차장`,
    winner.district && !winner.district.includes(winner.name)
      ? `${winner.district} ${winner.name} 주차장`
      : '',
  ]
    .map((query) => query.trim().replace(/\s+/g, ' '))
    .filter((query, index, queries) => query && queries.indexOf(query) === index);
}

function isParkingSearchItem(item: NearbySearchItem) {
  const searchableText = [
    item.name,
    item.categoryPath,
    item.description,
    item.address,
    item.roadAddress,
  ]
    .join(' ')
    .toLowerCase();

  return PARKING_KEYWORDS.some((keyword) => searchableText.includes(keyword));
}

function mapParkingPlace(item: NearbySearchItem): ParkingPlace {
  const address = item.roadAddress || item.address;
  const keyword = [item.name, address].filter(Boolean).join(' ');

  return {
    id: `${item.name}:${address}`,
    name: item.name,
    categoryPath: item.categoryPath,
    address,
    link: buildNaverMapSearchLink(keyword || item.name),
  };
}

function getUniqueParkingPlaces(items: NearbySearchItem[]) {
  const seen = new Set<string>();
  const places: ParkingPlace[] = [];

  items.forEach((item) => {
    if (!isParkingSearchItem(item)) {
      return;
    }

    const place = mapParkingPlace(item);
    const key = `${place.name}:${place.address}`.toLowerCase();

    if (!place.name || seen.has(key)) {
      return;
    }

    seen.add(key);
    places.push(place);
  });

  return places.slice(0, PARKING_RESULT_LIMIT);
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
    return travelInfo.every((item) => item.source === 'transit') ? '실제 경로' : '예상 포함';
  }

  return travelInfo.every((item) => item.source === 'directions') ? '실제 경로' : '예상 포함';
}

function getTravelDistanceLabel(info: TravelInfo) {
  return info.source === 'estimated' ? '실경로 확인 전' : `${info.distance}km`;
}

function formatRouteStepDistance(distance?: number) {
  if (!distance) {
    return null;
  }

  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(distance >= 10000 ? 0 : 1)}km`;
  }

  return `${distance.toLocaleString()}m`;
}

function getRouteStepTypeLabel(type: TravelRouteStep['type']) {
  if (type === 'subway') {
    return '지하철';
  }

  if (type === 'bus') {
    return '버스';
  }

  if (type === 'car') {
    return '자차';
  }

  return '도보';
}

function getRouteStepBadgeClass(type: TravelRouteStep['type']) {
  if (type === 'subway') {
    return 'bg-[#eef5ff] text-[#2563eb]';
  }

  if (type === 'bus') {
    return 'bg-[#ecfdf5] text-[#059669]';
  }

  if (type === 'car') {
    return 'bg-[#fff7ed] text-[#ea580c]';
  }

  return 'bg-[#f5f1eb] text-[#6b7280]';
}

function getRouteDetailMeta(route: TravelInfo) {
  const items = [
    route.walkDistance ? `도보 ${route.walkDistance.toLocaleString()}m` : null,
    typeof route.transferCount === 'number' ? `환승 ${route.transferCount}회` : null,
    route.firstStartStation && route.lastEndStation
      ? `${route.firstStartStation} → ${route.lastEndStation}`
      : null,
    route.mode === 'car' && typeof route.taxiFare === 'number' && route.taxiFare > 0
      ? `예상 택시 ${Math.round(route.taxiFare).toLocaleString()}원`
      : null,
  ].filter(Boolean);

  return items.join(' · ');
}

function getMissingRouteStepMessage(route: TravelInfo) {
  if (route.source === 'estimated') {
    return route.mode === 'car'
      ? '자동차 상세 경로를 받지 못해 임시 예상 시간만 표시 중이에요.'
      : '대중교통 상세 경로를 받지 못해 임시 예상 시간만 표시 중이에요.';
  }

  return '실시간 경로는 받았지만 단계 안내가 비어 있어 요약만 표시 중이에요.';
}

function getInitialTravelMode(participants: Participant[]): DisplayTravelMode {
  const hasCar = participants.some((participant) => participant.travelMode === 'car');
  const hasTransit = participants.some((participant) => (participant.travelMode ?? 'transit') !== 'car');

  if (hasCar && hasTransit) {
    return 'preferred';
  }

  return hasCar ? 'car' : 'transit';
}

export function ResultScreen({
  winner,
  participants,
  selectedCategory,
  selectionMode: _selectionMode,
  currentUser = null,
  routeSnapshot = null,
  redrawControl = null,
  onBack,
  onNewDraw,
  onHome,
}: ResultScreenProps) {
  const initialCategory = useMemo(
    () => getInitialCategory(selectedCategory, currentUser),
    [currentUser, selectedCategory],
  );
  const activeMeetCategory =
    meetCategories.find((category) => category.key === selectedCategory) ?? meetCategories[0];
  const initialTravelMode = useMemo(() => getInitialTravelMode(participants), [participants]);
  const groupGenderContext = useMemo(
    () => buildGroupGenderContext(participants),
    [participants],
  );
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [contentCategory, setContentCategory] = useState<ContentCategoryKey>(initialCategory);
  const [detailQuery, setDetailQuery] = useState(() =>
    getInitialDetail(initialCategory, selectedCategory, groupGenderContext, currentUser),
  );
  const [searchInput, setSearchInput] = useState(detailQuery);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [travelMode, setTravelMode] = useState<DisplayTravelMode>(initialTravelMode);
  const [expandedTravelKeys, setExpandedTravelKeys] = useState<string[]>([]);
  const [copiedPlaceShare, setCopiedPlaceShare] = useState(false);
  const [copiedRecommendationShareId, setCopiedRecommendationShareId] = useState<string | null>(null);
  const [visibleRecommendationCount, setVisibleRecommendationCount] = useState(6);
  const [parkingPlaces, setParkingPlaces] = useState<ParkingPlace[]>([]);
  const [parkingStatus, setParkingStatus] = useState<ParkingSearchStatus>('idle');
  const {
    transitTravelInfo,
    carTravelInfo,
    status: carTravelStatus,
    error: carTravelError,
    transitStatus,
    transitError,
  } = useWinnerTravelInfo(participants, winner, routeSnapshot);

  const contentMeta = contentCategoryDefinitions[contentCategory];
  const recommendationOptions = useMemo(
    () => ({
      selectedMeetCategory: selectedCategory,
      userVibe: currentUser?.preferences.vibe ?? '',
      favoriteKeywords: currentUser?.preferences.favoriteKeywords ?? [],
      groupGenderContext,
    }),
    [
      currentUser?.preferences.favoriteKeywords,
      currentUser?.preferences.vibe,
      groupGenderContext,
      selectedCategory,
    ],
  );
	  const {
	    items: recommendationItems,
	    status: recommendationStatus,
	    error: recommendationError,
	    query,
	  } = useContentRecommendations(winner, contentCategory, detailQuery, recommendationOptions);

  const selectedPlace =
    recommendationItems.find((item) => item.id === selectedPlaceId) ??
    recommendationItems[0] ??
    null;
  const hasMixedTravelModes = useMemo(() => {
    const hasCar = participants.some((participant) => participant.travelMode === 'car');
    const hasTransit = participants.some(
      (participant) => (participant.travelMode ?? 'transit') !== 'car',
    );

    return hasCar && hasTransit;
  }, [participants]);
  const redrawButtonLabel = !redrawControl
    ? '지역 다시 뽑기'
    : redrawControl.canReset
      ? '지역 다시 뽑기'
      : redrawControl.hasMajority
        ? '다시뽑기 가능'
        : redrawControl.hasRequested
          ? `동의 완료 ${redrawControl.voteCount}/${redrawControl.requiredVotes}`
          : `다시뽑기 동의 ${redrawControl.voteCount}/${redrawControl.requiredVotes}`;
  const redrawButtonDisabled = Boolean(
    redrawControl?.isBusy ||
      (redrawControl &&
        !redrawControl.canReset &&
        (redrawControl.hasRequested || redrawControl.hasMajority)),
  );
  const redrawStatusText = !redrawControl?.isOnlineRoom
    ? null
    : redrawControl.message
      ? redrawControl.message
      : redrawControl.canReset
        ? '바로 다시 뽑을 수 있어요.'
        : redrawControl.hasMajority
          ? '다시뽑기를 열 수 있어요.'
          : redrawControl.requiredVotes <= 1
            ? '다시뽑기를 누르면 새 후보를 열 수 있어요.'
            : `다시뽑기는 ${redrawControl.requiredVotes}명이 동의하면 열려요.`;

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
  const preferredTravelInfo = useMemo(
    () =>
      participants.map((participant) => {
        const source = participant.travelMode === 'car' ? carTravelInfo : transitTravelInfo;
        return (
          source.find((info) => info.participantId === participant.id) ??
          transitTravelInfo.find((info) => info.participantId === participant.id) ??
          carTravelInfo.find((info) => info.participantId === participant.id)
        );
      }).filter((info): info is TravelInfo => Boolean(info)),
    [carTravelInfo, participants, transitTravelInfo],
  );
  const preferredSummary = useMemo(
    () => getTravelSummary(preferredTravelInfo),
    [preferredTravelInfo],
  );
  const selectedTravelInfo =
    travelMode === 'preferred'
      ? preferredTravelInfo
      : travelMode === 'transit'
        ? transitTravelInfo
        : carTravelInfo;
  const selectedTravelSummary =
    travelMode === 'preferred'
      ? preferredSummary
      : travelMode === 'transit'
        ? transitSummary
        : carSummary;
  const selectedTravelSourceLabel =
    travelMode === 'preferred'
      ? '각자 선택한 이동수단'
      : getTravelSourceLabel(travelMode, selectedTravelInfo);
  const shouldShowParkingInfo =
    travelMode === 'car' ||
    (travelMode === 'preferred' &&
      participants.some((participant) => participant.travelMode === 'car'));
  const handleMapRouteSelect = (participantId: string) => {
    const routeKey = `${travelMode}:${participantId}`;

    setExpandedTravelKeys((current) =>
      current.includes(routeKey) ? current : [...current, routeKey],
    );
    setIsConfirmed(false);
    window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 0);
  };

  const recommendedDetailButtons = useMemo(() => {
    const preferred = currentUser?.preferences.favoriteKeywords ?? [];
    const defaults = getContentCategoryDetails(contentCategory, selectedCategory, groupGenderContext);
    const ordered =
      selectedCategory === 'date' ? [...defaults, ...preferred] : [...preferred, ...defaults];

    return ordered.filter((detail, index) => ordered.indexOf(detail) === index).slice(0, 6);
  }, [contentCategory, currentUser?.preferences.favoriteKeywords, groupGenderContext, selectedCategory]);

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
    const nextDetail = getInitialDetail(
      nextCategory,
      selectedCategory,
      groupGenderContext,
      currentUser,
    );

    setContentCategory(nextCategory);
    setDetailQuery(nextDetail);
    setSearchInput(nextDetail);
    setSelectedPlaceId(null);
    setIsConfirmed(false);
    setTravelMode(initialTravelMode);
    setExpandedTravelKeys([]);
  }, [winner.id, selectedCategory, currentUser, initialTravelMode, groupGenderContext]);

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

  useEffect(() => {
    let cancelled = false;

    if (!shouldShowParkingInfo) {
      setParkingPlaces([]);
      setParkingStatus('idle');
      return () => {
        cancelled = true;
      };
    }

    const loadParkingPlaces = async () => {
      setParkingPlaces([]);
      setParkingStatus('loading');

      const collected: NearbySearchItem[] = [];

      for (const searchQuery of getParkingSearchQueries(winner)) {
        try {
          const results = await fetchNearbySearchResults(searchQuery, 6, 'comment');
          collected.push(...results);

          if (getUniqueParkingPlaces(collected).length >= PARKING_RESULT_LIMIT) {
            break;
          }
        } catch {
          // 주차장 정보는 보조 정보라 실패해도 결과 화면은 그대로 둔다.
        }
      }

      if (cancelled) {
        return;
      }

      const nextParkingPlaces = getUniqueParkingPlaces(collected);
      setParkingPlaces(nextParkingPlaces);
      setParkingStatus(nextParkingPlaces.length ? 'ready' : 'empty');
    };

    void loadParkingPlaces();

    return () => {
      cancelled = true;
    };
  }, [shouldShowParkingInfo, winner.id, winner.name, winner.district]);

  const handleChangeCategory = (category: ContentCategoryKey) => {
    const nextDetail = getInitialDetail(
      category,
      selectedCategory,
      groupGenderContext,
      currentUser,
    );
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
      getRandomCategoryDetail(contentCategory, selectedCategory, groupGenderContext);
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

  const handleSharePlace = async () => {
    const placeUrl = buildNaverMapSearchLink(winner.name);
    const shareText = [
      `KoK 약속장소: ${winner.name}`,
      participants.length
        ? `참여자: ${participants.map((participant) => participant.name).join(', ')}`
        : null,
      selectedTravelSummary.averageDuration
        ? `평균 이동시간: ${selectedTravelSummary.averageDuration}분`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      if (navigator.share) {
        await navigator.share({
          title: `KoK 약속장소 ${winner.name}`,
          text: shareText,
          url: placeUrl,
        });
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${placeUrl}`);
      }

      setCopiedPlaceShare(true);
      window.setTimeout(() => setCopiedPlaceShare(false), 1600);
    } catch {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${placeUrl}`);
        setCopiedPlaceShare(true);
        window.setTimeout(() => setCopiedPlaceShare(false), 1600);
      } catch {
        // 공유 실패는 사용 흐름을 막지 않는다.
      }
    }
  };

  const handleShareRecommendationPlace = async (place: ContentRecommendationItem) => {
    const placeKeyword = getNaverMapKeyword(place) || place.name;
    const placeUrl = buildNaverMapSearchLink(placeKeyword);
    const shareText = [
      `KoK 약속장소: ${place.name}`,
      winner.name ? `지역: ${winner.name}` : null,
      place.roadAddress || place.address || null,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      if (navigator.share) {
        await navigator.share({
          title: `KoK 약속장소 ${place.name}`,
          text: shareText,
          url: placeUrl,
        });
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${placeUrl}`);
      }

      setCopiedRecommendationShareId(place.id);
      window.setTimeout(() => setCopiedRecommendationShareId(null), 1600);
    } catch {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${placeUrl}`);
        setCopiedRecommendationShareId(place.id);
        window.setTimeout(() => setCopiedRecommendationShareId(null), 1600);
      } catch {
        // 공유 실패는 추천 흐름을 막지 않는다.
      }
    }
  };

  useEffect(() => {
    setVisibleRecommendationCount(6);
    setSelectedPlaceId(null);
  }, [contentCategory, detailQuery, winner.id]);

  return (
    <div className="min-h-screen bg-[#fbf8fb] pb-28 text-[#1f2a44]">
      <header className="sticky top-0 z-30 flex items-center justify-between rounded-b-[2rem] bg-[#f5f1eb]/88 px-6 py-4 shadow-[0_10px_30px_rgba(26,26,46,0.08)] backdrop-blur-md">
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1f2a44] text-white shadow-sm">
          <Compass className="h-5 w-5" />
        </button>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-2xl font-black tracking-[-0.06em] text-[#1f2a44]">
          KoK
        </h1>
        <button
          type="button"
          onClick={onHome}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#1f2a44] shadow-sm transition-transform active:scale-95"
          aria-label="홈으로 이동"
        >
          <Home className="h-5 w-5" />
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
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleSharePlace}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm text-[#1f2a44] shadow-sm transition-transform active:scale-95"
              >
                {copiedPlaceShare ? (
                  <CheckCircle2 className="h-4 w-4 text-[#22c55e]" />
                ) : navigator.share ? (
                  <Share2 className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copiedPlaceShare ? '공유됨' : '약속장소 공유'}
              </button>
              <button
                onClick={() => setIsConfirmed((previous) => !previous)}
                className={`inline-flex h-12 items-center justify-center rounded-2xl px-5 text-sm transition-transform active:scale-95 ${
                  isConfirmed
                    ? 'bg-[#f5f1eb] text-[#1a1a2e]'
                    : 'bg-[#ff7b6b] text-white shadow-sm'
                }`}
              >
                {isConfirmed ? '결과 보기' : '주변 정보 보기'}
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

          {redrawStatusText && (
            <div className="mt-4 rounded-2xl bg-[#f8fafc] px-4 py-3 text-sm text-[#667085]">
              {redrawStatusText}
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

        {!isConfirmed && (
        <section className="mb-6 rounded-[1.75rem] bg-white p-5 shadow-[0_10px_30px_rgba(26,26,46,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xl font-bold tracking-[-0.04em] text-[#1f2a44]">이동 정보</div>
              <div className="mt-1 text-sm text-[#76777e]">
                평균 {selectedTravelSummary.averageDuration}분 · 소요시간 차이{' '}
                {selectedTravelSummary.spreadDuration}분 · {selectedTravelSourceLabel}
              </div>
            </div>

            <div
              className={`grid gap-2 rounded-full bg-[#f5f1eb] p-1 ${
                hasMixedTravelModes ? 'grid-cols-3' : 'grid-cols-2'
              }`}
            >
              {[
                ...(hasMixedTravelModes
                  ? [{ key: 'preferred' as const, label: '각자 선택', summary: preferredSummary }]
                  : []),
                { key: 'transit' as const, label: '대중교통', summary: transitSummary },
                { key: 'car' as const, label: '자동차', summary: carSummary },
              ].map((item) => {
                const active = travelMode === item.key;

                return (
                  <button
                    key={item.key}
                    type="button"
	                    onClick={() => {
	                      setTravelMode(item.key);
	                      setExpandedTravelKeys([]);
	                    }}
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
		              const participant = participants.find((item) => item.id === info.participantId);
		              const rowTravelMode =
		                travelMode === 'preferred'
		                  ? info.mode ?? participant?.travelMode ?? 'transit'
		                  : travelMode;
		              const isCar = rowTravelMode === 'car';
		              const travelKey = `${travelMode}:${info.participantId}`;
			              const isTravelExpanded = expandedTravelKeys.includes(travelKey);
	              const routeSteps = isCar ? [] : info.routeSteps ?? [];
	              const routeMeta = getRouteDetailMeta(info);
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
                <div key={travelKey} className="rounded-[1.5rem] border border-[#f0edf0] bg-[#fbf8fb] p-4 shadow-[0_8px_22px_rgba(26,26,46,0.04)]">
	                  <div className="flex items-center justify-between gap-3">
	                    <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
	                      <div
	                        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm text-white"
	                        style={{ backgroundColor: color }}
	                      >
	                        {participant?.avatarUrl ? (
	                          <img
	                            src={participant.avatarUrl}
	                            alt=""
	                            className="h-full w-full object-cover"
	                          />
	                        ) : (
	                          info.participantName.charAt(0)
	                        )}
	                      </div>
	                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="truncate text-sm font-semibold text-[#1f2a44]">
                          {info.participantName}
                        </div>
                        <div className="mt-0.5 text-xs text-[#7a8491]">{feeText}</div>
	                        {!isCar && info.routeSummary ? (
	                          <div className="mt-1 truncate text-xs text-[#44505b]">
                            {info.routeSummary}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="text-xl font-black tracking-[-0.05em] text-[#1f2a44]">{info.duration}분</div>
                      <div className="text-xs text-[#7a8491]">{getTravelDistanceLabel(info)}</div>
                    </div>
                  </div>

	                  {!isCar ? (
	                    <button
	                      type="button"
	                      onClick={() =>
		                        setExpandedTravelKeys((current) =>
		                          current.includes(travelKey)
		                            ? current.filter((key) => key !== travelKey)
		                            : [...current, travelKey],
		                        )
	                      }
	                      className="mt-3 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs text-[#6b7280] shadow-sm transition-transform active:scale-95"
	                    >
	                      {isTravelExpanded ? (
	                        <ChevronUp className="h-3.5 w-3.5" />
	                      ) : (
	                        <ChevronDown className="h-3.5 w-3.5" />
	                      )}
	                      {isTravelExpanded ? '상세 접기' : '상세 경로'}
	                    </button>
	                  ) : null}

	                  {isTravelExpanded && !isCar ? (
                    <div className="mt-3 border-t border-[#eef2f6] pt-3">
                      {routeMeta ? (
                        <div className="mb-2 rounded-2xl bg-white px-3 py-2 text-xs text-[#6b7280]">
                          {routeMeta}
                        </div>
                      ) : null}

                      {routeSteps.length ? (
                        <ol className="space-y-2">
                          {routeSteps.map((step, stepIndex) => {
                            const stepDistance = formatRouteStepDistance(step.distance);
                            const stepMeta = [
                              step.duration ? `${step.duration}분` : null,
                              stepDistance,
                              step.stationCount ? `${step.stationCount}개 정류장` : null,
                            ].filter(Boolean);

                            return (
                              <li
                                key={`${travelKey}:step:${stepIndex}`}
                                className="flex gap-2 rounded-2xl bg-white px-3 py-2"
                              >
                                <span
                                  className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${getRouteStepBadgeClass(step.type)}`}
                                >
                                  {getRouteStepTypeLabel(step.type)}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold text-[#1f2a44]">
                                    {step.label}
                                  </div>
                                  {step.from || step.to ? (
                                    <div className="mt-0.5 truncate text-[11px] text-[#8a94a2]">
                                      {[step.from, step.to].filter(Boolean).join(' → ')}
                                    </div>
                                  ) : null}
                                  {stepMeta.length ? (
                                    <div className="mt-1 text-[11px] text-[#8a94a2]">
                                      {stepMeta.join(' · ')}
                                    </div>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <div className="rounded-2xl bg-white px-3 py-2 text-xs text-[#8a94a2]">
                          {getMissingRouteStepMessage(info)}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {shouldShowParkingInfo ? (
            <div className="mt-4 rounded-[1.5rem] border border-[#eef2f6] bg-[#f8fafc] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-bold tracking-[-0.02em] text-[#1f2a44]">
                  주차장 정보
                </div>
                <a
                  href={buildNaverMapSearchLink(`${winner.name} 주차장`)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-full bg-white px-3 text-xs text-[#44505b] shadow-sm"
                >
                  더보기
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              {parkingStatus === 'loading' ? (
                <div className="rounded-2xl bg-white px-4 py-3 text-xs text-[#7a8491]">
                  목적지 주변 주차장을 찾는 중이에요.
                </div>
              ) : null}

              {parkingPlaces.length ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {parkingPlaces.map((place) => (
                    <a
                      key={place.id}
                      href={place.link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_6px_16px_rgba(26,26,46,0.04)] transition-transform active:scale-[0.99]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fff7ed] text-sm font-black text-[#ea580c]">
                        P
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#1f2a44]">
                          {place.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[#7a8491]">
                          {place.address || place.categoryPath || `${winner.name} 근처`}
                        </span>
                      </span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-[#98a2b3]" />
                    </a>
                  ))}
                </div>
              ) : null}

              {parkingStatus === 'empty' ? (
                <div className="rounded-2xl bg-white px-4 py-3 text-xs text-[#7a8491]">
                  주변 주차장 정보를 찾지 못했어요.
                </div>
              ) : null}
            </div>
          ) : null}

          {travelMode === 'transit' && transitStatus !== 'ready' ? (
            <div className="mt-4 rounded-2xl bg-[#f8fbfd] px-4 py-3 text-xs text-[#6b7280]">
              {transitError ?? '대중교통 경로를 확인하는 중입니다.'}
            </div>
          ) : null}

          {travelMode === 'car' && carTravelStatus !== 'ready' ? (
            <div className="mt-4 rounded-2xl bg-[#f8fbfd] px-4 py-3 text-xs text-[#6b7280]">
              {carTravelError ?? '자동차 경로를 확인하는 중입니다.'}
            </div>
          ) : null}

          {travelMode === 'preferred' &&
          (transitStatus !== 'ready' || carTravelStatus !== 'ready') ? (
            <div className="mt-4 rounded-2xl bg-[#f8fbfd] px-4 py-3 text-xs text-[#6b7280]">
              {[transitError, carTravelError].filter(Boolean).join(' ') ||
                '각자 선택한 이동수단 기준으로 경로를 확인하는 중입니다.'}
            </div>
          ) : null}
        </section>
        )}

        {isConfirmed && (
          <>
	          <div className="mb-6">
	            <div className="mb-3 text-lg text-[#1a1a2e]">주변 인기 장소</div>
	            <MapView
              participants={participants}
              candidates={[winner]}
              selectedCandidate={winner}
              selectedRoutes={selectedTravelInfo}
              reachableCandidateIds={[winner.id]}
              nearbyPlaces={rankedMapPlaces}
              onRouteSelect={handleMapRouteSelect}
              colors={PARTICIPANT_COLORS}
            />
          </div>

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
              {(recommendationError || recommendationStatus === 'loading') && (
                <p className="mt-1 text-sm leading-relaxed text-[#6b7280]">
                  {recommendationError ?? `${winner.name} 근처 ${contentMeta.label}를 찾는 중이에요.`}
                </p>
              )}
            </div>
          </div>

          {recommendationStatus === 'loading' && (
            <div className="mt-5 rounded-2xl bg-[#faf7f2] px-4 py-4 text-sm text-[#6b7280]">
              {winner.name} 근처 인기 장소를 찾는 중이에요.
            </div>
          )}

          {recommendationStatus === 'ready' && recommendationItems.length > 0 && (
            <div className="mt-5 grid gap-3">
              {recommendationItems.slice(0, visibleRecommendationCount).map((item) => {
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

                        {item.highlights.length ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {item.highlights.map((highlight) => (
                              <span
                                key={`${item.id}:${highlight}`}
                                className="rounded-full bg-[#f5f1eb] px-2.5 py-1 text-[11px] text-[#44505b]"
                              >
                                {highlight}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        <div className="mt-3 flex items-center gap-2 text-xs text-[#6b7280]">
                          <MapPin className="h-3.5 w-3.5 text-[#ff7b6b]" />
                          <span>{item.roadAddress || item.address || `${winner.name} 근처`}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleShareRecommendationPlace(item);
                          }}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#1f2a44] px-4 text-sm text-white shadow-sm transition-transform active:scale-95"
                        >
                          {copiedRecommendationShareId === item.id ? '공유됨' : '공유'}
                          {copiedRecommendationShareId === item.id ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <Share2 className="h-4 w-4" />
                          )}
                        </button>
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
              {recommendationItems.length > visibleRecommendationCount ? (
                <button
                  type="button"
                  onClick={() =>
                    setVisibleRecommendationCount((current) =>
                      Math.min(current + 4, recommendationItems.length),
                    )
                  }
                  className="h-12 rounded-2xl border border-[#e8edf3] bg-white text-sm font-semibold text-[#1f2a44] shadow-sm transition-transform active:scale-95"
                >
                  더보기 {Math.min(4, recommendationItems.length - visibleRecommendationCount)}개
                </button>
              ) : null}
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
          </>
        )}
      </div>
    </div>
  );
}
