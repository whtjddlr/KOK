import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Coffee,
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
import { AuthUser } from '../lib/auth';
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
import { getRoomShareUrl } from '../lib/rooms';

interface ResultScreenProps {
  winner: Candidate;
  participants: Participant[];
  selectedCategory: MeetCategoryKey;
  selectionMode: SelectionModeKey;
  currentUser?: AuthUser | null;
  routeSnapshot?: WinnerRouteSnapshot | null;
  onlineRoomCode?: string | null;
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

const PARTICIPANT_COLORS = ['#FF6B5F', '#16241D', '#F59E0B', '#E85F55', '#667280', '#CD7C2F'];

type DisplayTravelMode = TravelMode | 'preferred';
type ParkingSearchStatus = 'idle' | 'loading' | 'ready' | 'empty';
type SubwayLineKey =
  | '1호선'
  | '2호선'
  | '3호선'
  | '4호선'
  | '5호선'
  | '6호선'
  | '7호선'
  | '8호선'
  | '9호선'
  | '신분당선'
  | '수인분당선'
  | '경의중앙선'
  | '경춘선'
  | '공항철도'
  | '김포골드라인'
  | '인천1호선'
  | '인천2호선'
  | '서해선'
  | '우이신설선'
  | '신림선'
  | '경강선'
  | '에버라인';

interface SubwayLineMeta {
  label: SubwayLineKey;
  color: string;
  marker: string;
}

interface ParkingPlace {
  id: string;
  name: string;
  categoryPath: string;
  address: string;
  link: string;
}

const PARKING_RESULT_LIMIT = 4;
const PARKING_KEYWORDS = ['주차', 'parking', '파킹', '공영', '민영'];
const SUBWAY_LINE_META: Record<SubwayLineKey, SubwayLineMeta> = {
  '1호선': { label: '1호선', color: '#0052A4', marker: '1' },
  '2호선': { label: '2호선', color: '#00A84D', marker: '2' },
  '3호선': { label: '3호선', color: '#EF7C1C', marker: '3' },
  '4호선': { label: '4호선', color: '#00A5DE', marker: '4' },
  '5호선': { label: '5호선', color: '#996CAC', marker: '5' },
  '6호선': { label: '6호선', color: '#CD7C2F', marker: '6' },
  '7호선': { label: '7호선', color: '#747F00', marker: '7' },
  '8호선': { label: '8호선', color: '#E6186C', marker: '8' },
  '9호선': { label: '9호선', color: '#BDB092', marker: '9' },
  신분당선: { label: '신분당선', color: '#D4003B', marker: '신분당' },
  수인분당선: { label: '수인분당선', color: '#F5A200', marker: '수인' },
  경의중앙선: { label: '경의중앙선', color: '#77C4A3', marker: '경의' },
  경춘선: { label: '경춘선', color: '#0C8E72', marker: '경춘' },
  공항철도: { label: '공항철도', color: '#0090D2', marker: '공항' },
  김포골드라인: { label: '김포골드라인', color: '#A17800', marker: '김포' },
  인천1호선: { label: '인천1호선', color: '#7CA8D5', marker: '인천1' },
  인천2호선: { label: '인천2호선', color: '#ED8B00', marker: '인천2' },
  서해선: { label: '서해선', color: '#8FC31F', marker: '서해' },
  우이신설선: { label: '우이신설선', color: '#B7C452', marker: '우이' },
  신림선: { label: '신림선', color: '#6789CA', marker: '신림' },
  경강선: { label: '경강선', color: '#0054A6', marker: '경강' },
  에버라인: { label: '에버라인', color: '#77C043', marker: '용인' },
};
const STATION_LINE_LABELS: Record<string, SubwayLineKey[]> = {
  강남: ['2호선', '신분당선'],
  양재: ['3호선', '신분당선'],
  양재시민의숲: ['신분당선'],
  청계산입구: ['신분당선'],
  정부과천청사: ['4호선'],
  과천: ['4호선'],
  인덕원: ['4호선'],
  평촌: ['4호선'],
  범계: ['4호선'],
  홍대: ['2호선', '경의중앙선', '공항철도'],
  홍대입구: ['2호선', '경의중앙선', '공항철도'],
  부천시청: ['7호선'],
  사당: ['2호선', '4호선'],
  서울대입구: ['2호선'],
  낙성대: ['2호선'],
  봉천: ['2호선'],
  이수: ['4호선', '7호선'],
  신림: ['2호선', '신림선'],
  보라매: ['7호선', '신림선'],
  신대방삼거리: ['7호선'],
  장승배기: ['7호선'],
  상도: ['7호선'],
  숭실대입구: ['7호선'],
  잠실: ['2호선', '8호선'],
  건대: ['2호선', '7호선'],
  건대입구: ['2호선', '7호선'],
  여의도: ['5호선', '9호선'],
  신촌: ['2호선'],
  합정: ['2호선', '6호선'],
  성수: ['2호선'],
  부평: ['1호선', '인천1호선'],
  판교: ['신분당선', '경강선'],
  정자: ['신분당선', '수인분당선'],
  미금: ['신분당선', '수인분당선'],
  죽전: ['수인분당선'],
  수지구청: ['신분당선'],
  광교중앙: ['신분당선'],
  영통: ['수인분당선'],
  기흥: ['수인분당선', '에버라인'],
  수원: ['1호선', '수인분당선'],
  신도림: ['1호선', '2호선'],
  서울: ['1호선', '4호선', '공항철도', '경의중앙선'],
  서울역: ['1호선', '4호선', '공항철도', '경의중앙선'],
  왕십리: ['2호선', '5호선', '경의중앙선', '수인분당선'],
  을지로: ['2호선'],
  을지로입구: ['2호선'],
  광화문: ['5호선'],
  문래: ['2호선'],
  노원: ['4호선', '7호선'],
  안양: ['1호선'],
  정발산: ['3호선'],
  서현: ['수인분당선'],
  인천대입구: ['인천1호선'],
  김포공항: ['5호선', '9호선', '공항철도', '김포골드라인', '서해선'],
  용산: ['1호선', '경의중앙선'],
  망원: ['6호선'],
  종로3가: ['1호선', '3호선', '5호선'],
  영등포: ['1호선'],
  송도: ['인천1호선'],
  센트럴파크: ['인천1호선'],
  예술회관: ['인천1호선'],
  구월: ['인천1호선'],
  철산: ['7호선'],
  안산중앙: ['4호선', '수인분당선'],
};
const SUBWAY_LINE_PATTERN =
  /(?:수도권\s*)?(김포골드라인|수인분당선|경의중앙선|우이신설선|공항철도|신분당선|인천\s?1호선|인천\s?2호선|경춘선|서해선|신림선|경강선|에버라인|[1-9]호선)/g;

function getNaverMapKeyword(place: ContentRecommendationItem) {
  return [place.name, place.roadAddress || place.address].filter(Boolean).join(' ');
}

function normalizeStationLookupText(value: string) {
  return value
    .replace(/\s+/g, '')
    .replace(/역/g, '')
    .replace(/문화의거리|샤로수길|라페스타|센트럴파크|로데오/g, '')
    .trim();
}

function canonicalizeSubwayLineLabel(label: string): SubwayLineKey | null {
  const compactLabel = label.replace(/\s+/g, '').replace(/^수도권/, '');

  if (compactLabel === '김포골드' || compactLabel === '김포골드라인') {
    return '김포골드라인';
  }

  if (compactLabel === '인천1호선') {
    return '인천1호선';
  }

  if (compactLabel === '인천2호선') {
    return '인천2호선';
  }

  if (compactLabel in SUBWAY_LINE_META) {
    return compactLabel as SubwayLineKey;
  }

  return null;
}

function getUniqueLineLabels(lineLabels: Array<SubwayLineKey | null | undefined>) {
  const seen = new Set<SubwayLineKey>();
  const uniqueLabels: SubwayLineKey[] = [];

  lineLabels.forEach((lineLabel) => {
    if (!lineLabel || seen.has(lineLabel)) {
      return;
    }

    seen.add(lineLabel);
    uniqueLabels.push(lineLabel);
  });

  return uniqueLabels;
}

function extractSubwayLineLabels(text: string) {
  const matches = text.matchAll(SUBWAY_LINE_PATTERN);

  return getUniqueLineLabels(
    Array.from(matches).map((match) => canonicalizeSubwayLineLabel(match[1])),
  );
}

function getExactStationLineLabelsByName(stationName: string) {
  const normalizedStationName = normalizeStationLookupText(stationName);
  const stationMatch = Object.entries(STATION_LINE_LABELS).find(
    ([stationKey]) => normalizedStationName === normalizeStationLookupText(stationKey),
  );

  return stationMatch?.[1] ?? [];
}

function isStationSignCandidate(winner: Candidate) {
  return winner.name.trim().endsWith('역');
}

function routeStepTouchesStation(step: TravelRouteStep, stationName: string) {
  const normalizedStationName = normalizeStationLookupText(stationName);

  if (!normalizedStationName) {
    return false;
  }

  return [step.from, step.to]
    .filter(Boolean)
    .some((value) => normalizeStationLookupText(value ?? '').includes(normalizedStationName));
}

function getRouteSubwayLineLabels(winner: Candidate, travelInfo: TravelInfo[]) {
  const lineLabels = travelInfo.flatMap((info) => {
    const subwaySteps = info.routeSteps?.filter((step) => step.type === 'subway') ?? [];

    if (!subwaySteps.length) {
      return [];
    }

    const destinationStep =
      subwaySteps.find((step) => routeStepTouchesStation(step, winner.name)) ??
      subwaySteps[subwaySteps.length - 1];

    return extractSubwayLineLabels(destinationStep.label);
  });

  return getUniqueLineLabels(lineLabels);
}

function getStationProfile(winner: Candidate, travelInfo: TravelInfo[]) {
  const isStation = isStationSignCandidate(winner);
  const directLineLabels = isStation ? getExactStationLineLabelsByName(winner.name) : [];
  const hintLineLabels = isStation ? extractSubwayLineLabels(winner.routeHint) : [];
  const routeLineLabels = getRouteSubwayLineLabels(winner, travelInfo);
  const lineLabels = getUniqueLineLabels([
    ...directLineLabels,
    ...hintLineLabels,
    ...(directLineLabels.length || hintLineLabels.length ? [] : routeLineLabels),
  ]);
  const lines = lineLabels.map((lineLabel) => SUBWAY_LINE_META[lineLabel]);

  return {
    primaryLine: lines[0] ?? null,
  };
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
  return info.source === 'estimated' ? '예상 거리' : `${info.distance}km`;
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
    return 'bg-[#FFF0EE] text-[#E85F55]';
  }

  if (type === 'bus') {
    return 'bg-[#FFF7ED] text-[#CD7C2F]';
  }

  if (type === 'car') {
    return 'bg-[#FFF0EE] text-[#ea580c]';
  }

  return 'bg-[#FFFFFF] text-[#6E7C75]';
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
      ? '예상 자동차 이동시간 기준으로 요약 표시 중이에요.'
      : '예상 대중교통 이동시간 기준으로 요약 표시 중이에요.';
  }

  return '경로 단계는 요약으로 표시 중이에요.';
}

function getInitialTravelMode(participants: Participant[]): DisplayTravelMode {
  const hasCar = participants.some((participant) => participant.travelMode === 'car');
  const hasTransit = participants.some((participant) => (participant.travelMode ?? 'transit') !== 'car');

  if (hasCar && hasTransit) {
    return 'preferred';
  }

  return hasCar ? 'car' : 'transit';
}

function toDateTimeLocalValue(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function getDefaultCalendarDateTime() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(19, 0, 0, 0);
  return toDateTimeLocalValue(date);
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsValue(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ResultScreen({
  winner,
  participants,
  selectedCategory,
  selectionMode: _selectionMode,
  currentUser = null,
  routeSnapshot = null,
  onlineRoomCode = null,
  redrawControl = null,
  onBack,
  onNewDraw,
  onHome,
}: ResultScreenProps) {
  const initialCategory = useMemo(
    () => getInitialCategory(selectedCategory, currentUser),
    [currentUser, selectedCategory],
  );
  const initialTravelMode = useMemo(() => getInitialTravelMode(participants), [participants]);
  const groupGenderContext = useMemo(
    () => buildGroupGenderContext(participants),
    [participants],
  );
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [nearbyFiltersOpen, setNearbyFiltersOpen] = useState(false);
  const nearbyContentRef = useRef<HTMLElement | null>(null);
  const recommendationListRef = useRef<HTMLDivElement | null>(null);
  const [contentCategory, setContentCategory] = useState<ContentCategoryKey>(initialCategory);
  const [detailQuery, setDetailQuery] = useState(() =>
    getInitialDetail(initialCategory, selectedCategory, groupGenderContext, currentUser),
  );
  const [searchInput, setSearchInput] = useState(detailQuery);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [travelMode, setTravelMode] = useState<DisplayTravelMode>(initialTravelMode);
  const [expandedTravelKeys, setExpandedTravelKeys] = useState<string[]>([]);
  const [copiedPlaceShare, setCopiedPlaceShare] = useState(false);
  const [calendarDateTime, setCalendarDateTime] = useState(getDefaultCalendarDateTime);
  const [calendarSaved, setCalendarSaved] = useState(false);
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
        ? null
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

  const scrollElementIntoView = (element: HTMLElement | null | undefined, delay = 80) => {
    window.setTimeout(() => {
      if (!element) {
        return;
      }

      const targetTop = element.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });
    }, delay);
  };

  const scrollToNearbyContent = (delay = 80) => {
    scrollElementIntoView(nearbyContentRef.current, delay);
  };

  const scrollToRecommendationIndex = (index: number) => {
    window.setTimeout(() => {
      const nextCard = recommendationListRef.current?.querySelector<HTMLElement>(
        `[data-recommendation-index="${index}"]`,
      );

      scrollElementIntoView(nextCard ?? nearbyContentRef.current, 0);
    }, 80);
  };

  const handleToggleNearbyInfo = () => {
    const nextIsConfirmed = !isConfirmed;
    setIsConfirmed(nextIsConfirmed);

    if (nextIsConfirmed) {
      setNearbyFiltersOpen(false);
      scrollToNearbyContent();
    } else {
      window.setTimeout(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      }, 0);
    }
  };

  const handleToggleNearbyFilters = () => {
    const nextFiltersOpen = !nearbyFiltersOpen;
    setNearbyFiltersOpen(nextFiltersOpen);
    scrollToNearbyContent();
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
  const stationProfile = useMemo(
    () => getStationProfile(winner, transitTravelInfo.length ? transitTravelInfo : selectedTravelInfo),
    [selectedTravelInfo, transitTravelInfo, winner],
  );
  const stationAccent = stationProfile.primaryLine?.color ?? '#FF6B5F';
  const stationMarker = stationProfile.primaryLine?.marker;
  const stationNameLength = Array.from(winner.name.replace(/\s/g, '')).length;
  const stationNameSizeClass =
    stationNameLength >= 9
      ? 'text-[1.45rem] sm:text-[2.7rem]'
      : stationNameLength >= 7
        ? 'text-[1.75rem] sm:text-[3.1rem]'
        : stationNameLength >= 6
          ? 'text-[2.05rem] sm:text-[3.45rem]'
          : stationNameLength >= 5
            ? 'text-[2.35rem] sm:text-[4rem]'
            : 'text-[2.8rem] sm:text-6xl';
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
    setNearbyFiltersOpen(false);
    setTravelMode(initialTravelMode);
    setExpandedTravelKeys([]);
    setCalendarSaved(false);
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
    setNearbyFiltersOpen(false);
    scrollToNearbyContent(300);
  };

  const handleShowMoreRecommendations = () => {
    const firstNewIndex = visibleRecommendationCount;

    setVisibleRecommendationCount((current) =>
      Math.min(current + 4, recommendationItems.length),
    );
    scrollToRecommendationIndex(firstNewIndex);
  };

  const handleSharePlace = async () => {
    const placeUrl = buildNaverMapSearchLink(winner.name);
    const roomUrl = onlineRoomCode ? getRoomShareUrl(onlineRoomCode) : null;
    const shareText = [
      `KoK 약속장소: ${winner.name}`,
      participants.length
        ? `참여자: ${participants.map((participant) => participant.name).join(', ')}`
        : null,
      selectedTravelSummary.averageDuration
        ? `평균 이동시간: ${selectedTravelSummary.averageDuration}분`
        : null,
      roomUrl ? `약속방: ${roomUrl}` : null,
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

  const handleDownloadCalendar = () => {
    const startDate = new Date(calendarDateTime);

    if (Number.isNaN(startDate.getTime())) {
      return;
    }

    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    const placeUrl = buildNaverMapSearchLink(winner.name);
    const roomUrl = onlineRoomCode ? getRoomShareUrl(onlineRoomCode) : null;
    const participantNames = participants.map((participant) => participant.name).join(', ');
    const description = [
      `KoK이 추천한 약속 장소: ${winner.name}`,
      participantNames ? `참여자: ${participantNames}` : null,
      selectedTravelSummary.averageDuration
        ? `평균 이동시간: ${selectedTravelSummary.averageDuration}분`
        : null,
      `지도: ${placeUrl}`,
      roomUrl ? `약속방: ${roomUrl}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const safeWinnerName = winner.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'kok-place';
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KoK//Meeting Place//KO',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:kok-${winner.id}-${startDate.getTime()}@kok-meet.vercel.app`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(startDate)}`,
      `DTEND:${formatIcsDate(endDate)}`,
      `SUMMARY:${escapeIcsValue(`KoK 약속 - ${winner.name}`)}`,
      `LOCATION:${escapeIcsValue(winner.name)}`,
      `DESCRIPTION:${escapeIcsValue(description)}`,
      `URL:${placeUrl}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    downloadTextFile(`KoK-${safeWinnerName}.ics`, ics, 'text/calendar;charset=utf-8');
    setCalendarSaved(true);
    window.setTimeout(() => setCalendarSaved(false), 1800);
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

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [winner.id]);

  return (
    <div className="kok-screen-enter min-h-screen bg-[#F5F9F7] pb-28 text-[#16241D]">
      <header className="sticky top-0 z-30 flex items-center justify-end rounded-b-[2rem] bg-[#FFFFFF]/88 px-6 py-4 shadow-[0_10px_30px_rgba(20,35,29,0.08)] backdrop-blur-md">
        <h1 className="absolute left-1/2 -translate-x-1/2 text-2xl font-black tracking-[-0.06em] text-[#16241D]">
          KoK
        </h1>
        <button
          type="button"
          onClick={onHome}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#16241D] shadow-sm transition-transform active:scale-95"
          aria-label="홈으로 이동"
        >
          <Home className="h-5 w-5" />
        </button>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8">
        {!redrawControl?.isOnlineRoom && (
          <button
            onClick={onBack}
            className="mb-6 inline-flex h-11 items-center gap-2 rounded-full bg-white/90 px-4 text-sm text-[#16241D] shadow-sm"
          >
            <ChevronLeft className="h-4 w-4" />
            다시 고르기
          </button>
        )}

        <section className="mb-8 flex justify-center text-center" aria-label="약속 지역">
          <div className="w-full max-w-[36rem]">
            <div
              className="relative rounded-[999px] border-[7px] bg-white p-2 shadow-[0_18px_40px_rgba(20,35,29,0.12)]"
              style={{ borderColor: stationAccent }}
            >
              <div className="absolute inset-x-9 top-1/2 h-2 -translate-y-1/2 rounded-full opacity-20" style={{ backgroundColor: stationAccent }} />
              <div className="relative flex min-h-[7.5rem] items-center justify-center rounded-[999px] border border-[#D9E3DD] bg-[#FFFDF4] px-[6.6rem] py-4 sm:min-h-[8.5rem] sm:px-32">
                <div
                  className="absolute left-4 flex h-[4.8rem] w-[4.8rem] shrink-0 items-center justify-center rounded-full border-[7px] border-white text-2xl font-black text-white shadow-[0_0_0_1px_rgba(20,35,29,0.10)] sm:left-6 sm:h-24 sm:w-24 sm:text-3xl"
                  style={{ backgroundColor: stationAccent }}
                  aria-label={stationProfile.primaryLine?.label ?? '약속장소'}
                >
                  {stationMarker ? (
                    <span className="max-w-[3.3rem] leading-none">{stationMarker}</span>
                  ) : (
                    <MapPin className="h-8 w-8 sm:h-10 sm:w-10" />
                  )}
                </div>

                <div className="min-w-0 text-center">
                  <div className={`mx-auto max-w-full whitespace-nowrap font-black leading-none text-[#16241D] ${stationNameSizeClass}`}>
                    {winner.name}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        <div className="mb-6 rounded-[1.75rem] bg-white p-5 shadow-[0_10px_30px_rgba(20,35,29,0.08)]">
          <div className="flex flex-col gap-2 sm:grid sm:grid-cols-3">
              <button
                type="button"
                onClick={handleToggleNearbyInfo}
                className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-bold transition-transform active:scale-95 ${
                  isConfirmed
                    ? 'border border-[#E4EFE9] bg-white text-[#16241D]'
                    : 'bg-[#FF6B5F] text-white shadow-[0_10px_24px_rgba(255, 107, 95,0.22)]'
                }`}
              >
                <Sparkles className="h-4 w-4" />
                {isConfirmed ? '결과 보기' : '주변 보기'}
              </button>
              <button
                type="button"
                onClick={handleSharePlace}
                aria-label={`${winner.name} 약속장소 공유`}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#E4EFE9] bg-white px-5 text-sm text-[#16241D] shadow-sm transition-transform active:scale-95"
              >
                {copiedPlaceShare ? (
                  <CheckCircle2 className="h-4 w-4 text-[#FF6B5F]" />
                ) : navigator.share ? (
                  <Share2 className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copiedPlaceShare ? '공유됨' : '공유'}
              </button>
              <button
                type="button"
                onClick={handleRedrawClick}
                disabled={redrawButtonDisabled}
                aria-label={redrawButtonLabel}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#E4EFE9] bg-[#F5F9F7] px-5 text-sm text-[#16241D] transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {redrawButtonLabel}
                <RefreshCcw className="h-4 w-4" />
              </button>
          </div>

          {redrawStatusText && (
            <div className="mt-4 rounded-2xl bg-[#f8fafc] px-4 py-3 text-sm text-[#667085]">
              {redrawStatusText}
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-[#eef2f6] bg-[#f8fafc] px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-bold text-[#16241D]">
              <CalendarPlus className="h-4 w-4 text-[#FF6B5F]" />
              일정 메모
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="datetime-local"
                value={calendarDateTime}
                onChange={(event) => {
                  setCalendarDateTime(event.target.value);
                  setCalendarSaved(false);
                }}
                className="min-h-12 flex-1 rounded-2xl border border-[#E4EFE9] bg-white px-4 text-sm font-semibold text-[#16241D] outline-none transition focus:border-[#FF6B5F]"
                aria-label="약속 날짜와 시간"
              />
              <button
                type="button"
                onClick={handleDownloadCalendar}
                aria-label={`${winner.name} 약속 캘린더에 추가`}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[#E4EFE9] bg-white px-5 text-sm font-bold text-[#16241D] transition-transform active:scale-95"
              >
                {calendarSaved ? (
                  <CheckCircle2 className="h-4 w-4 text-[#FF6B5F]" />
                ) : (
                  <CalendarPlus className="h-4 w-4" />
                )}
                {calendarSaved ? '저장됨' : '캘린더에 추가'}
              </button>
            </div>
          </div>

        </div>

        {!isConfirmed && (
        <section className="mb-6 rounded-[1.75rem] bg-white p-5 shadow-[0_10px_30px_rgba(20,35,29,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xl font-bold tracking-[-0.04em] text-[#16241D]">이동 정보</div>
              <div className="mt-1 text-sm text-[#6E7C75]">
                평균 {selectedTravelSummary.averageDuration}분 · 소요시간 차이{' '}
                {selectedTravelSummary.spreadDuration}분 · {selectedTravelSourceLabel}
              </div>
            </div>

            <div
              className={`grid gap-2 rounded-full bg-[#FFFFFF] p-1 ${
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
                    aria-pressed={active}
                    aria-label={`${item.label} 기준 경로 보기, 평균 ${item.summary.averageDuration}분`}
                    className={`rounded-xl px-4 py-2 text-sm transition-all ${
                      active ? 'bg-[#16241D] text-white shadow-sm' : 'text-[#44534C]'
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
                <div key={travelKey} data-travel-card className="scroll-mt-24 rounded-[1.5rem] border border-[#F0F5F2] bg-[#F5F9F7] p-4 shadow-[0_8px_22px_rgba(20,35,29,0.04)]">
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
                        <div className="truncate text-sm font-semibold text-[#16241D]">
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
                      <div className="text-xl font-black tracking-[-0.05em] text-[#16241D]">{info.duration}분</div>
                      <div className="text-xs text-[#7a8491]">{getTravelDistanceLabel(info)}</div>
                    </div>
                  </div>

	                  {!isCar ? (
	                    <button
	                      type="button"
	                      onClick={(event) => {
	                        const willExpand = !isTravelExpanded;
	                        const cardElement = event.currentTarget.closest('[data-travel-card]');
	                        setExpandedTravelKeys((current) =>
	                          current.includes(travelKey)
	                            ? current.filter((key) => key !== travelKey)
	                            : [...current, travelKey],
	                        );

	                        if (willExpand) {
	                          scrollElementIntoView(cardElement as HTMLElement | null);
	                        }
	                      }}
	                      aria-expanded={isTravelExpanded}
	                      aria-label={`${info.participantName} 상세 경로 ${isTravelExpanded ? '접기' : '보기'}`}
	                      className="mt-3 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs text-[#6E7C75] shadow-sm transition-transform active:scale-95"
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
                        <div className="mb-2 rounded-2xl bg-white px-3 py-2 text-xs text-[#6E7C75]">
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
                                  <div className="text-xs font-semibold text-[#16241D]">
                                    {step.label}
                                  </div>
                                  {step.from || step.to ? (
                                    <div className="mt-0.5 truncate text-[11px] text-[#9AA8A1]">
                                      {[step.from, step.to].filter(Boolean).join(' → ')}
                                    </div>
                                  ) : null}
                                  {stepMeta.length ? (
                                    <div className="mt-1 text-[11px] text-[#9AA8A1]">
                                      {stepMeta.join(' · ')}
                                    </div>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <div className="rounded-2xl bg-white px-3 py-2 text-xs text-[#9AA8A1]">
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
                <div className="text-sm font-bold tracking-[-0.02em] text-[#16241D]">
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
                <div className="kok-loading-card rounded-2xl bg-white px-4 py-3 text-xs text-[#7a8491]">
                  <div className="flex items-center gap-3">
                    <div className="kok-route-loader scale-75">
                      <span />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[#16241D]">주차장을 찾는 중이에요</div>
                      <div className="mt-1 kok-loading-progress" />
                    </div>
                  </div>
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
                      className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_6px_16px_rgba(20,35,29,0.04)] transition-transform active:scale-[0.99]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFF0EE] text-sm font-black text-[#ea580c]">
                        P
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#16241D]">
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
            <div className="kok-loading-card mt-4 rounded-2xl bg-[#F5F9F7] px-4 py-3 text-xs text-[#6E7C75]">
              {transitError ?? '대중교통 경로를 확인하는 중입니다.'}
              {!transitError && <div className="mt-2 kok-loading-progress" />}
            </div>
          ) : null}

          {travelMode === 'car' && carTravelStatus !== 'ready' ? (
            <div className="kok-loading-card mt-4 rounded-2xl bg-[#F5F9F7] px-4 py-3 text-xs text-[#6E7C75]">
              {carTravelError ?? '자동차 경로를 확인하는 중입니다.'}
              {!carTravelError && <div className="mt-2 kok-loading-progress" />}
            </div>
          ) : null}

          {travelMode === 'preferred' &&
          (transitStatus !== 'ready' || carTravelStatus !== 'ready') ? (
            <div className="kok-loading-card mt-4 rounded-2xl bg-[#F5F9F7] px-4 py-3 text-xs text-[#6E7C75]">
              {[transitError, carTravelError].filter(Boolean).join(' ') ||
                '각자 선택한 이동수단 기준으로 경로를 확인하는 중입니다.'}
              {![transitError, carTravelError].filter(Boolean).length && (
                <div className="mt-2 kok-loading-progress" />
              )}
            </div>
          ) : null}
        </section>
        )}

        {isConfirmed && (
          <>
        <section
          ref={nearbyContentRef}
          className="mb-6 scroll-mt-24 rounded-[1.75rem] bg-white p-5 shadow-[0_10px_30px_rgba(20,35,29,0.08)]"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xl font-bold tracking-[-0.04em] text-[#16241D]">
                {winner.name} 근처 {detailQuery}
              </div>
              {(recommendationError || recommendationStatus === 'loading') && (
                <p className="mt-1 text-sm leading-relaxed text-[#6E7C75]">
                  {recommendationError ?? `${winner.name} 근처 ${contentMeta.label}를 찾는 중이에요.`}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleToggleNearbyFilters}
              aria-expanded={nearbyFiltersOpen}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#E4EFE9] bg-white px-4 text-sm font-semibold text-[#16241D] transition-transform active:scale-95"
            >
              조건 변경
              {nearbyFiltersOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>

          {nearbyFiltersOpen && (
            <div className="mt-4 rounded-[1.5rem] border border-[#E4EFE9] bg-[#F5F9F7] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex flex-wrap gap-2">
                  {contentCategoryOrder.map((category) => {
                    const meta = contentCategoryDefinitions[category];
                    const Icon = contentCategoryIcons[category];
                    const active = category === contentCategory;

                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => handleChangeCategory(category)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                          active ? 'text-white shadow-sm' : 'bg-white text-[#44505b]'
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

                <button
                  type="button"
                  onClick={handleRandomizeCategory}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-semibold text-[#16241D] transition-transform active:scale-95"
                >
                  카테고리 랜덤
                  <Shuffle className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 rounded-[1.25rem] bg-white p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="text-sm font-semibold text-[#16241D]">
                    {contentMeta.label} 세부 추천
                  </div>

                  <button
                    type="button"
                    onClick={handleRandomizeDetail}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#F5F9F7] px-4 text-sm text-[#16241D] transition-transform active:scale-95"
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
                        aria-pressed={active}
                        className={`rounded-full px-4 py-2 text-sm transition-all ${
                          active ? 'bg-[#16241D] text-white shadow-sm' : 'bg-[#F5F9F7] text-[#44505b]'
                        }`}
                      >
                        {detail}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-col gap-2 md:flex-row">
                  <div className="flex items-center gap-3 rounded-2xl border border-[#E4EFE9] bg-white px-4 py-3 md:flex-1">
                    <Search className="h-4 w-4 text-[#6E7C75]" />
                    <input
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleSubmitSearch();
                        }
                      }}
                      aria-label={`${contentMeta.label} 세부 키워드`}
                      placeholder={contentMeta.placeholder}
                      className="w-full bg-transparent text-sm text-[#16241D] outline-none placeholder:text-[#9AA8A1]"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSubmitSearch}
                    aria-label="추천 검색"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#16241D] px-5 text-sm text-white transition-transform active:scale-95"
                  >
                    검색
                    <Search className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {recommendationStatus === 'loading' && (
            <div className="kok-loading-card mt-5 rounded-2xl bg-[#FFF0EE] px-4 py-4 text-sm text-[#6E7C75]">
              <div className="flex items-center gap-3">
                <div className="kok-route-loader scale-75">
                  <span />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[#16241D]">
                    {winner.name} 근처 인기 장소를 찾는 중이에요
                  </div>
                  <div className="mt-1 text-xs text-[#7a8491]">후보를 모아서 보기 좋은 순서로 정리하고 있어요.</div>
                </div>
              </div>
              <div className="mt-3 kok-loading-progress" />
            </div>
          )}

          {recommendationStatus === 'ready' && recommendationItems.length > 0 && (
            <div ref={recommendationListRef} className="kok-stagger-list mt-5 grid gap-3">
              {recommendationItems.slice(0, visibleRecommendationCount).map((item, itemIndex) => {
                const active = selectedPlace?.id === item.id;

                return (
                  <article
                    key={item.id}
                    onClick={() => setSelectedPlaceId(item.id)}
                    data-recommendation-index={itemIndex}
                    className={`scroll-mt-24 rounded-[1.5rem] border p-4 text-left shadow-[0_8px_22px_rgba(20,35,29,0.04)] transition-transform active:scale-[0.99] ${
                      active ? 'border-[#16241D] bg-white' : 'border-[#E4EFE9] bg-[#fbfcfd]'
                    }`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="text-lg text-[#16241D]">{item.name}</div>
                        <div className="mt-1 text-sm text-[#6E7C75]">
                          {item.categoryPath || item.description}
                        </div>

                        <div className="mt-3 flex items-center gap-2 text-xs text-[#6E7C75]">
                          <MapPin className="h-3.5 w-3.5 text-[#FF6B5F]" />
                          <span>{item.roadAddress || item.address || `${winner.name} 근처`}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <a
                          href={buildNaverMapSearchLink(getNaverMapKeyword(item))}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${item.name} 네이버 지도에서 보기`}
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#16241D] px-4 text-sm text-white shadow-sm transition-transform active:scale-95"
                        >
                          네이버 보기
                          <ExternalLink className="h-4 w-4" />
                        </a>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleShareRecommendationPlace(item);
                          }}
                          aria-label={`${item.name} 공유`}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm text-[#16241D] shadow-sm transition-transform active:scale-95"
                        >
                          {copiedRecommendationShareId === item.id ? '공유됨' : '공유'}
                          {copiedRecommendationShareId === item.id ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <Share2 className="h-4 w-4" />
                          )}
                        </button>
                        <a
                          href={buildNaverMapReservationLink(getNaverMapKeyword(item))}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${item.name} 예약 검색`}
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#FFFFFF] px-4 text-sm text-[#16241D] transition-transform active:scale-95"
                        >
                          예약 검색
                          <Search className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
              {recommendationItems.length > visibleRecommendationCount ? (
                <button
                  type="button"
                  onClick={handleShowMoreRecommendations}
                  className="h-12 rounded-2xl border border-[#E4EFE9] bg-white text-sm font-semibold text-[#16241D] shadow-sm transition-transform active:scale-95"
                >
                  더보기 {Math.min(4, recommendationItems.length - visibleRecommendationCount)}개
                </button>
              ) : null}
            </div>
          )}

          {recommendationStatus === 'ready' && recommendationItems.length === 0 && !recommendationError && (
            <div className="mt-5 rounded-2xl border border-dashed border-[#E4EFE9] bg-[#FAFCFB] px-4 py-6 text-sm text-[#6E7C75]">
              아직 맞는 결과가 없어요. 세부 키워드를 바꾸거나 랜덤으로 다시 돌려보세요.
            </div>
          )}

          {recommendationStatus === 'error' && (
            <div className="mt-5 rounded-2xl border border-[#ffd9cf] bg-[#FFF0EE] px-4 py-4 text-sm text-[#c15b3d]">
              {recommendationError}
            </div>
          )}
        </section>

          <div>
            <div className="mb-3 text-lg text-[#16241D]">지도에서 보기</div>
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
          </>
        )}
      </div>
    </div>
  );
}
