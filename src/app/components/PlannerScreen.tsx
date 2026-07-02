import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BookmarkPlus,
  Car,
  CheckCircle2,
  ChevronLeft,
  Copy,
  LoaderCircle,
  LocateFixed,
  Plus,
  Route,
  Search,
  Settings2,
  Shuffle,
  Sparkles,
  TrainFront,
  Trash2,
  Users,
  UserRound,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import {
  Candidate,
  CandidateInsight,
  CandidateScopeKey,
  Coordinates,
  DrawProof,
  MeetingRoom,
  MeetCategoryKey,
  NearbyPlaceCategory,
  Participant,
  ParticipantGender,
  RuntimeAiConfig,
  SavedFriend,
  SelectionModeKey,
  ThrillLevel,
  TravelInfo,
  TravelMode,
  TravelRouteStep,
  WinnerRouteSnapshot,
} from '../types';
import { ParticipantCard } from './ParticipantCard';
import { MapView } from './MapView';
import { CandidateCard } from './CandidateCard';
import { RandomDrawer, type LadderBar } from './RandomDrawer';
import { AiConfigSheet } from './AiConfigSheet';
import { useAiGeneratedCandidates } from '../hooks/useAiGeneratedCandidates';
import { useLiveCandidateSearch } from '../hooks/useLiveCandidateSearch';
import { useCandidateTravelRoutes } from '../hooks/useCandidateTravelRoutes';
import { useFairnessVerifiedCandidateInsights } from '../hooks/useFairnessVerifiedCandidateInsights';
import { getDefaultNearbyCategory, useNearbyPlaces } from '../hooks/useNearbyPlaces';
import { useRuntimeCapabilities } from '../hooks/useRuntimeCapabilities';
import { meetCategories, mockCandidates, selectionModes, thrillStages } from '../data/mockData';
import {
  buildCandidateUniverse,
  ensureParticipantLocalCoverage,
  getCloseBalancedCandidateInsights,
  getCloseParticipantContext,
  getCandidateInsights,
  getDrawPool,
  getDynamicCandidateInsights,
  getFairnessSpreadLimit,
  getPracticalRouteGuardedInsights,
} from '../lib/meeting';
import {
  reverseGeocodeCoordinates,
  searchAddress,
  type AddressSearchResult,
} from '../lib/naver-map';
import {
  clearRuntimeAiConfig,
  getRuntimeAiConfigSignature,
  loadRuntimeAiConfig,
  persistRuntimeAiConfig,
} from '../lib/ai-config';
import {
  buildSavedFriendFromParticipant,
  createParticipantFromSavedFriend,
  DEFAULT_MAX_TRAVEL_TIME,
  loadSavedFriends,
  persistSavedFriends,
  upsertSavedFriend,
} from '../lib/friends';
import {
  addRoomParticipant,
  forgetLocalRoomParticipant,
  getCurrentRoomActorIds,
  getParticipantActorKey,
  getRoomShareUrl,
  loadMeetingRoomByCode,
  loadRoomParticipants,
  rememberLocalRoomParticipant,
  removeRoomParticipant,
  setRoomDrawReady,
  subscribeToRoomParticipants,
  subscribeToRoomState,
  updateRoomDrawController,
  updateRoomPlanningCategory,
  updateRoomSelection,
} from '../lib/rooms';
import { NearbyPlacesPanel } from './NearbyPlacesPanel';
import type { UserHomeLocation } from '../lib/auth';
import {
  buildGroupGenderContext,
  getParticipantGenderLabel,
  participantGenderOptions,
} from '../lib/gender';
import { buildWinnerRouteSnapshot } from '../lib/route-snapshot';
import {
  filterSupportedServiceAreaResults,
  getAddressResultLocationLabel,
  getSafeLocationLabel,
  isSupportedServiceAreaLocation,
  looksLikeUnsupportedServiceAreaQuery,
  SERVICE_AREA_UNSUPPORTED_MESSAGE,
} from '../lib/service-area';
import { getSupabasePublicClient } from '../lib/supabase';

interface PlannerScreenProps {
  currentUserId: string;
  currentUserName: string;
  currentUserAvatarUrl?: string | null;
  currentUserGender?: ParticipantGender;
  currentUserHomeLocation?: UserHomeLocation | null;
  onlineRoom: MeetingRoom | null;
  onOpenProfile?: () => void;
  onUpdateHomeLocation?: (homeLocation: UserHomeLocation) => Promise<{ error?: string } | void>;
  initialParticipants: Participant[];
  selectedCategory: MeetCategoryKey;
  onCategoryChange: (category: MeetCategoryKey) => void;
  selectionMode: SelectionModeKey;
  onSelectionModeChange: (mode: SelectionModeKey) => void;
  thrillLevel: ThrillLevel;
  onThrillLevelChange: (level: ThrillLevel) => void;
  onBack: () => void;
  onComplete: (
    winner: Candidate,
    participants: Participant[],
    category: MeetCategoryKey,
    proof?: DrawProof | null,
    routeSnapshot?: WinnerRouteSnapshot | null,
  ) => void;
}

type LocationMode = 'current' | 'address' | 'map';
type PlannerPageKey = 'map' | 'people' | 'candidates';

interface DrawSessionSnapshot {
  candidateInsights: CandidateInsight[];
  participants: Participant[];
  seed?: string;
  ladderBars?: LadderBar[];
}

interface SharedDrawChoice {
  roomId: string;
  seed: string;
  selectedSlotIndex: number;
  selectedAt: string;
  playAt: string;
  controllerId: string | null;
  snapshot: DrawSessionSnapshot | null;
}

interface SharedDrawLadderBars {
  roomId: string;
  seed: string;
  ladderBars: LadderBar[];
  updatedAt: string;
  controllerId: string | null;
  snapshot: DrawSessionSnapshot | null;
}

type DrawChoiceChannel = {
  send: (message: {
    type: 'broadcast';
    event: string;
    payload: unknown;
  }) => Promise<unknown>;
};

const PARTICIPANT_COLORS = ['#12B886', '#0CA178', '#38C7A6', '#7BD3B0', '#2FB48A', '#16C79A'];

const travelModeOptions: Array<{
  key: TravelMode;
  label: string;
  hint: string;
}> = [
  {
    key: 'transit',
    label: '대중교통',
    hint: '지하철·버스',
  },
  {
    key: 'car',
    label: '자차',
    hint: '자동차',
  },
];

const MIN_CANDIDATE_TARGET_COUNT = 4;
const DEFAULT_CANDIDATE_TARGET_COUNT = 10;
const DEFAULT_CANDIDATE_SCOPE: CandidateScopeKey = 'wide';

function getRouteSelectionKey(candidateId: string, participantId: string) {
  return `${candidateId}:${participantId}`;
}

function getSeededFraction(seed: string) {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967296;
}

function getDeterministicDrawControllerId(actorIds: string[], seed: string | null) {
  const candidates = [...new Set(actorIds)].filter(Boolean).sort();

  if (!candidates.length || !seed) {
    return null;
  }

  return candidates[Math.floor(getSeededFraction(`${seed}:controller`) * candidates.length)] ?? null;
}

function getParticipantNameByActorId(participants: Participant[], actorId: string | null) {
  if (!actorId) {
    return '';
  }

  return (
    participants.find((participant) => getParticipantActorKey(participant) === actorId)?.name ?? ''
  );
}

function normalizeSharedLadderBars(value: unknown): LadderBar[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .flatMap((item, index) => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const bar = item as Partial<LadderBar>;
      const leftIndex = Number(bar.leftIndex);
      const y = Number(bar.y);

      if (!Number.isInteger(leftIndex) || leftIndex < 0 || !Number.isFinite(y)) {
        return [];
      }

      return [
        {
          id:
            typeof bar.id === 'string' && bar.id
              ? bar.id
              : `shared-ladder-${index}-${leftIndex}-${Math.round(y * 100)}`,
          leftIndex,
          source: bar.source === 'user' ? 'user' : 'auto',
          y: Math.min(Math.max(y, 0), 100),
        } satisfies LadderBar,
      ];
    })
    .sort((first, second) => first.y - second.y);
}

function normalizeSharedDrawChoice(payload: unknown, roomId: string) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const value = payload as Partial<SharedDrawChoice>;
  const selectedSlotIndex = Number(value.selectedSlotIndex);
  const rawSnapshot =
    value.snapshot && typeof value.snapshot === 'object'
      ? (value.snapshot as Partial<DrawSessionSnapshot>)
      : null;
  const snapshot =
    rawSnapshot &&
    Array.isArray(rawSnapshot.candidateInsights) &&
    Array.isArray(rawSnapshot.participants)
      ? {
          candidateInsights: rawSnapshot.candidateInsights as CandidateInsight[],
          participants: rawSnapshot.participants as Participant[],
          seed: value.seed,
          ladderBars: normalizeSharedLadderBars(rawSnapshot.ladderBars),
        }
      : null;

  if (
    value.roomId !== roomId ||
    typeof value.seed !== 'string' ||
    !value.seed ||
    !Number.isInteger(selectedSlotIndex) ||
    selectedSlotIndex < 0
  ) {
    return null;
  }

  return {
    roomId,
    seed: value.seed,
    selectedSlotIndex,
    selectedAt:
      typeof value.selectedAt === 'string' && value.selectedAt
        ? value.selectedAt
        : new Date().toISOString(),
    playAt:
      typeof value.playAt === 'string' && value.playAt
        ? value.playAt
        : new Date(Date.now() + 1000).toISOString(),
    controllerId: typeof value.controllerId === 'string' ? value.controllerId : null,
    snapshot,
  } satisfies SharedDrawChoice;
}

function normalizeSharedDrawLadderBars(payload: unknown, roomId: string) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const value = payload as Partial<SharedDrawLadderBars>;
  const ladderBars = normalizeSharedLadderBars(value.ladderBars);
  const rawSnapshot =
    value.snapshot && typeof value.snapshot === 'object'
      ? (value.snapshot as Partial<DrawSessionSnapshot>)
      : null;
  const snapshot =
    rawSnapshot &&
    Array.isArray(rawSnapshot.candidateInsights) &&
    Array.isArray(rawSnapshot.participants)
      ? {
          candidateInsights: rawSnapshot.candidateInsights as CandidateInsight[],
          participants: rawSnapshot.participants as Participant[],
          seed: value.seed,
          ladderBars: ladderBars ?? normalizeSharedLadderBars(rawSnapshot.ladderBars),
        }
      : null;

  if (value.roomId !== roomId || typeof value.seed !== 'string' || !value.seed || !ladderBars) {
    return null;
  }

  return {
    roomId,
    seed: value.seed,
    ladderBars,
    updatedAt:
      typeof value.updatedAt === 'string' && value.updatedAt
        ? value.updatedAt
        : new Date().toISOString(),
    controllerId: typeof value.controllerId === 'string' ? value.controllerId : null,
    snapshot,
  } satisfies SharedDrawLadderBars;
}

function getParticipantsSignature(participants: Participant[]) {
  return JSON.stringify(
    participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      avatarUrl: participant.avatarUrl ?? null,
      location: participant.location,
      coordinates: participant.coordinates,
      maxTravelTime: participant.maxTravelTime,
      travelMode: participant.travelMode ?? 'transit',
      gender: participant.gender ?? 'unspecified',
      locationSource: participant.locationSource ?? null,
      savedFriendId: participant.savedFriendId ?? null,
      createdBy: participant.createdBy ?? null,
    })),
  );
}

function getMeetingRoomSignature(room: MeetingRoom | null) {
  if (!room) {
    return '';
  }

  return JSON.stringify({
    id: room.id,
    code: room.code,
    ownerId: room.ownerId,
    drawControllerId: room.drawControllerId,
    drawReadyIds: [...room.drawReadyIds].sort(),
    redrawVotes: [...room.redrawVotes].sort(),
    redrawRequestedAt: room.redrawRequestedAt,
    selectedCategory: room.selectedCategory,
    selectionMode: room.selectionMode,
    thrillLevel: room.thrillLevel,
    selectedCandidate: room.selectedCandidate,
    selectedRouteSnapshot: room.selectedRouteSnapshot ?? null,
    status: room.status,
    updatedAt: room.updatedAt,
    memberCount: room.memberCount ?? null,
    members: room.members ?? [],
  });
}
const thrillButtonLabels: Record<ThrillLevel, string> = {
  1: 'Lv.1',
  2: 'Lv.2',
  3: 'Lv.3',
  4: 'Lv.4',
  5: 'Lv.5',
};

function sortInsightsByCandidateIds(insights: CandidateInsight[], candidateIds: string[]) {
  const insightById = insights.reduce<Record<string, CandidateInsight>>((acc, insight) => {
    acc[insight.candidate.id] = insight;
    return acc;
  }, {});

  return candidateIds
    .map((candidateId) => insightById[candidateId])
    .filter((insight): insight is CandidateInsight => Boolean(insight));
}

function getTravelModeLabel(mode?: TravelMode) {
  return mode === 'car' ? '자차' : '대중교통';
}

function getTravelModeIcon(mode?: TravelMode) {
  return mode === 'car' ? Car : TrainFront;
}

function getRouteSourceLabel(route: TravelInfo) {
  if (route.source === 'transit') {
    return '실제';
  }

  if (route.source === 'directions') {
    return '실제';
  }

  return '예상';
}

function formatRouteFee(route: TravelInfo) {
  if (route.mode === 'car') {
    const fuel = Math.round(route.fuelPrice ?? route.cost ?? 0);
    const toll = Math.round(route.tollFare ?? 0);

    if (route.source === 'estimated') {
      return `예상 유류비 ${fuel.toLocaleString()}원`;
    }

    return toll > 0
      ? `유류비 ${fuel.toLocaleString()}원 · 통행료 ${toll.toLocaleString()}원`
      : `유류비 ${fuel.toLocaleString()}원`;
  }

  if (route.source === 'estimated') {
    return `예상 요금 ${Math.round(route.cost ?? 0).toLocaleString()}원`;
  }

  return `${Math.round(route.cost ?? 0).toLocaleString()}원 · 환승 ${route.transferCount ?? 0}회`;
}

function getRouteHeadline(route: TravelInfo) {
  if (route.routeSummary) {
    return route.routeSummary;
  }

  if (route.source === 'estimated') {
    return route.mode === 'car' ? '예상 자동차 경로' : '예상 대중교통 경로';
  }

  return route.mode === 'car' ? '자동차 경로' : '대중교통 경로';
}

function getRouteDistanceLabel(route: TravelInfo) {
  return route.source === 'estimated' ? '예상 거리' : `${route.distance}km`;
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
    return 'bg-[#E6F7F0] text-[#0CA178]';
  }

  if (type === 'bus') {
    return 'bg-[#ecfdf5] text-[#059669]';
  }

  if (type === 'car') {
    return 'bg-[#E6F7F0] text-[#ea580c]';
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

function getLocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return '위치 권한 필요';
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return '위치 찾기 실패';
  }

  return '위치 시간 초과';
}

function getBrowserCurrentCoordinates() {
  return new Promise<Coordinates>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('현재 위치를 쓸 수 없어요.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        reject(new Error(getLocationErrorMessage(error)));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  });
}

function getFriendlyRoomMessage(message: string | null) {
  if (!message) {
    return null;
  }

  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes('column ') ||
    lowerMessage.includes('schema cache') ||
    lowerMessage.includes('does not exist') ||
    lowerMessage.includes('meeting_room_participants.') ||
    lowerMessage.includes('meeting_rooms.')
  ) {
    return '방을 맞추는 중이에요.';
  }

  return message;
}

function isFriendAlreadyAdded(participants: Participant[], friend: SavedFriend) {
  return participants.some(
    (participant) =>
      participant.savedFriendId === friend.id ||
      (participant.name === friend.name && participant.location === friend.location),
  );
}

function getParticipantSyncSignature(participants: Participant[]) {
  return participants
    .map((participant) =>
      [
        participant.id,
        participant.name,
        participant.avatarUrl ?? '',
        participant.location,
        participant.coordinates.lat.toFixed(6),
        participant.coordinates.lng.toFixed(6),
        participant.maxTravelTime,
        participant.travelMode ?? 'transit',
        participant.gender ?? 'unspecified',
        participant.locationSource ?? '',
        participant.savedFriendId ?? '',
        participant.createdBy ?? '',
      ].join(':'),
    )
    .join('|');
}

function getSavedFriendSyncSignature(friends: SavedFriend[]) {
  return friends
    .map((friend) =>
      [
        friend.id,
        friend.name,
        friend.location,
        friend.coordinates.lat.toFixed(6),
        friend.coordinates.lng.toFixed(6),
        friend.maxTravelTime,
        friend.travelMode ?? 'transit',
        friend.gender ?? 'unspecified',
        friend.locationSource ?? '',
      ].join(':'),
    )
    .join('|');
}

function mergeSyncedParticipants(current: Participant[], synced: Participant[]) {
  if (getParticipantSyncSignature(current) === getParticipantSyncSignature(synced)) {
    return current;
  }

  return synced;
}

function mergeSyncedParticipantsWithPending(
  current: Participant[],
  synced: Participant[],
  pendingParticipantIds: Set<string>,
) {
  if (!pendingParticipantIds.size) {
    return mergeSyncedParticipants(current, synced);
  }

  const currentById = new Map(current.map((participant) => [participant.id, participant]));
  const syncedIds = new Set(synced.map((participant) => participant.id));

  synced.forEach((participant) => {
    const pendingParticipant = currentById.get(participant.id);

    if (
      pendingParticipant &&
      pendingParticipantIds.has(participant.id) &&
      getParticipantSyncSignature([pendingParticipant]) === getParticipantSyncSignature([participant])
    ) {
      pendingParticipantIds.delete(participant.id);
    }
  });

  const nextParticipants = synced.map((participant) =>
    pendingParticipantIds.has(participant.id) && currentById.has(participant.id)
      ? currentById.get(participant.id)!
      : participant,
  );

  current.forEach((participant) => {
    if (pendingParticipantIds.has(participant.id) && !syncedIds.has(participant.id)) {
      nextParticipants.push(participant);
    }
  });

  return mergeSyncedParticipants(current, nextParticipants);
}

export function PlannerScreen({
  currentUserId,
  currentUserName,
  currentUserAvatarUrl = null,
  currentUserGender = 'unspecified',
  currentUserHomeLocation = null,
  onlineRoom,
  onOpenProfile,
  onUpdateHomeLocation,
  initialParticipants,
  selectedCategory,
  onCategoryChange,
  selectionMode,
  onSelectionModeChange,
  thrillLevel,
  onThrillLevelChange,
  onBack,
  onComplete,
}: PlannerScreenProps) {
  const participantSectionRef = useRef<HTMLElement | null>(null);
  const routePanelRef = useRef<HTMLDivElement | null>(null);
  const participantsRef = useRef<Participant[]>(initialParticipants);
  const seenRoomWinnerRef = useRef<string | null>(null);
  const pendingRoomParticipantIdsRef = useRef<Set<string>>(new Set());
  const emptyParticipantsSyncTimerRef = useRef<number | null>(null);
  const autoAddedSelfProfileKeyRef = useRef('');
  const drawChoiceChannelRef = useRef<DrawChoiceChannel | null>(null);
  const showDrawerRef = useRef(false);
  const isCurrentDrawControllerRef = useRef(false);
  const delayedDecidedRoomTimerRef = useRef<number | null>(null);

  const [participants, setParticipants] = useState<Participant[]>(initialParticipants);
  const [savedFriends, setSavedFriends] = useState<SavedFriend[]>([]);
  const [savedFriendsLoadedUserId, setSavedFriendsLoadedUserId] = useState('');
  const [runtimeAiConfig, setRuntimeAiConfig] = useState<RuntimeAiConfig | null>(null);
  const [isAiConfigOpen, setIsAiConfigOpen] = useState(false);
  const [showOptionsPage, setShowOptionsPage] = useState(false);
  const [activePlannerPage, setActivePlannerPage] = useState<PlannerPageKey>('map');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawSessionSnapshot, setDrawSessionSnapshot] = useState<DrawSessionSnapshot | null>(null);
  const [sharedDrawChoice, setSharedDrawChoice] = useState<SharedDrawChoice | null>(null);
  const [saveNewFriend, setSaveNewFriend] = useState(true);
  const [newName, setNewName] = useState('');
  const [locationMode, setLocationMode] = useState<LocationMode>('address');
  const [addressQuery, setAddressQuery] = useState('');
  const [addressResults, setAddressResults] = useState<AddressSearchResult[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [newLocation, setNewLocation] = useState('');
  const [newCoordinates, setNewCoordinates] = useState<Coordinates | null>(null);
  const [newTravelMode, setNewTravelMode] = useState<TravelMode>('transit');
  const [newGender, setNewGender] = useState<ParticipantGender>('unspecified');
  const newTravelTime = DEFAULT_MAX_TRAVEL_TIME;
  const [editingSelfParticipantId, setEditingSelfParticipantId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [expandedRouteKey, setExpandedRouteKey] = useState<string | null>(null);
  const [excludedCandidateIds, setExcludedCandidateIds] = useState<string[]>([]);
  const [activeNearbyCategory, setActiveNearbyCategory] = useState<NearbyPlaceCategory>(
    getDefaultNearbyCategory(selectedCategory),
  );
  const [isLocating, setIsLocating] = useState(false);
  const [isUpdatingHomeLocation, setIsUpdatingHomeLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [roomSyncStatus, setRoomSyncStatus] = useState<'idle' | 'loading' | 'connected' | 'error'>(
    onlineRoom ? 'loading' : 'idle',
  );
  const [roomMessage, setRoomMessage] = useState<string | null>(null);
  const [copiedRoomLink, setCopiedRoomLink] = useState(false);
  const [isSettingReady, setIsSettingReady] = useState(false);
  const [nearbySearchCandidateId, setNearbySearchCandidateId] = useState<string | null>(null);
  const [syncedRoom, setSyncedRoom] = useState<MeetingRoom | null>(onlineRoom);
  const openedReadyDrawSessionRef = useRef<string | null>(null);
  const isOpeningDrawSessionRef = useRef(false);
  const syncedRoomSignatureRef = useRef(getMeetingRoomSignature(onlineRoom));
  const participantsSignatureRef = useRef(getParticipantsSignature(participants));
  const onCategoryChangeRef = useRef(onCategoryChange);
  const onSelectionModeChangeRef = useRef(onSelectionModeChange);
  const onThrillLevelChangeRef = useRef(onThrillLevelChange);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCategoryChangeRef.current = onCategoryChange;
  }, [onCategoryChange]);

  useEffect(() => {
    onSelectionModeChangeRef.current = onSelectionModeChange;
  }, [onSelectionModeChange]);

  useEffect(() => {
    onThrillLevelChangeRef.current = onThrillLevelChange;
  }, [onThrillLevelChange]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    showDrawerRef.current = showDrawer;
  }, [showDrawer]);

  useEffect(() => {
    if (!onlineRoom) {
      drawChoiceChannelRef.current = null;
      setSharedDrawChoice(null);
      return;
    }

    const supabase = getSupabasePublicClient();

    if (!supabase) {
      drawChoiceChannelRef.current = null;
      return;
    }

    const roomId = onlineRoom.id;
    const channel = supabase
      .channel(`room-draw-choice-${roomId}`)
      .on('broadcast', { event: 'draw-choice' }, (message) => {
        const nextChoice = normalizeSharedDrawChoice(message.payload, roomId);

        if (!nextChoice) {
          return;
        }

        setSharedDrawChoice((current) =>
          current?.seed === nextChoice.seed &&
          current.selectedSlotIndex === nextChoice.selectedSlotIndex
            ? current
            : nextChoice,
        );

        if (nextChoice.snapshot) {
          setDrawSessionSnapshot(nextChoice.snapshot);
          openedReadyDrawSessionRef.current = nextChoice.seed;
          setShowDrawer(true);
        }
      })
      .on('broadcast', { event: 'draw-ladder-bars' }, (message) => {
        const nextBars = normalizeSharedDrawLadderBars(message.payload, roomId);

        if (!nextBars) {
          return;
        }

        setDrawSessionSnapshot((current) => {
          if (current?.seed === nextBars.seed) {
            return {
              ...current,
              ladderBars: nextBars.ladderBars,
            };
          }

          return nextBars.snapshot ?? current;
        });

        if (nextBars.snapshot) {
          openedReadyDrawSessionRef.current = nextBars.seed;
          setShowDrawer(true);
        }
      })
      .subscribe();

    drawChoiceChannelRef.current = channel;

    return () => {
      if (drawChoiceChannelRef.current === channel) {
        drawChoiceChannelRef.current = null;
      }

      void supabase.removeChannel(channel);
    };
  }, [onlineRoom?.id]);

  useEffect(() => {
    participantsRef.current = participants;
    participantsSignatureRef.current = getParticipantsSignature(participants);
  }, [participants]);

  useEffect(() => {
    const nextSignature = getMeetingRoomSignature(onlineRoom);

    if (syncedRoomSignatureRef.current !== nextSignature) {
      syncedRoomSignatureRef.current = nextSignature;
      setSyncedRoom(onlineRoom);
    }

    pendingRoomParticipantIdsRef.current.clear();
  }, [onlineRoom?.id]);

  useEffect(() => {
    if (onlineRoom) {
      return;
    }

    setParticipants(initialParticipants);
    setRoomSyncStatus('idle');
    setRoomMessage(null);
  }, [initialParticipants, onlineRoom]);

  useEffect(() => {
    if (!onlineRoom) {
      return;
    }

    let active = true;
    let isSyncingParticipants = false;
    let isSyncingRoom = false;
    let latestParticipants = participantsRef.current;
    let pendingDecidedRoom: MeetingRoom | null = null;
    setRoomSyncStatus('loading');
    setRoomMessage(null);

    const handleSyncError = (message: string) => {
      if (!active) {
        return;
      }

      setRoomSyncStatus('error');
      setRoomMessage(message);
    };

    const completeDecidedRoom = (room: MeetingRoom, roomParticipants: Participant[]) => {
      if (room.status !== 'decided' || !room.selectedCandidate) {
        pendingDecidedRoom = null;
        return;
      }

      if (!roomParticipants.length) {
        pendingDecidedRoom = room;
        return;
      }

      const winnerKey = `${room.selectedCandidate.id}-${room.updatedAt}`;

      if (seenRoomWinnerRef.current === winnerKey) {
        pendingDecidedRoom = null;
        return;
      }

      const finishDecidedRoom = () => {
        if (!active || seenRoomWinnerRef.current === winnerKey) {
          return;
        }

        seenRoomWinnerRef.current = winnerKey;
        pendingDecidedRoom = null;
        onCategoryChangeRef.current(room.selectedCategory);
        onSelectionModeChangeRef.current(room.selectionMode);
        onThrillLevelChangeRef.current(room.thrillLevel);
        onCompleteRef.current(
          room.selectedCandidate,
          roomParticipants,
          room.selectedCategory,
          null,
          room.selectedRouteSnapshot ?? null,
        );
      };

      if (showDrawerRef.current && !isCurrentDrawControllerRef.current) {
        if (delayedDecidedRoomTimerRef.current !== null) {
          window.clearTimeout(delayedDecidedRoomTimerRef.current);
        }

        delayedDecidedRoomTimerRef.current = window.setTimeout(() => {
          delayedDecidedRoomTimerRef.current = null;
          finishDecidedRoom();
        }, 5200);
        return;
      }

      finishDecidedRoom();
    };

    const applyParticipants = (nextParticipants: Participant[]) => {
      if (!active) {
        return;
      }

      if (!nextParticipants.length && latestParticipants.length) {
        if (emptyParticipantsSyncTimerRef.current === null) {
          emptyParticipantsSyncTimerRef.current = window.setTimeout(() => {
            emptyParticipantsSyncTimerRef.current = null;
            applyParticipants([]);
          }, 650);
        }
        return;
      }

      if (emptyParticipantsSyncTimerRef.current !== null) {
        window.clearTimeout(emptyParticipantsSyncTimerRef.current);
        emptyParticipantsSyncTimerRef.current = null;
      }

      latestParticipants = mergeSyncedParticipantsWithPending(
        latestParticipants,
        nextParticipants,
        pendingRoomParticipantIdsRef.current,
      );
      participantsRef.current = latestParticipants;
      const nextSignature = getParticipantsSignature(latestParticipants);

      if (participantsSignatureRef.current !== nextSignature) {
        participantsSignatureRef.current = nextSignature;
        setParticipants(latestParticipants);
      }

      setRoomSyncStatus('connected');

      if (pendingDecidedRoom) {
        completeDecidedRoom(pendingDecidedRoom, latestParticipants);
      }
    };

    const applyRoomState = (room: MeetingRoom) => {
      if (!active) {
        return;
      }

      const nextSignature = getMeetingRoomSignature(room);

      if (syncedRoomSignatureRef.current !== nextSignature) {
        syncedRoomSignatureRef.current = nextSignature;
        setSyncedRoom(room);
      }

      completeDecidedRoom(room, latestParticipants);
    };

    const syncParticipants = () => {
      if (isSyncingParticipants) {
        return;
      }

      isSyncingParticipants = true;

      void loadRoomParticipants(onlineRoom.id)
        .then((nextParticipants) => {
          applyParticipants(nextParticipants);
        })
        .catch((error: Error) => {
          handleSyncError(error.message);
        })
        .finally(() => {
          isSyncingParticipants = false;
        });
    };

    const syncRoomState = () => {
      if (isSyncingRoom) {
        return;
      }

      isSyncingRoom = true;

      void loadMeetingRoomByCode(onlineRoom.code)
        .then((room) => {
          if (!room) {
            return;
          }

          applyRoomState(room);
        })
        .catch((error: Error) => {
          handleSyncError(error.message);
        })
        .finally(() => {
          isSyncingRoom = false;
        });
    };

    syncParticipants();
    syncRoomState();

    const participantsIntervalId = window.setInterval(syncParticipants, 2500);
    const roomIntervalId = window.setInterval(syncRoomState, 3500);
    const unsubscribeParticipants = subscribeToRoomParticipants(
      onlineRoom.id,
      applyParticipants,
      handleSyncError,
    );
    const unsubscribeRoom = subscribeToRoomState(onlineRoom.id, applyRoomState, handleSyncError);

    return () => {
      active = false;
      if (emptyParticipantsSyncTimerRef.current !== null) {
        window.clearTimeout(emptyParticipantsSyncTimerRef.current);
        emptyParticipantsSyncTimerRef.current = null;
      }
      if (delayedDecidedRoomTimerRef.current !== null) {
        window.clearTimeout(delayedDecidedRoomTimerRef.current);
        delayedDecidedRoomTimerRef.current = null;
      }
      unsubscribeParticipants();
      unsubscribeRoom();
      window.clearInterval(participantsIntervalId);
      window.clearInterval(roomIntervalId);
    };
  }, [onlineRoom?.code, onlineRoom?.id]);

  useEffect(() => {
    let active = true;
    setSavedFriendsLoadedUserId('');

    void loadSavedFriends(currentUserId).then((friends) => {
      if (!active) {
        return;
      }

      setSavedFriends(friends);
      setSavedFriendsLoadedUserId(currentUserId);
    });

    return () => {
      active = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    setRuntimeAiConfig(loadRuntimeAiConfig());
  }, []);

  const isGuestMode = !currentUserId;
  const roomState = syncedRoom ?? onlineRoom;
  const runtimeCapabilities = useRuntimeCapabilities();
  const effectiveRuntimeAiConfig = runtimeCapabilities.ai.connected ? null : runtimeAiConfig;
  const aiConfigSignature = getRuntimeAiConfigSignature(effectiveRuntimeAiConfig);

  useEffect(() => {
    if (!onlineRoom || !roomState) {
      return;
    }

    if (roomState.selectedCategory !== selectedCategory) {
      onCategoryChangeRef.current(roomState.selectedCategory);
    }

    if (roomState.selectionMode !== selectionMode) {
      onSelectionModeChangeRef.current(roomState.selectionMode);
    }

    if (roomState.thrillLevel !== thrillLevel) {
      onThrillLevelChangeRef.current(roomState.thrillLevel);
    }
  }, [
    onlineRoom,
    roomState?.selectedCategory,
    roomState?.selectionMode,
    roomState?.thrillLevel,
    selectedCategory,
    selectionMode,
    thrillLevel,
  ]);

  useEffect(() => {
    setSaveNewFriend(!isGuestMode);
  }, [isGuestMode]);

  const activeCategory =
    meetCategories.find((category) => category.key === selectedCategory) ?? meetCategories[0];
  const activeMode =
    selectionModes.find((mode) => mode.key === selectionMode) ?? selectionModes[0];
  const isFairnessMode = selectionMode === 'balance';
  const effectiveThrillLevel: ThrillLevel = isFairnessMode
    ? thrillLevel
    : selectionMode === 'neighborhood'
      ? 5
      : 1;
  const candidateUniverseThrillLevel: ThrillLevel =
    selectionMode === 'neighborhood' ? 5 : 1;
  const activeThrill =
    thrillStages.find((stage) => stage.level === effectiveThrillLevel) ?? thrillStages[0];
  const visibleThrillStages = thrillStages;
  const activeSpreadLimit = getFairnessSpreadLimit(effectiveThrillLevel, participants);
  const activeModeDetailLabel = isFairnessMode
    ? `${activeThrill.shortLabel} · ${activeSpreadLimit}분 이하`
    : selectionMode === 'hotplace'
      ? '핫플 후보 넓게'
      : '집앞 후보 넓게';
  const candidateScope = DEFAULT_CANDIDATE_SCOPE;
  const activeCandidateTargetCount = DEFAULT_CANDIDATE_TARGET_COUNT;
  const roomActorIds = useMemo(
    () =>
      getCurrentRoomActorIds({
        roomId: roomState?.id ?? null,
        currentUserId,
        participants,
      }),
    [currentUserId, participants, roomState?.id],
  );
  const roomParticipantActorIds = useMemo(
    () => [...new Set(participants.map((participant) => getParticipantActorKey(participant)))],
    [participants],
  );
  const currentReadyActorId = useMemo(
    () => roomActorIds.find((actorId) => roomParticipantActorIds.includes(actorId)) ?? null,
    [roomActorIds, roomParticipantActorIds],
  );
  const roomReadyIds = roomState?.drawReadyIds ?? [];
  const readyParticipantIds = useMemo(
    () => roomParticipantActorIds.filter((actorId) => roomReadyIds.includes(actorId)),
    [roomParticipantActorIds, roomReadyIds],
  );
  const readyCount = readyParticipantIds.length;
  const readyRequiredCount = roomParticipantActorIds.length;
  const isCurrentActorReady = Boolean(
    currentReadyActorId && roomReadyIds.includes(currentReadyActorId),
  );
  const isOnlineReadyComplete = Boolean(
    onlineRoom && readyRequiredCount > 0 && readyCount >= readyRequiredCount,
  );
  const useSharedOnlineCandidatePool = Boolean(onlineRoom);
  const { candidates: aiGeneratedCandidates } = useAiGeneratedCandidates(
    participants,
    selectedCategory,
    selectionMode,
    effectiveThrillLevel,
    useSharedOnlineCandidatePool ? 0 : activeCandidateTargetCount,
    effectiveRuntimeAiConfig,
    aiConfigSignature,
  );
  const candidateSeeds = useMemo(
    () => (useSharedOnlineCandidatePool ? mockCandidates : [...mockCandidates, ...aiGeneratedCandidates]),
    [aiGeneratedCandidates, useSharedOnlineCandidatePool],
  );

  const candidateUniverse = useMemo(
    () =>
      buildCandidateUniverse(
        participants,
        candidateSeeds,
        selectedCategory,
        candidateUniverseThrillLevel,
      ),
    [candidateSeeds, candidateUniverseThrillLevel, participants, selectedCategory],
  );
  const allCandidateInsights = useMemo(
    () => getCandidateInsights(participants, candidateUniverse, selectedCategory, selectionMode),
    [candidateUniverse, participants, selectedCategory, selectionMode],
  );
  const closeParticipantContext = useMemo(
    () => getCloseParticipantContext(participants),
    [participants],
  );
  const scopedCandidateInsights = useMemo(
    () =>
      selectionMode === 'balance' && closeParticipantContext.isCloseGroup
        ? getCloseBalancedCandidateInsights(allCandidateInsights, participants)
        : allCandidateInsights,
    [allCandidateInsights, closeParticipantContext.isCloseGroup, participants, selectionMode],
  );
  const effectiveCandidateTargetCount = scopedCandidateInsights.length
    ? Math.min(
        Math.max(
          activeCandidateTargetCount,
          selectionMode === 'neighborhood' && effectiveThrillLevel >= 5
            ? participants.length
            : MIN_CANDIDATE_TARGET_COUNT,
        ),
        scopedCandidateInsights.length,
      )
    : participants.length >= 2
      ? 0
      : activeCandidateTargetCount;
  const seedCandidateInsights = useMemo(
    () =>
      getDynamicCandidateInsights(
        participants,
        candidateUniverse,
        selectedCategory,
        selectionMode,
        effectiveThrillLevel,
        candidateScope,
        effectiveCandidateTargetCount,
        participants,
      ),
    [
      candidateScope,
      candidateUniverse,
      effectiveCandidateTargetCount,
      effectiveThrillLevel,
      participants,
      selectedCategory,
      selectionMode,
    ],
  );
  const fallbackCandidateIds = useMemo(
    () => seedCandidateInsights.map((insight) => insight.candidate.id),
    [seedCandidateInsights],
  );

  const {
    candidateIds: aiCandidateIds,
    status: aiCandidateStatus,
    message: aiCandidateMessage,
    error: aiCandidateError,
  } = useLiveCandidateSearch(
    participants,
    useSharedOnlineCandidatePool ? [] : scopedCandidateInsights,
    useSharedOnlineCandidatePool ? [] : fallbackCandidateIds,
    selectedCategory,
    selectionMode,
    effectiveThrillLevel,
    candidateScope,
    useSharedOnlineCandidatePool ? null : effectiveRuntimeAiConfig,
    aiConfigSignature,
    effectiveCandidateTargetCount,
  );
  const sharedCandidateIds = useSharedOnlineCandidatePool ? fallbackCandidateIds : aiCandidateIds;
  const sharedCandidateStatus = useSharedOnlineCandidatePool ? 'ready' : aiCandidateStatus;
  const sharedCandidateMessage = useSharedOnlineCandidatePool
    ? '후보를 맞췄어요.'
    : aiCandidateMessage;
  const sharedCandidateError = useSharedOnlineCandidatePool ? null : aiCandidateError;

  const aiCandidateInsights = useMemo(
    () => sortInsightsByCandidateIds(scopedCandidateInsights, sharedCandidateIds),
    [scopedCandidateInsights, sharedCandidateIds],
  );
  const guardedAiCandidateInsights = useMemo(
    () =>
      selectionMode === 'balance' && closeParticipantContext.isCloseGroup
        ? getCloseBalancedCandidateInsights(aiCandidateInsights, participants)
        : aiCandidateInsights,
    [aiCandidateInsights, closeParticipantContext.isCloseGroup, participants, selectionMode],
  );
  const rawCandidateInsights = useMemo(
    () => {
      const scopedCandidateIdSet = new Set(
        scopedCandidateInsights.map((insight) => insight.candidate.id),
      );
      const sourceInsights = guardedAiCandidateInsights.length
        ? guardedAiCandidateInsights
        : seedCandidateInsights;
      const scopedSourceInsights = sourceInsights.filter((insight) =>
        scopedCandidateIdSet.has(insight.candidate.id),
      );
      const fallbackScopedInsights = scopedCandidateInsights.slice(
        0,
        Math.min(
          effectiveCandidateTargetCount || scopedCandidateInsights.length,
          scopedCandidateInsights.length,
        ),
      );

      return ensureParticipantLocalCoverage(
        scopedCandidateInsights,
        scopedSourceInsights.length ? scopedSourceInsights : fallbackScopedInsights,
        participants,
        Math.min(
          effectiveCandidateTargetCount || scopedSourceInsights.length || fallbackScopedInsights.length,
          scopedCandidateInsights.length ||
            scopedSourceInsights.length ||
            fallbackScopedInsights.length,
        ),
        {
          selectionMode,
          thrillLevel: effectiveThrillLevel,
        },
      );
    },
    [
      effectiveCandidateTargetCount,
      effectiveThrillLevel,
      guardedAiCandidateInsights,
      participants,
      scopedCandidateInsights,
      seedCandidateInsights,
      selectionMode,
    ],
  );
  const fairnessVerificationInputInsights =
    isFairnessMode && !useSharedOnlineCandidatePool && sharedCandidateStatus !== 'loading'
      ? rawCandidateInsights
      : [];
  const {
    insights: fairnessVerifiedRawCandidateInsights,
    status: fairnessVerificationStatus,
    message: fairnessVerificationMessage,
  } = useFairnessVerifiedCandidateInsights(participants, fairnessVerificationInputInsights);
  const fairnessVerifiedSourceInsights = fairnessVerificationInputInsights.length
    ? fairnessVerifiedRawCandidateInsights
    : rawCandidateInsights;
  const routeGuardedCandidateSourceInsights = useMemo(
    () =>
      !isFairnessMode
        ? fairnessVerifiedSourceInsights
        : getPracticalRouteGuardedInsights(
            fairnessVerifiedSourceInsights,
            Math.min(
              4,
              effectiveCandidateTargetCount || fairnessVerifiedSourceInsights.length,
            ),
          ),
    [effectiveCandidateTargetCount, fairnessVerifiedSourceInsights, isFairnessMode],
  );
  const candidateInsights = useMemo(
    () =>
      routeGuardedCandidateSourceInsights.filter(
        (insight) => !excludedCandidateIds.includes(insight.candidate.id),
      ),
    [excludedCandidateIds, routeGuardedCandidateSourceInsights],
  );
  const { pool: drawPool, fallbackNotice } = useMemo(
    () =>
      getDrawPool(
        candidateInsights,
        selectionMode,
        effectiveThrillLevel,
        candidateScope,
        effectiveCandidateTargetCount,
        participants,
      ),
    [
      candidateInsights,
      candidateScope,
      effectiveCandidateTargetCount,
      effectiveThrillLevel,
      participants,
      selectionMode,
    ],
  );
  const visibleCandidateInsights = useMemo(
    () => (selectionMode === 'balance' ? drawPool : candidateInsights),
    [candidateInsights, drawPool, selectionMode],
  );
  const fairnessVerificationPending = Boolean(
    participants.length >= 2 &&
      fairnessVerificationInputInsights.length &&
      fairnessVerificationStatus === 'loading',
  );
  const drawBlockedReason = participants.length < 2
    ? '참여자가 필요해요'
    : sharedCandidateStatus === 'loading'
      ? '후보 찾는 중이에요'
      : fairnessVerificationPending
        ? '시간 확인 중이에요'
        : !drawPool.length
          ? fallbackNotice ?? '후보가 없어요'
          : null;
  const onlineReadyBlockedReason =
    onlineRoom && !currentReadyActorId
      ? '위치가 필요해요'
      : drawBlockedReason;
  const drawDisabledReason = onlineRoom ? onlineReadyBlockedReason : drawBlockedReason;
  const readyButtonDisabled = Boolean(
    isSettingReady || (onlineReadyBlockedReason && !isCurrentActorReady),
  );
  const onlineReadyButtonLabel = onlineRoom
    ? isSettingReady
      ? '저장 중이에요'
      : !currentReadyActorId
        ? '위치가 필요해요'
        : participants.length < 2
          ? '참여자가 필요해요'
        : sharedCandidateStatus === 'loading'
            ? '후보 찾는 중이에요'
            : fairnessVerificationPending
              ? '시간 확인 중이에요'
              : !drawPool.length
                ? '후보가 없어요'
                : isOnlineReadyComplete
                  ? `모두 레디 ${readyCount}/${readyRequiredCount}`
                  : isCurrentActorReady
                    ? `레디 완료 ${readyCount}/${readyRequiredCount}`
                      : `레디 ${readyCount}/${readyRequiredCount}`
    : null;
  const plannerStageTitle = onlineRoom
    ? onlineReadyBlockedReason
      ? onlineReadyBlockedReason
      : isOnlineReadyComplete
        ? '준비됐어요'
        : isCurrentActorReady
          ? '레디했어요'
          : '레디해 주세요'
    : drawBlockedReason
      ? '준비가 필요해요'
      : '추첨할 수 있어요';
  const plannerPages: Array<{
    key: PlannerPageKey;
    label: string;
    value: string;
    icon: LucideIcon;
    ariaLabel: string;
  }> = [
    {
      key: 'map',
      label: '후보',
      value: `${visibleCandidateInsights.length}곳`,
      icon: Sparkles,
      ariaLabel: '후보 보기',
    },
    {
      key: 'people',
      label: '참여자',
      value: `${participants.length}명`,
      icon: Users,
      ariaLabel: '참여자 보기',
    },
    {
      key: 'candidates',
      label: '후보 상세',
      value: `${drawPool.length}곳`,
      icon: Search,
      ariaLabel: '후보 상세보기',
    },
  ];
  const readyDrawSessionSeed = useMemo(
    () =>
      onlineRoom && !isSettingReady && isOnlineReadyComplete && drawPool.length
        ? [
            onlineRoom.id,
            roomState?.redrawRequestedAt ?? 'initial',
            selectedCategory,
            selectionMode,
            effectiveThrillLevel,
            roomParticipantActorIds.join('|'),
            readyParticipantIds.join('|'),
            drawPool.map((insight) => insight.candidate.id).join('|'),
          ].join(':')
        : null,
    [
      drawPool,
      effectiveThrillLevel,
      isOnlineReadyComplete,
      isSettingReady,
      onlineRoom,
      readyParticipantIds,
      roomState?.redrawRequestedAt,
      roomParticipantActorIds,
      selectedCategory,
      selectionMode,
    ],
  );
  const plannedDrawControllerId = useMemo(
    () => getDeterministicDrawControllerId(readyParticipantIds, readyDrawSessionSeed),
    [readyDrawSessionSeed, readyParticipantIds],
  );
  const activeDrawControllerId =
    roomState?.drawControllerId && readyParticipantIds.includes(roomState.drawControllerId)
      ? roomState.drawControllerId
      : plannedDrawControllerId;
  const activeDrawControllerName =
    getParticipantNameByActorId(participants, activeDrawControllerId) || '진행자';
  const isCurrentDrawController = Boolean(
    !onlineRoom || (currentReadyActorId && currentReadyActorId === activeDrawControllerId),
  );
  useEffect(() => {
    isCurrentDrawControllerRef.current = isCurrentDrawController;
  }, [isCurrentDrawController]);
  const openDrawDrawer = async () => {
    if (isOpeningDrawSessionRef.current) {
      return;
    }

    const sessionSeed = readyDrawSessionSeed ?? undefined;

    if (sessionSeed && openedReadyDrawSessionRef.current === sessionSeed) {
      return;
    }

    isOpeningDrawSessionRef.current = true;

    try {
      let snapshotParticipants = participants;

      if (onlineRoom) {
        const syncedParticipants = await loadRoomParticipants(onlineRoom.id);

        if (getParticipantsSignature(syncedParticipants) !== getParticipantsSignature(participants)) {
          participantsRef.current = syncedParticipants;
          participantsSignatureRef.current = getParticipantsSignature(syncedParticipants);
          setParticipants(syncedParticipants);
          openedReadyDrawSessionRef.current = null;
          return;
        }

        snapshotParticipants = syncedParticipants;
      }

      if (sessionSeed) {
        openedReadyDrawSessionRef.current = sessionSeed;
      }

      setDrawSessionSnapshot({
        candidateInsights: drawPool,
        participants: snapshotParticipants,
        seed: sessionSeed,
      });
      setShowDrawer(true);
    } catch (error) {
      setRoomMessage(error instanceof Error ? error.message : '방 상태를 못 봤어요.');
      openedReadyDrawSessionRef.current = null;
    } finally {
      isOpeningDrawSessionRef.current = false;
    }
  };
  const closeDrawDrawer = () => {
    setShowDrawer(false);
    setDrawSessionSnapshot(null);
  };
  useEffect(() => {
    if (
      !sharedDrawChoice ||
      sharedDrawChoice.snapshot ||
      !readyDrawSessionSeed ||
      sharedDrawChoice.seed === readyDrawSessionSeed
    ) {
      return;
    }

    setSharedDrawChoice(null);
  }, [readyDrawSessionSeed, sharedDrawChoice]);
  useEffect(() => {
    if (
      !onlineRoom ||
      !sharedDrawChoice ||
      showDrawer ||
      roomState?.status === 'decided'
    ) {
      return;
    }

    if (sharedDrawChoice.snapshot) {
      setDrawSessionSnapshot(sharedDrawChoice.snapshot);
      setShowDrawer(true);
      return;
    }

    if (!readyDrawSessionSeed || sharedDrawChoice.seed !== readyDrawSessionSeed) {
      return;
    }

    void openDrawDrawer();
  }, [
    onlineRoom,
    readyDrawSessionSeed,
    roomState?.status,
    sharedDrawChoice,
    showDrawer,
  ]);
  useEffect(() => {
    if (
      !onlineRoom ||
      !roomState ||
      !isOnlineReadyComplete ||
      !plannedDrawControllerId ||
      roomState.status === 'decided' ||
      roomState.drawControllerId === plannedDrawControllerId
    ) {
      return;
    }

    void updateRoomDrawController({
      roomId: onlineRoom.id,
      drawControllerId: plannedDrawControllerId,
    })
      .then((room) => {
        if (room) {
          setSyncedRoom(room);
        }
      })
      .catch((error: Error) => {
        setRoomMessage(error.message);
      });
  }, [
    isOnlineReadyComplete,
    onlineRoom,
    plannedDrawControllerId,
    roomState,
  ]);
  useEffect(() => {
    if (!isOnlineReadyComplete) {
      openedReadyDrawSessionRef.current = null;
      return;
    }

    if (
      !readyDrawSessionSeed ||
      drawBlockedReason ||
      showDrawer ||
      openedReadyDrawSessionRef.current === readyDrawSessionSeed
    ) {
      return;
    }

    void openDrawDrawer();
  }, [drawBlockedReason, isOnlineReadyComplete, readyDrawSessionSeed, showDrawer]);

  const selectedInsight = useMemo(
    () =>
      visibleCandidateInsights.find((insight) => insight.candidate.id === selectedCandidateId) ??
      visibleCandidateInsights[0] ??
      null,
    [selectedCandidateId, visibleCandidateInsights],
  );
  const {
    routes: selectedCandidateRoutes,
    status: selectedRouteStatus,
    error: selectedRouteError,
    hasLiveData: selectedRouteHasLiveData,
  } = useCandidateTravelRoutes(participants, selectedInsight?.candidate ?? null);
  const selectedMapRoutes = useMemo(
    () =>
      selectedCandidateRoutes.filter(
        (route) =>
          route.source !== 'estimated' &&
          route.routePath &&
          route.routePath.length >= 3,
      ),
    [selectedCandidateRoutes],
  );
  const selectedRouteParticipantId = useMemo(() => {
    if (!selectedInsight) {
      return null;
    }

    const routeKeyPrefix = `${selectedInsight.candidate.id}:`;

    if (expandedRouteKey?.startsWith(routeKeyPrefix)) {
      const routeParticipantId = expandedRouteKey.slice(routeKeyPrefix.length);

      if (participants.some((participant) => participant.id === routeParticipantId)) {
        return routeParticipantId;
      }
    }

    const currentParticipant = currentReadyActorId
      ? participants.find(
          (participant) =>
            participant.id === currentReadyActorId ||
            getParticipantActorKey(participant) === currentReadyActorId,
        )
      : null;

    return currentParticipant?.id ?? participants[0]?.id ?? null;
  }, [currentReadyActorId, expandedRouteKey, participants, selectedInsight]);
  const selectedRouteParticipantIndex = selectedRouteParticipantId
    ? participants.findIndex((participant) => participant.id === selectedRouteParticipantId)
    : -1;
  const selectedRouteParticipant =
    selectedRouteParticipantIndex >= 0 ? participants[selectedRouteParticipantIndex] : null;
  const rawSelectedRouteDetail = selectedRouteParticipant
    ? selectedCandidateRoutes.find((route) => route.participantId === selectedRouteParticipant.id) ??
      null
    : null;
  const selectedRouteDetail = rawSelectedRouteDetail;
	  const selectedRouteDetailKey =
	    selectedInsight && selectedRouteParticipant
	      ? getRouteSelectionKey(selectedInsight.candidate.id, selectedRouteParticipant.id)
	      : null;
	  const showSelectedRouteSteps = selectedRouteDetail?.mode !== 'car';
	  const selectedRouteSteps = showSelectedRouteSteps ? selectedRouteDetail?.routeSteps ?? [] : [];
  const selectedRouteMeta = selectedRouteDetail ? getRouteDetailMeta(selectedRouteDetail) : '';
  const SelectedRouteTravelIcon = selectedRouteParticipant
    ? getTravelModeIcon(selectedRouteParticipant.travelMode)
    : TrainFront;
  const selectedRouteColor =
    PARTICIPANT_COLORS[
      (selectedRouteParticipantIndex >= 0 ? selectedRouteParticipantIndex : 0) %
        PARTICIPANT_COLORS.length
    ];

  const handleMapRouteSelect = (participantId: string) => {
    if (!selectedInsight) {
      return;
    }

    setActivePlannerPage('people');
    setExpandedRouteKey(getRouteSelectionKey(selectedInsight.candidate.id, participantId));
    window.setTimeout(() => {
      routePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  };

  useEffect(() => {
    setExpandedRouteKey(null);
  }, [selectedInsight?.candidate.id]);

  const nearbySearchEnabled =
    Boolean(selectedInsight) && nearbySearchCandidateId === selectedInsight?.candidate.id;
  const groupGenderContext = useMemo(
    () => buildGroupGenderContext(participants),
    [participants],
  );
  const {
    sections: nearbySections,
    status: nearbyPlacesStatus,
    error: nearbyPlacesError,
    message: nearbyPlacesMessage,
  } = useNearbyPlaces(
    selectedInsight?.candidate ?? null,
    selectedCategory,
    nearbySearchEnabled,
    groupGenderContext,
  );
  const nearbyMapPlaces = useMemo(
    () => nearbySections.find((section) => section.key === activeNearbyCategory)?.items ?? [],
    [activeNearbyCategory, nearbySections],
  );

  useEffect(() => {
    const availableCandidateIds = new Set(rawCandidateInsights.map((insight) => insight.candidate.id));

    setExcludedCandidateIds((current) => {
      const next = current.filter((candidateId) => availableCandidateIds.has(candidateId));
      return next.length === current.length ? current : next;
    });
  }, [rawCandidateInsights]);

  useEffect(() => {
    if (!visibleCandidateInsights.length) {
      setSelectedCandidateId(null);
      setExpandedCandidateId(null);
      return;
    }

    if (
      !selectedCandidateId ||
      !visibleCandidateInsights.some((insight) => insight.candidate.id === selectedCandidateId)
    ) {
      setSelectedCandidateId(visibleCandidateInsights[0].candidate.id);
    }
  }, [selectedCandidateId, visibleCandidateInsights]);

  useEffect(() => {
    if (
      expandedCandidateId &&
      !visibleCandidateInsights.some((insight) => insight.candidate.id === expandedCandidateId)
    ) {
      setExpandedCandidateId(null);
    }
  }, [expandedCandidateId, visibleCandidateInsights]);

  useEffect(() => {
    setActiveNearbyCategory(getDefaultNearbyCategory(selectedCategory));
  }, [selectedCategory, selectedCandidateId]);

  useEffect(() => {
    setExpandedCandidateId(null);
  }, [selectedCategory]);

  useEffect(() => {
    if (!nearbySections.length) {
      return;
    }

    if (!nearbySections.some((section) => section.key === activeNearbyCategory)) {
      setActiveNearbyCategory(nearbySections[0].key);
    }
  }, [activeNearbyCategory, nearbySections]);

  const savedFriendIds = useMemo(
    () => new Set(savedFriends.map((friend) => friend.id)),
    [savedFriends],
  );
  const selfProfileParticipantKey = currentUserId ? `self-profile-${currentUserId}` : '';
  const selfProfileParticipant = useMemo(
    () =>
      selfProfileParticipantKey
        ? participants.find((participant) => participant.savedFriendId === selfProfileParticipantKey) ?? null
        : null,
    [participants, selfProfileParticipantKey],
  );
  const isSelfProfileAdded = Boolean(selfProfileParticipant);
  const selfProfileMatchesHomeLocation = Boolean(
    currentUserHomeLocation &&
      selfProfileParticipant &&
      selfProfileParticipant.location === currentUserHomeLocation.location &&
      Math.abs(selfProfileParticipant.coordinates.lat - currentUserHomeLocation.coordinates.lat) < 0.000001 &&
      Math.abs(selfProfileParticipant.coordinates.lng - currentUserHomeLocation.coordinates.lng) < 0.000001,
  );
  const isEditingSelfLocation = Boolean(editingSelfParticipantId);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const targetParticipant = participants.find(
      (participant) =>
        participant.savedFriendId === selfProfileParticipantKey ||
        (Boolean(currentUserHomeLocation) &&
          participant.createdBy === currentUserId &&
          participant.location === currentUserHomeLocation?.location),
    );

    if (!targetParticipant) {
      return;
    }

    const nextParticipant = {
      ...targetParticipant,
      name: currentUserName,
      avatarUrl: currentUserAvatarUrl,
      gender: currentUserGender,
    };

    if (getParticipantSyncSignature([targetParticipant]) === getParticipantSyncSignature([nextParticipant])) {
      return;
    }

    setParticipants((current) =>
      current.map((participant) =>
        participant.id === targetParticipant.id ? nextParticipant : participant,
      ),
    );

    if (onlineRoom) {
      pendingRoomParticipantIdsRef.current.add(nextParticipant.id);
      void addRoomParticipant({
        roomId: onlineRoom.id,
        participant: nextParticipant,
        userId: currentUserId,
      }).catch((error: Error) => {
        pendingRoomParticipantIdsRef.current.delete(nextParticipant.id);
        setRoomMessage(error.message);
      });
    }
  }, [
    currentUserAvatarUrl,
    currentUserGender,
    currentUserId,
    currentUserName,
    currentUserHomeLocation,
    onlineRoom,
    participants,
    selfProfileParticipantKey,
  ]);

  const persistFriends = (nextFriends: SavedFriend[]) => {
    setSavedFriends(nextFriends);
    void persistSavedFriends(currentUserId, nextFriends);
  };

  useEffect(() => {
    if (
      !onlineRoom ||
      !currentUserId ||
      savedFriendsLoadedUserId !== currentUserId ||
      !participants.length
    ) {
      return;
    }

    const roomFriendParticipants = participants.filter((participant) => {
      const isFromAnotherUser = Boolean(
        participant.createdBy && participant.createdBy !== currentUserId,
      );
      const hasValidLocation =
        Boolean(participant.name.trim()) &&
        Boolean(participant.location.trim()) &&
        Number.isFinite(participant.coordinates.lat) &&
        Number.isFinite(participant.coordinates.lng);

      return isFromAnotherUser && hasValidLocation;
    });

    if (!roomFriendParticipants.length) {
      return;
    }

    const nextFriends = roomFriendParticipants.reduce(
      (currentFriends, participant) =>
        upsertSavedFriend(currentFriends, buildSavedFriendFromParticipant(participant)),
      savedFriends,
    );

    if (getSavedFriendSyncSignature(nextFriends) === getSavedFriendSyncSignature(savedFriends)) {
      return;
    }

    persistFriends(nextFriends);
  }, [
    currentUserId,
    onlineRoom,
    participants,
    savedFriends,
    savedFriendsLoadedUserId,
  ]);

  const handleCopyRoomLink = async () => {
    if (!onlineRoom) {
      return;
    }

    const shareUrl = getRoomShareUrl(onlineRoom.code);
    const shareText = `KoK 약속방 ${onlineRoom.code}\n출발지를 모아 장소를 정해요.`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: `KoK 약속방 ${onlineRoom.code}`,
          text: shareText,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      }

      setCopiedRoomLink(true);
      window.setTimeout(() => setCopiedRoomLink(false), 1600);
    } catch {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        setCopiedRoomLink(true);
        window.setTimeout(() => setCopiedRoomLink(false), 1600);
      } catch {
        setRoomMessage(shareUrl);
      }
    }
  };

  const resetLocationDraft = () => {
    setAddressQuery('');
    setAddressResults([]);
    setNewLocation('');
    setNewCoordinates(null);
    setLocationError(null);
  };

  const resetParticipantDraft = () => {
    setNewName('');
    setShowAddForm(false);
    setSaveNewFriend(!isGuestMode);
    setLocationMode('address');
    setNewTravelMode('transit');
    setNewGender('unspecified');
    setEditingSelfParticipantId(null);
    resetLocationDraft();
  };

  const handleLocationModeChange = (mode: LocationMode) => {
    setLocationMode(mode);
    resetLocationDraft();

    if (mode === 'map') {
      setActivePlannerPage('map');
    }
  };

  const handleAddressSearch = async () => {
    const query = addressQuery.trim();

    if (!query) {
      setLocationError('주소가 필요해요.');
      return;
    }

    setIsSearchingAddress(true);
    setLocationError(null);
    setAddressResults([]);
    setNewCoordinates(null);
    setNewLocation('');

    try {
      if (looksLikeUnsupportedServiceAreaQuery(query)) {
        setLocationError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
        return;
      }

      const rawResults = await searchAddress(query);
      const results = filterSupportedServiceAreaResults(rawResults);

      if (!results.length) {
        setLocationError(
          rawResults.length
            ? SERVICE_AREA_UNSUPPORTED_MESSAGE
            : '검색 결과가 없어요.',
        );
        return;
      }

      const nextResults = results.slice(0, 5);
      const firstResult = nextResults[0];

      setAddressResults(nextResults);

      if (firstResult) {
        const locationLabel = getAddressResultLocationLabel(firstResult);
        setNewLocation(locationLabel);
        setAddressQuery(locationLabel);
        setNewCoordinates(firstResult.coordinates);
      }
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : '주소를 못 찾았어요.');
    } finally {
      setIsSearchingAddress(false);
    }
  };

  const handleSelectAddressResult = (result: AddressSearchResult) => {
    const locationLabel = getAddressResultLocationLabel(result);

    setNewLocation(locationLabel);
    setAddressQuery(locationLabel);
    setNewCoordinates(result.coordinates);
    setLocationError(null);
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('현재 위치를 쓸 수 없어요.');
      return;
    }

    setLocationMode('current');
    setIsLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        if (!isSupportedServiceAreaLocation({ coordinates })) {
          setNewCoordinates(null);
          setNewLocation('');
          setLocationError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
          setIsLocating(false);
          return;
        }

        setNewCoordinates(coordinates);
        setNewLocation('현재 위치 기준');
        setIsLocating(false);
      },
      (error) => {
        setLocationError(getLocationErrorMessage(error));
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  };

  const handleMapLocationPick = async (coordinates: Coordinates) => {
    setShowAddForm(true);
    setActivePlannerPage('people');
    setLocationMode('map');
    setNewCoordinates(coordinates);
    setAddressResults([]);
    setLocationError(null);

    window.requestAnimationFrame(() => {
      participantSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });

    try {
      const result = await reverseGeocodeCoordinates(coordinates.lat, coordinates.lng);
      if (!isSupportedServiceAreaLocation({ ...result, coordinates })) {
        setNewCoordinates(null);
        setNewLocation('');
        setAddressQuery('');
        setLocationError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
        return;
      }

      const locationLabel = getAddressResultLocationLabel(result);
      setNewLocation(locationLabel);
      setAddressQuery(locationLabel);
    } catch (error) {
      if (!isSupportedServiceAreaLocation({ coordinates })) {
        setNewCoordinates(null);
        setNewLocation('');
        setAddressQuery('');
        setLocationError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
        return;
      }

      setNewLocation('지도에서 선택한 위치');
      setAddressQuery('');
	      setLocationError(error instanceof Error ? error.message : '주소를 못 봤어요.');
    }
  };

  const handleQuickAddSavedFriend = (friend: SavedFriend) => {
    if (isFriendAlreadyAdded(participants, friend)) {
      return;
    }

    if (!isSupportedServiceAreaLocation({ location: friend.location, coordinates: friend.coordinates })) {
      setRoomMessage(SERVICE_AREA_UNSUPPORTED_MESSAGE);
      return;
    }

    const nextParticipant = createParticipantFromSavedFriend(friend);
    setParticipants((current) => [...current, nextParticipant]);

    if (onlineRoom) {
      pendingRoomParticipantIdsRef.current.add(nextParticipant.id);
      rememberLocalRoomParticipant(onlineRoom.id, nextParticipant.id);
      void addRoomParticipant({
        roomId: onlineRoom.id,
        participant: nextParticipant,
        userId: currentUserId || null,
      }).catch((error: Error) => {
        pendingRoomParticipantIdsRef.current.delete(nextParticipant.id);
        forgetLocalRoomParticipant(onlineRoom.id, nextParticipant.id);
        setRoomMessage(error.message);
        setParticipants((current) =>
          current.filter((participant) => participant.id !== nextParticipant.id),
        );
      });
    }
  };

  const upsertSelfProfileParticipant = (homeLocation: UserHomeLocation) => {
    if (!currentUserId || !selfProfileParticipantKey) {
      return false;
    }

    if (
      !isSupportedServiceAreaLocation({
        location: homeLocation.location,
        coordinates: homeLocation.coordinates,
      })
    ) {
      setRoomMessage(SERVICE_AREA_UNSUPPORTED_MESSAGE);
      return false;
    }

    const targetParticipant =
      selfProfileParticipant ??
      participants.find(
        (participant) =>
          participant.createdBy === currentUserId &&
          participant.name === currentUserName,
      ) ??
      null;
    const selfParticipantId = `participant-self-${onlineRoom?.id ?? 'local'}-${currentUserId}`;
    const nextParticipant: Participant = {
      id: targetParticipant?.id ?? selfParticipantId,
      name: currentUserName,
      avatarUrl: currentUserAvatarUrl,
      location: homeLocation.location,
      coordinates: homeLocation.coordinates,
      maxTravelTime: targetParticipant?.maxTravelTime ?? DEFAULT_MAX_TRAVEL_TIME,
      travelMode: targetParticipant?.travelMode ?? 'transit',
      gender: currentUserGender,
      locationSource: homeLocation.locationSource ?? 'current',
      savedFriendId: selfProfileParticipantKey,
      createdBy: currentUserId,
    };

    if (
      targetParticipant &&
      getParticipantSyncSignature([targetParticipant]) ===
        getParticipantSyncSignature([nextParticipant])
    ) {
      return true;
    }

    setParticipants((current) =>
      current.some((participant) => participant.id === nextParticipant.id)
        ? current.map((participant) =>
            participant.id === nextParticipant.id ? nextParticipant : participant,
          )
        : [...current, nextParticipant],
    );

    if (onlineRoom) {
      pendingRoomParticipantIdsRef.current.add(nextParticipant.id);
      rememberLocalRoomParticipant(onlineRoom.id, nextParticipant.id);
      void addRoomParticipant({
        roomId: onlineRoom.id,
        participant: nextParticipant,
        userId: currentUserId || null,
      }).catch((error: Error) => {
        pendingRoomParticipantIdsRef.current.delete(nextParticipant.id);
        forgetLocalRoomParticipant(onlineRoom.id, nextParticipant.id);
        setRoomMessage(error.message);
        setParticipants((current) =>
          targetParticipant
            ? current.map((participant) =>
                participant.id === targetParticipant.id ? targetParticipant : participant,
              )
            : current.filter((participant) => participant.id !== nextParticipant.id),
        );
      });
    }

    return true;
  };

  useEffect(() => {
    if (!onlineRoom || !currentUserId || !currentUserHomeLocation || isSelfProfileAdded) {
      return;
    }

    const autoAddKey = [
      onlineRoom.id,
      currentUserId,
      currentUserHomeLocation.location,
      currentUserHomeLocation.coordinates.lat,
      currentUserHomeLocation.coordinates.lng,
    ].join(':');

    if (autoAddedSelfProfileKeyRef.current === autoAddKey) {
      return;
    }

    autoAddedSelfProfileKeyRef.current = autoAddKey;
    upsertSelfProfileParticipant(currentUserHomeLocation);
  }, [
    currentUserHomeLocation,
    currentUserId,
    isSelfProfileAdded,
    onlineRoom?.id,
  ]);

  const handleUpdateHomeLocationFromCurrentPosition = async () => {
    if (!currentUserId) {
      onOpenProfile?.();
      return;
    }

    if (!onUpdateHomeLocation) {
      setRoomMessage('내 정보가 필요해요.');
      onOpenProfile?.();
      return;
    }

    setIsUpdatingHomeLocation(true);
    setLocationError(null);
    setRoomMessage(null);

    try {
      const coordinates = await getBrowserCurrentCoordinates();
      let locationLabel = '현재 위치 기준';

      try {
        const result = await reverseGeocodeCoordinates(coordinates.lat, coordinates.lng);

        if (!isSupportedServiceAreaLocation({ ...result, coordinates })) {
          throw new Error(SERVICE_AREA_UNSUPPORTED_MESSAGE);
        }

        locationLabel = getAddressResultLocationLabel(result);
      } catch (error) {
        if (error instanceof Error && error.message === SERVICE_AREA_UNSUPPORTED_MESSAGE) {
          throw error;
        }

        if (!isSupportedServiceAreaLocation({ coordinates })) {
          throw new Error(SERVICE_AREA_UNSUPPORTED_MESSAGE);
        }
      }

      const nextHomeLocation: UserHomeLocation = {
        location: locationLabel,
        coordinates,
        locationSource: 'current',
      };
      const result = await onUpdateHomeLocation(nextHomeLocation);

      if (result && result.error) {
        throw new Error(result.error);
      }

      upsertSelfProfileParticipant(nextHomeLocation);
      setRoomMessage('위치를 바꿨어요.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '위치를 못 저장했어요.';
      setRoomMessage(message);
      setLocationError(message);
    } finally {
      setIsUpdatingHomeLocation(false);
    }
  };

  useEffect(() => {
    if (
      !currentUserId ||
      !currentUserHomeLocation ||
      selfProfileMatchesHomeLocation ||
      (onlineRoom && roomSyncStatus === 'loading')
    ) {
      return;
    }

    upsertSelfProfileParticipant(currentUserHomeLocation);
  }, [
    currentUserId,
    currentUserHomeLocation,
    onlineRoom,
    roomSyncStatus,
    selfProfileMatchesHomeLocation,
  ]);

  const handleSaveParticipantFriend = (participantId: string) => {
    const target = participants.find((participant) => participant.id === participantId);

    if (!target) {
      return;
    }

    const nextSavedFriend = buildSavedFriendFromParticipant({
      ...target,
      savedFriendId: target.savedFriendId ?? `friend-${Date.now()}`,
    });

    const nextFriends = upsertSavedFriend(savedFriends, nextSavedFriend);
    persistFriends(nextFriends);

    setParticipants((current) =>
      current.map((participant) =>
        participant.id === participantId
          ? { ...participant, savedFriendId: nextSavedFriend.id }
          : participant,
      ),
    );
  };

  const handleDeleteSavedFriend = (friendId: string) => {
    const nextFriends = savedFriends.filter((friend) => friend.id !== friendId);
    persistFriends(nextFriends);

    setParticipants((current) =>
      current.map((participant) =>
        participant.savedFriendId === friendId
          ? { ...participant, savedFriendId: undefined }
          : participant,
      ),
    );
  };

  const handleAddParticipant = () => {
    if (!newName.trim()) {
      return;
    }

    if (!newCoordinates) {
      setLocationError('위치를 골라주세요.');
      return;
    }

    if (!isSupportedServiceAreaLocation({ location: newLocation, coordinates: newCoordinates })) {
      setLocationError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
      return;
    }

    const locationLabel =
      locationMode === 'current' ? newLocation || '현재 위치 기준' : getSafeLocationLabel(newLocation);
    const shouldSaveNewFriend = !isEditingSelfLocation && !isGuestMode && saveNewFriend;
    const savedFriendId = isEditingSelfLocation
      ? selfProfileParticipantKey
      : shouldSaveNewFriend
        ? `friend-${Date.now()}`
        : undefined;
    const participantId =
      editingSelfParticipantId ??
      `participant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newParticipant: Participant = {
      id: participantId,
      name: isEditingSelfLocation ? currentUserName : newName.trim(),
      avatarUrl: isEditingSelfLocation ? currentUserAvatarUrl : undefined,
      location: locationLabel,
      coordinates: newCoordinates,
      maxTravelTime: DEFAULT_MAX_TRAVEL_TIME,
      travelMode: newTravelMode,
      gender: isEditingSelfLocation ? currentUserGender : newGender,
      locationSource: locationMode,
      savedFriendId,
      createdBy: currentUserId || null,
    };
    const previousParticipant = editingSelfParticipantId
      ? participants.find((participant) => participant.id === editingSelfParticipantId) ?? null
      : null;

    setParticipants((current) =>
      editingSelfParticipantId
        ? current.some((participant) => participant.id === editingSelfParticipantId)
          ? current.map((participant) =>
              participant.id === editingSelfParticipantId ? newParticipant : participant,
            )
          : [...current, newParticipant]
        : [...current, newParticipant],
    );

    if (onlineRoom) {
      pendingRoomParticipantIdsRef.current.add(newParticipant.id);
      rememberLocalRoomParticipant(onlineRoom.id, newParticipant.id);
      void addRoomParticipant({
        roomId: onlineRoom.id,
        participant: newParticipant,
        userId: currentUserId || null,
      }).catch((error: Error) => {
        pendingRoomParticipantIdsRef.current.delete(newParticipant.id);
        forgetLocalRoomParticipant(onlineRoom.id, newParticipant.id);
        setRoomMessage(error.message);
        setParticipants((current) =>
          previousParticipant
            ? current.map((participant) =>
                participant.id === previousParticipant.id ? previousParticipant : participant,
              )
            : current.filter((participant) => participant.id !== newParticipant.id),
        );
      });
    }

    if (shouldSaveNewFriend) {
      const nextSavedFriend = buildSavedFriendFromParticipant(newParticipant);
      persistFriends(upsertSavedFriend(savedFriends, nextSavedFriend));
    }

    resetParticipantDraft();
  };

  const handleRemoveParticipant = (id: string) => {
    setParticipants((current) => current.filter((participant) => participant.id !== id));

    if (onlineRoom) {
      pendingRoomParticipantIdsRef.current.delete(id);
      forgetLocalRoomParticipant(onlineRoom.id, id);
      void removeRoomParticipant(onlineRoom.id, id).catch((error: Error) => {
        setRoomMessage(error.message);
      });
    }
  };

  const resetOnlineReadyStateAfterOptionChange = (nextSettings?: {
    selectedCategory?: MeetCategoryKey;
    selectionMode?: SelectionModeKey;
    thrillLevel?: ThrillLevel;
  }) => {
    if (!onlineRoom || !roomState) {
      return;
    }

    const nextSelectedCategory = nextSettings?.selectedCategory ?? selectedCategory;
    const nextSelectionMode = nextSettings?.selectionMode ?? selectionMode;
    const nextThrillLevel = nextSettings?.thrillLevel ?? thrillLevel;
    const previousRoom = roomState;
    const optimisticRoom = {
      ...roomState,
      selectedCategory: nextSelectedCategory,
      selectionMode: nextSelectionMode,
      thrillLevel: nextThrillLevel,
      drawReadyIds: [],
      updatedAt: new Date().toISOString(),
    };

    openedReadyDrawSessionRef.current = null;
    setSyncedRoom(optimisticRoom);

    void updateRoomPlanningCategory({
      roomId: onlineRoom.id,
      selectedCategory: nextSelectedCategory,
      selectionMode: nextSelectionMode,
      thrillLevel: nextThrillLevel,
    })
      .then((room) => {
        if (room) {
          setSyncedRoom(room);
        }
      })
      .catch((error: Error) => {
        setSyncedRoom(previousRoom);
        setRoomMessage(error.message);
      });
  };

  const handleCategorySelect = (category: MeetCategoryKey) => {
    if (category === selectedCategory) {
      return;
    }

    onCategoryChange(category);
    openedReadyDrawSessionRef.current = null;
    setRoomMessage(null);

    if (!onlineRoom || !roomState) {
      return;
    }

    const previousRoom = roomState;
    const optimisticRoom = {
      ...roomState,
      selectedCategory: category,
      selectionMode,
      thrillLevel,
      drawReadyIds: [],
      updatedAt: new Date().toISOString(),
    };

    setSyncedRoom(optimisticRoom);

    void updateRoomPlanningCategory({
      roomId: onlineRoom.id,
      selectedCategory: category,
      selectionMode,
      thrillLevel,
    })
      .then((room) => {
        setSyncedRoom(room);
      })
      .catch((error: Error) => {
        setSyncedRoom(previousRoom);
        setRoomMessage(error.message);
      });
  };

  const handleSelectionModeSelect = (mode: SelectionModeKey) => {
    if (mode === selectionMode) {
      return;
    }

    onSelectionModeChange(mode);
    resetOnlineReadyStateAfterOptionChange({ selectionMode: mode });
  };

  const handleThrillLevelSelect = (level: ThrillLevel) => {
    if (level === thrillLevel) {
      return;
    }

    onThrillLevelChange(level);
    resetOnlineReadyStateAfterOptionChange({ thrillLevel: level });
  };

  const handleCandidateCardSelect = (candidateId: string) => {
    setSelectedCandidateId(candidateId);
    setExpandedCandidateId((current) => (current === candidateId ? null : candidateId));
  };

  const handleExcludeCandidate = (candidateId: string) => {
    setExcludedCandidateIds((current) =>
      current.includes(candidateId) ? current : [...current, candidateId],
    );

    if (expandedCandidateId === candidateId) {
      setExpandedCandidateId(null);
    }

    if (selectedCandidateId === candidateId) {
      const nextInsight = visibleCandidateInsights.find(
        (insight) => insight.candidate.id !== candidateId,
      );
      setSelectedCandidateId(nextInsight?.candidate.id ?? null);
    }
  };

  const handleReadyToggle = async () => {
    if (!onlineRoom || !roomState) {
      return;
    }

    if (!currentReadyActorId) {
      setRoomMessage('위치가 필요해요.');
      return;
    }

    const nextReady = !isCurrentActorReady;
    const optimisticReadyIds = nextReady
      ? [...new Set([...roomReadyIds, currentReadyActorId])]
      : roomReadyIds.filter((readyId) => readyId !== currentReadyActorId);
    const previousRoom = roomState;

    setIsSettingReady(true);
    setRoomMessage(null);
    setSyncedRoom({
      ...roomState,
      drawReadyIds: optimisticReadyIds,
      updatedAt: new Date().toISOString(),
    });

    try {
      const nextRoom = await setRoomDrawReady({
        room: roomState,
        actorId: currentReadyActorId,
        ready: nextReady,
      });
      setSyncedRoom(nextRoom);
    } catch (error) {
      setSyncedRoom(previousRoom);
      setRoomMessage(error instanceof Error ? error.message : '레디를 못 했어요.');
    } finally {
      setIsSettingReady(false);
    }
  };

  const handleDrawComplete = (winner: Candidate, proof: DrawProof) => {
    const completionParticipants = drawSessionSnapshot?.participants ?? participants;

    if (onlineRoom) {
      if (!isCurrentDrawController) {
        return;
      }

      void (async () => {
        try {
          const roomParticipants = await loadRoomParticipants(onlineRoom.id).catch(
            () => completionParticipants,
          );
          const completionRoomParticipants = roomParticipants.length
            ? roomParticipants
            : completionParticipants;
          const selectedRouteSnapshot = await buildWinnerRouteSnapshot(
            completionRoomParticipants,
            winner,
          ).catch(() => null);
          const room = await updateRoomSelection({
            roomId: onlineRoom.id,
            selectedCategory,
            selectionMode,
            thrillLevel,
            selectedCandidate: winner,
            selectedRouteSnapshot,
          });

          setSyncedRoom(room);
          const winnerKey = `${room.selectedCandidate?.id ?? winner.id}-${room.updatedAt}`;
          seenRoomWinnerRef.current = winnerKey;
          closeDrawDrawer();
          onComplete(
            room.selectedCandidate ?? winner,
            completionRoomParticipants,
            room.selectedCategory,
            proof,
            room.selectedRouteSnapshot ?? selectedRouteSnapshot,
          );
        } catch (error) {
          setRoomMessage(error instanceof Error ? error.message : '결과를 못 저장했어요.');
        }
      })();

      return;
    }

    closeDrawDrawer();
    onComplete(winner, completionParticipants, selectedCategory, proof);
  };

  const handleSaveAiConfig = (config: RuntimeAiConfig) => {
    persistRuntimeAiConfig(config);
    setRuntimeAiConfig(config);
    setIsAiConfigOpen(false);
  };

  const handleClearAiConfig = () => {
    clearRuntimeAiConfig();
    setRuntimeAiConfig(null);
    setIsAiConfigOpen(false);
  };

  const resolvedCandidateGuideText =
    sharedCandidateStatus === 'loading'
      ? '후보 찾는 중이에요.'
      : sharedCandidateError
        ? sharedCandidateError
        : fairnessVerificationMessage
          ? fairnessVerificationMessage
        : sharedCandidateMessage
          ? sharedCandidateMessage
	          : fallbackNotice ?? `후보 ${drawPool.length}곳이 있어요.`;
  const displayRoomMessage = getFriendlyRoomMessage(roomMessage);
  const activeDrawSession = drawSessionSnapshot ?? {
    candidateInsights: drawPool,
    participants,
    seed: readyDrawSessionSeed ?? undefined,
    ladderBars: undefined,
  };
  const sharedSelectedSlotIndex =
    onlineRoom &&
    activeDrawSession.seed &&
    sharedDrawChoice?.seed === activeDrawSession.seed
      ? sharedDrawChoice.selectedSlotIndex
      : null;
  const sharedChoicePlayAt =
    onlineRoom &&
    activeDrawSession.seed &&
    sharedDrawChoice?.seed === activeDrawSession.seed
      ? sharedDrawChoice.playAt
      : null;
  const handleDrawLadderBarsChange = (ladderBars: LadderBar[]) => {
    if (!onlineRoom || !activeDrawSession.seed || !isCurrentDrawController) {
      return;
    }

    const nextSnapshot: DrawSessionSnapshot = {
      candidateInsights: activeDrawSession.candidateInsights,
      participants: activeDrawSession.participants,
      seed: activeDrawSession.seed,
      ladderBars,
    };
    const nextBars: SharedDrawLadderBars = {
      roomId: onlineRoom.id,
      seed: activeDrawSession.seed,
      ladderBars,
      updatedAt: new Date().toISOString(),
      controllerId: activeDrawControllerId ?? currentReadyActorId ?? null,
      snapshot: nextSnapshot,
    };

    setDrawSessionSnapshot((current) =>
      current?.seed === activeDrawSession.seed
        ? {
            ...current,
            ladderBars,
          }
        : nextSnapshot,
    );

    void drawChoiceChannelRef.current
      ?.send({
        type: 'broadcast',
        event: 'draw-ladder-bars',
        payload: nextBars,
      })
      .catch(() => {
        setRoomMessage('사다리가 늦어요.');
      });
  };
  const handleDrawChoice = (
    selectedSlotIndex: number,
    state?: {
      ladderBars?: LadderBar[];
    },
  ) => {
    if (!onlineRoom || !activeDrawSession.seed || !isCurrentDrawController) {
      return;
    }

    const ladderBars = state?.ladderBars ?? activeDrawSession.ladderBars;
    const nextChoice: SharedDrawChoice = {
      roomId: onlineRoom.id,
      seed: activeDrawSession.seed,
      selectedSlotIndex,
      selectedAt: new Date().toISOString(),
      playAt: new Date(Date.now() + 1300).toISOString(),
      controllerId: activeDrawControllerId ?? currentReadyActorId ?? null,
      snapshot: {
        candidateInsights: activeDrawSession.candidateInsights,
        participants: activeDrawSession.participants,
        seed: activeDrawSession.seed,
        ladderBars,
      },
    };

    setSharedDrawChoice(nextChoice);
    void drawChoiceChannelRef.current
      ?.send({
        type: 'broadcast',
        event: 'draw-choice',
        payload: nextChoice,
      })
      .catch(() => {
        setRoomMessage('게임이 늦어요.');
      });
  };
  const plannerLoadingState =
	    aiCandidateStatus === 'loading'
	      ? {
		          title: '후보 찾는 중이에요',
		          steps: ['중간', '분위기', '정렬'],
	        }
	      : fairnessVerificationPending
	        ? {
		            title: '시간 맞추는 중이에요',
		            steps: ['경로', '시간차', '정리'],
	          }
	        : selectedRouteStatus === 'loading' && selectedInsight
	          ? {
		              title: `${selectedInsight.candidate.name} 길 확인 중`,
		              steps: ['출발지', '시간', '경로'],
	            }
          : null;

  return (
    <div className="kok-screen-enter min-h-screen bg-[#FFFFFF] pb-56 text-[#16241D] sm:pb-52">
      <div className="sticky top-0 z-20 flex items-center justify-between rounded-b-[2rem] bg-[#FFFFFF]/88 px-5 py-4 shadow-[0_10px_30px_rgba(20,35,29,0.08)] backdrop-blur-md">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-[#16241D] shadow-sm transition-transform active:scale-95"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h2 className="absolute left-1/2 -translate-x-1/2 text-xl font-black tracking-[-0.05em] text-[#16241D]">
          KoK
        </h2>
        {onOpenProfile ? (
          <button
            type="button"
            onClick={onOpenProfile}
            className="inline-flex h-10 max-w-[132px] items-center gap-1.5 rounded-full bg-white px-3 text-sm text-[#16241D] shadow-sm transition-transform active:scale-95"
            aria-label="프로필 설정"
          >
            {currentUserAvatarUrl ? (
              <img
                src={currentUserAvatarUrl}
                alt=""
                className="h-5 w-5 shrink-0 rounded-full object-cover"
              />
            ) : (
              <UserRound className="h-4 w-4 shrink-0 text-[#6E7C75]" />
            )}
            <span className="truncate">{currentUserName}</span>
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      <div className="mx-auto flex max-w-[1040px] flex-col gap-4 px-4 py-5 sm:gap-5 sm:py-6">
        {onlineRoom && (
          <section className="kok-card-pop rounded-[1.35rem] border border-white/80 bg-white/95 p-3 shadow-[0_10px_28px_rgba(20,35,29,0.07)] backdrop-blur-xl">
            <div className="flex items-start">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={handleCopyRoomLink}
                  className="kok-pressable inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-[#E6F7F0] px-3 text-xs font-extrabold text-[#0CA178] shadow-[0_8px_20px_rgba(12,161,120,0.1)]"
                  aria-label={`약속방 ${onlineRoom.code} 링크 공유`}
                >
                  <Wifi className="h-3.5 w-3.5 shrink-0" />
                  방 {onlineRoom.code}
                  <span className="h-4 w-px bg-[#0CA178]/20" aria-hidden="true" />
                  <Copy className="h-3 w-3 shrink-0" />
                  <span>{copiedRoomLink ? '복사됨' : '공유'}</span>
                </button>
                <h3 className="mt-2 text-[1.15rem] font-black leading-tight tracking-normal text-[#16241D]">
                  {plannerStageTitle}
                </h3>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <div className="rounded-[1rem] bg-[#F5F9F7] px-2.5 py-2">
                <div className="text-[10px] font-bold text-[#8B9992]">참여</div>
                <div className="mt-0.5 text-base font-black text-[#16241D]">{participants.length}명</div>
              </div>
              <div className="rounded-[1rem] bg-[#F5F9F7] px-2.5 py-2">
                <div className="text-[10px] font-bold text-[#8B9992]">레디</div>
                <div className="mt-0.5 text-base font-black text-[#16241D]">
                  {readyCount}/{Math.max(readyRequiredCount, 0)}
                </div>
              </div>
              <div className="rounded-[1rem] bg-[#F5F9F7] px-2.5 py-2">
                <div className="text-[10px] font-bold text-[#8B9992]">후보</div>
                <div className="mt-0.5 text-base font-black text-[#16241D]">{drawPool.length}곳</div>
              </div>
            </div>

            {(displayRoomMessage || roomSyncStatus === 'error') && (
              <div className="mt-2 rounded-2xl bg-[#fff8e8] px-3 py-2 text-xs font-semibold text-[#8a621c]">
	                {displayRoomMessage || '방 연결을 봐주세요.'}
              </div>
            )}
          </section>
	        )}

	        <nav className="grid grid-cols-3 gap-1.5 rounded-[1.15rem] bg-[#F5F9F7] p-1">
	          {plannerPages.map((page) => {
	            const active = page.key === activePlannerPage;
	            const PageIcon = page.icon;

	            return (
	              <button
	                key={page.key}
	                type="button"
	                onClick={() => setActivePlannerPage(page.key)}
	                aria-label={`${page.ariaLabel} ${page.value}`}
	                className={`kok-pressable flex min-h-11 flex-col items-center justify-center rounded-[0.9rem] px-2 text-center transition-all ${
	                  active
	                    ? 'bg-white text-[#16241D] shadow-sm'
	                    : 'text-[#6E7C75]'
	                }`}
	              >
	                <span className="flex items-center justify-center gap-1">
	                  <span
	                    className={`flex h-5 w-5 items-center justify-center rounded-full transition-all ${
	                      active ? 'bg-[#E6F7F0] text-[#0CA178]' : 'bg-white/70 text-[#9AA8A1]'
	                    }`}
	                  >
	                    <PageIcon className="h-3.5 w-3.5" />
	                  </span>
	                  <span className="text-xs font-black">{page.label}</span>
	                </span>
	                <span className="mt-0.5 text-[11px] font-bold">{page.value}</span>
	              </button>
	            );
	          })}
	        </nav>

	        {activePlannerPage === 'map' && (
	        <section className="order-1 space-y-3">
		          <div className="flex items-end justify-between gap-3 px-1">
		            <div>
		              <h3 className="text-lg font-black tracking-normal text-[#16241D]">지도에서 보기</h3>
	            </div>
            <span className="shrink-0 rounded-full bg-[#F5F9F7] px-3 py-1.5 text-xs font-bold text-[#6E7C75]">
              {visibleCandidateInsights.length}곳
            </span>
          </div>
          <MapView
            participants={participants}
            candidates={visibleCandidateInsights.map((insight) => insight.candidate)}
            reachableCandidateIds={drawPool.map((candidate) => candidate.candidate.id)}
            selectedCandidate={selectedInsight?.candidate}
            selectedRoutes={selectedMapRoutes}
            nearbyPlaces={nearbyMapPlaces}
            onCandidateSelect={setSelectedCandidateId}
            onRouteSelect={handleMapRouteSelect}
            locationPickerEnabled={showAddForm && locationMode === 'map'}
            locationPickerHintVisible={showAddForm && locationMode === 'map'}
            pickedLocationPreview={showAddForm ? newCoordinates : null}
            onLocationPick={handleMapLocationPick}
	            colors={PARTICIPANT_COLORS}
	          />
	        </section>
	        )}

        <div className="order-3 flex flex-col gap-2 rounded-[1.25rem] border border-white/80 bg-white/95 p-3 shadow-[0_8px_24px_rgba(20,35,29,0.05)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-[#12B886]" />
            <span className="rounded-full bg-[#E6F7F0] px-3 py-1 text-xs font-semibold text-[#12B886]">
              {activeCategory.label}
            </span>
            <span className="rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-semibold text-[#16241D]">
              {activeMode.shortLabel}
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs text-[#16241D] shadow-sm">
              {activeModeDetailLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowOptionsPage(true)}
            className="kok-pressable inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#F5F9F7] px-4 text-sm font-extrabold text-[#16241D] shadow-sm sm:self-auto"
          >
            <Settings2 className="h-4 w-4" />
            옵션 변경
          </button>
        </div>

        {plannerLoadingState && (
          <section className="kok-loading-card order-3 rounded-[1.75rem] border border-white/80 bg-white/94 p-4 shadow-[0_12px_34px_rgba(20,35,29,0.08)] backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="kok-route-loader">
                <span />
              </div>
	              <div className="min-w-0 flex-1">
	                <div className="text-sm font-bold text-[#16241D]">
	                  {plannerLoadingState.title}
	                </div>
	              </div>
            </div>
            <div className="mt-4 kok-loading-progress" />
            <div className="kok-stagger-list mt-3 grid gap-2 sm:grid-cols-3">
              {plannerLoadingState.steps.map((step) => (
                <div
                  key={step}
                  className="kok-loading-step rounded-2xl px-3 py-2 text-xs font-semibold text-[#52615f]"
                >
                  {step}
                </div>
              ))}
            </div>
          </section>
        )}

	        {activePlannerPage === 'people' && (
	        <>
	        <section ref={participantSectionRef} className="order-2">
          {(showAddForm || participants.length > 0) && (
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (showAddForm) {
                    resetParticipantDraft();
                    return;
                  }

                  setShowAddForm(true);
                }}
	                className={`kok-pressable inline-flex h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-extrabold shadow-sm transition-all ${
	                  showAddForm
	                    ? 'border-[#16241D] bg-[#16241D] text-white'
	                    : 'border-[#E4EFE9] bg-white text-[#16241D] hover:bg-[#F5F9F7]'
                }`}
	              >
	                <Plus className={`h-4 w-4 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
	                {showAddForm ? '닫기' : '친구 추가'}
	              </button>
            </div>
          )}

          {currentUserId && (
            <div className="mb-3 flex flex-col gap-3 rounded-[1.75rem] border border-white/80 bg-white/95 p-4 shadow-[0_12px_34px_rgba(20,35,29,0.07)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F5F9F7] text-[#16241D]">
                  {currentUserAvatarUrl ? (
                    <img
                      src={currentUserAvatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <UserRound className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-base font-black text-[#16241D]">내 위치</div>
                    <span className="rounded-full bg-[#E6F7F0] px-2.5 py-1 text-[11px] font-extrabold text-[#0CA178]">
	                      {selfProfileParticipant ? '참여됐어요' : '위치 필요'}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold text-[#6E7C75]">
                    {currentUserHomeLocation
                      ? [
                          currentUserName,
                          getSafeLocationLabel(currentUserHomeLocation.location),
                          currentUserGender !== 'unspecified'
                            ? getParticipantGenderLabel(currentUserGender)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
	                      : '위치가 없어요.'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  void handleUpdateHomeLocationFromCurrentPosition();
                }}
                disabled={isUpdatingHomeLocation}
                className="kok-pressable inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[1.25rem] bg-[#16241D] px-5 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(20,35,29,0.14)] disabled:opacity-60"
              >
                {isUpdatingHomeLocation ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <LocateFixed className="h-4 w-4" />
                )}
                {currentUserHomeLocation ? '내 위치 변경' : '현재 위치 저장'}
              </button>
            </div>
          )}

          {!isGuestMode && savedFriends.length > 0 && (
            <div className="mb-3 rounded-[1.75rem] border border-white/70 bg-white/95 p-3 shadow-[0_10px_30px_rgba(20,35,29,0.06)]">
              <div className="mb-2 flex items-center justify-between gap-2 text-[#16241D]">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-[#16241D]" />
                  <span className="text-sm">저장된 친구</span>
                </div>
	                <span className="text-xs text-[#9AA8A1]">탭해서 추가</span>
              </div>

              <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">
                {savedFriends.map((friend) => {
                  const alreadyAdded = isFriendAlreadyAdded(participants, friend);
                  const TravelIcon = getTravelModeIcon(friend.travelMode);

                  return (
                    <div
                      key={friend.id}
                      className={`inline-flex max-w-full items-center rounded-full border text-sm transition-all ${
                        alreadyAdded
                          ? 'border-[#E4EFE9] bg-[#FFFFFF] text-[#9AA8A1]'
                          : 'border-[#E4EFE9] bg-[#F5F9F7] text-[#16241D] hover:border-[#16241D]/30 hover:bg-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!alreadyAdded) {
                            handleQuickAddSavedFriend(friend);
                          }
                        }}
                        disabled={alreadyAdded}
                        className="inline-flex min-w-0 items-center gap-2 rounded-l-full py-2 pl-3 pr-2 text-left transition-transform active:scale-95 disabled:cursor-default"
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                            alreadyAdded ? 'bg-white text-[#9AA8A1]' : 'bg-[#16241D] text-white'
                          }`}
                        >
                          {alreadyAdded ? '✓' : '+'}
                        </span>
                        <span className="min-w-0 truncate">{friend.name}</span>
                        <span className="hidden max-w-28 truncate text-xs text-[#9AA8A1] sm:inline">
                          {getSafeLocationLabel(friend.location)}
                        </span>
                        {friend.gender && friend.gender !== 'unspecified' && (
                          <span className="inline-flex shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-[#6E7C75]">
                            {getParticipantGenderLabel(friend.gender)}
                          </span>
                        )}
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-[#6E7C75]">
                          <TravelIcon className="h-3 w-3" />
                          {getTravelModeLabel(friend.travelMode)}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteSavedFriend(friend.id)}
                        className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#9AA8A1] transition-colors hover:bg-[#CFEBDF] hover:text-[#0CA178]"
                        aria-label={`${friend.name} 저장된 친구 삭제`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!showAddForm && participants.length === 0 && (
            <div className="mb-3 flex flex-col gap-4 rounded-[1.75rem] border border-dashed border-[#E4EFE9] bg-white/78 p-5 text-center shadow-[0_10px_30px_rgba(20,35,29,0.04)] sm:flex-row sm:items-center sm:justify-between sm:text-left">
              <div className="flex min-w-0 flex-col items-center gap-3 sm:flex-row">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FFFFFF] text-[#16241D]">
                  {onlineRoom ? <Wifi className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#16241D]">
	                    {onlineRoom ? '참여를 기다려요' : '참여자가 없어요'}
	                  </div>
	                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#16241D] px-4 text-sm font-medium text-white shadow-sm transition-transform active:scale-95"
              >
                <Plus className="h-4 w-4" />
	                친구 추가
              </button>
            </div>
          )}

          {showAddForm && (
            <div className="mb-3 rounded-[2rem] border border-white/70 bg-white/95 p-5 shadow-[0_10px_30px_rgba(20,35,29,0.08)]">
              <BookmarkPlus className="mb-4 h-4 w-4 text-[#16241D]" />

              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="이름"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-[#E4EFE9] bg-[#F5F9F7] px-4 text-[#16241D] outline-none placeholder:text-[#9AA8A1] focus:border-[#E4EFE9] focus:ring-2 focus:ring-[#16241D]/10"
                />

                <div className="rounded-2xl border border-[#E4EFE9] bg-[#F5F9F7] p-3">
                  <div className="mb-2 text-xs text-[#6E7C75]">성별</div>
                  <div className="flex flex-wrap gap-2">
                    {participantGenderOptions.map((option) => {
                      const active = newGender === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setNewGender(option.value)}
                          className={`rounded-full px-3 py-1.5 text-xs transition-all ${
                            active ? 'bg-[#16241D] text-white shadow-sm' : 'bg-white text-[#44505b]'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[#f7f3ed] p-1.5">
                    <button
                      type="button"
                      onClick={() => handleLocationModeChange('address')}
                      className={`h-11 rounded-xl px-3 text-sm font-medium transition-all ${
                        locationMode === 'address'
                          ? 'bg-[#16241D] text-white shadow-sm'
                          : 'text-[#6E7C75]'
                      }`}
                    >
                      주소 검색
                    </button>

                    <button
                      type="button"
                      onClick={() => handleLocationModeChange('current')}
                      className={`h-11 rounded-xl px-3 text-sm font-medium transition-all ${
                        locationMode === 'current'
                          ? 'bg-[#16241D] text-white shadow-sm'
                          : 'text-[#6E7C75]'
                      }`}
                    >
                      현재 위치
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLocationModeChange('map')}
                      className={`h-11 rounded-xl px-3 text-sm font-medium transition-all ${
                        locationMode === 'map'
                          ? 'bg-[#16241D] text-white shadow-sm'
                          : 'text-[#6E7C75]'
                      }`}
                    >
                      지도에서 찍기
                    </button>
                  </div>

                  {locationMode === 'current' ? (
                    <div className="rounded-2xl border border-[#E4EFE9] bg-[#F5F9F7] p-4">
                      <button
                        type="button"
                        onClick={handleUseCurrentLocation}
                        disabled={isLocating}
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E6F7F0] text-[#0CA178] transition-transform active:scale-95 disabled:opacity-60"
                      >
                        {isLocating ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <LocateFixed className="h-4 w-4" />
                        )}
	                        {isLocating ? '찾는 중' : '현재 위치'}
	                      </button>

	                      {newCoordinates && (
	                        <div className="mt-3 rounded-xl border border-[#E4EFE9] bg-white px-3 py-2 text-xs text-[#16241D]">
	                          위치를 골랐어요.
	                        </div>
	                      )}

                      {locationError && (
                        <div className="mt-3 rounded-xl border border-[#ffd9cf] bg-[#E6F7F0] px-3 py-2 text-xs text-[#c15b3d]">
                          {locationError}
                        </div>
                      )}
                    </div>
                  ) : locationMode === 'map' ? (
                    <div className="rounded-2xl border border-[#E4EFE9] bg-[#F5F9F7] p-4">
                      <div className="rounded-2xl bg-white px-4 py-4">
                        <div className="text-sm text-[#16241D]">
	                          지도를 길게 눌러 골라요
	                        </div>
	                      </div>

                      {newCoordinates && (
                        <div className="mt-3 rounded-xl border border-[#E4EFE9] bg-white px-3 py-2 text-xs text-[#16241D]">
                          {newLocation
                            ? getSafeLocationLabel(newLocation)
	                            : '위치를 골랐어요.'}
                        </div>
                      )}

                      {locationError && (
                        <div className="mt-3 rounded-xl border border-[#ffd9cf] bg-[#E6F7F0] px-3 py-2 text-xs text-[#c15b3d]">
                          {locationError}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-[#E4EFE9] bg-[#F5F9F7] p-2">
                      <div className="flex items-center gap-2 rounded-xl bg-white p-1.5">
                        <input
                          type="text"
                          value={addressQuery}
                          onChange={(event) => {
                            setAddressQuery(event.target.value);
                            setLocationError(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void handleAddressSearch();
                            }
                          }}
                          placeholder="역, 장소명, 건물명, 도로명"
                          className="h-11 min-w-0 flex-1 rounded-lg border-0 bg-transparent px-3 text-sm text-[#16241D] outline-none placeholder:text-[#9AA8A1] focus:ring-0"
                        />

                        <button
                          type="button"
                          onClick={() => {
                            void handleAddressSearch();
                          }}
                          disabled={isSearchingAddress}
                          className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#E6F7F0] px-4 text-sm font-medium text-[#0CA178] transition-transform active:scale-95 disabled:opacity-60"
                        >
                          {isSearchingAddress ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <Search className="h-4 w-4" />
                          )}
                          검색
                        </button>
                      </div>

                      {addressResults.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {addressResults.map((result) => {
                            const locationLabel = getAddressResultLocationLabel(result);
                            const isSelected = newLocation === locationLabel;

                            return (
                              <button
                                key={`${result.title}-${result.coordinates.lat}-${result.coordinates.lng}`}
                                type="button"
                                onClick={() => handleSelectAddressResult(result)}
                                className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                                  isSelected
                                    ? 'border-[#16241D] bg-white shadow-sm'
                                    : 'border-[#E4EFE9] bg-white/85'
                                }`}
                              >
                                <div className="text-sm text-[#16241D]">
                                  {locationLabel}
                                </div>
                                {(result.roadAddress || result.jibunAddress) && (
                                  <div className="mt-1 text-xs text-[#6E7C75]">
                                    {result.roadAddress || result.jibunAddress}
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {newCoordinates && (
                        <div className="mt-3 rounded-xl border border-[#E4EFE9] bg-white px-3 py-2 text-xs text-[#16241D]">
	                          주소를 골랐어요: {getSafeLocationLabel(newLocation)}
                        </div>
                      )}

                      {locationError && (
                        <div className="mt-3 rounded-xl border border-[#ffd9cf] bg-[#E6F7F0] px-3 py-2 text-xs text-[#c15b3d]">
                          {locationError}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-[#E4EFE9] bg-[#F5F9F7] p-3">
                  <div className="mb-2 text-xs text-[#6E7C75]">이동수단</div>
                  <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#f7f3ed] p-1.5">
                    {travelModeOptions.map((option) => {
                      const active = newTravelMode === option.key;
                      const Icon = getTravelModeIcon(option.key);

                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setNewTravelMode(option.key)}
                          className={`flex h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition-all ${
                            active ? 'bg-[#16241D] text-white shadow-sm' : 'text-[#6E7C75]'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <select
                  value={newTravelTime}
                  onChange={() => undefined}
                  className="hidden h-12 w-full rounded-xl bg-[#F5F9F7] px-4 text-[#16241D] outline-none focus:ring-2 focus:ring-[#16241D]/20 sm:col-span-3"
                >
                  <option value={30}>최대 이동 30분</option>
                  <option value={40}>최대 이동 40분</option>
                  <option value={50}>최대 이동 50분</option>
                  <option value={60}>최대 이동 60분</option>
                </select>
              </div>

              {!isGuestMode && !isEditingSelfLocation && (
                <label className="mt-3 flex items-center gap-2 text-sm text-[#44505b]">
                  <input
                    type="checkbox"
                    checked={saveNewFriend}
                    onChange={(event) => setSaveNewFriend(event.target.checked)}
                    className="h-4 w-4 rounded border-[#cfd6df]"
                  />
	                  친구로 저장
                </label>
              )}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={handleAddParticipant}
                  className="h-11 rounded-2xl bg-[#16241D] px-5 text-white transition-transform active:scale-95 sm:min-w-[180px]"
                >
	                  {isEditingSelfLocation ? '적용' : '추가'}
                </button>

                <button
                  type="button"
                  onClick={resetParticipantDraft}
                  className="h-11 rounded-2xl bg-[#FFFFFF] px-5 text-[#6E7C75] transition-transform active:scale-95"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </section>

        {participants.length > 0 && (
          <section className="order-4 rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-[0_10px_30px_rgba(20,35,29,0.08)]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
	                <h3 className="text-base font-semibold text-[#16241D]">참여자</h3>
              </div>
              <span className="rounded-full bg-[#FFFFFF] px-3 py-1 text-xs text-[#44505b]">
                {participants.length}명
              </span>
            </div>

            <div className="kok-stagger-list max-h-64 space-y-2 overflow-y-auto pr-1">
              {participants.map((participant, index) => (
                <ParticipantCard
                  key={participant.id}
                  participant={participant}
                  onRemove={handleRemoveParticipant}
                  onSaveFriend={
                    isGuestMode || participant.savedFriendId === selfProfileParticipantKey
                      ? undefined
                      : handleSaveParticipantFriend
                  }
                  isSavedFriend={Boolean(
                    participant.savedFriendId && savedFriendIds.has(participant.savedFriendId),
                  )}
                  color={PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length]}
                />
              ))}
            </div>

            {selectedInsight ? (
              <div
                ref={routePanelRef}
                className="mt-3 rounded-[1.25rem] border border-[#E4EFE9] bg-[#F5F9F7] p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-[#16241D]">
                      <Route className="h-4 w-4 text-[#16241D]" />
                      {selectedInsight.candidate.name}까지
                    </div>
                    <div className="mt-1 text-xs text-[#9AA8A1]">
	                      이동수단 기준
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs text-[#44505b] shadow-sm">
                    {selectedRouteStatus === 'loading'
                      ? '계산 중'
                      : selectedRouteHasLiveData
                        ? '실경로'
                        : '예상'}
                  </span>
                </div>

                {participants.length > 1 && (
                  <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                    {participants.map((participant, index) => {
                      const routeKey = getRouteSelectionKey(
                        selectedInsight.candidate.id,
                        participant.id,
                      );
                      const active = participant.id === selectedRouteParticipantId;

                      return (
                        <button
                          key={routeKey}
                          type="button"
                          onClick={() => setExpandedRouteKey(routeKey)}
                          className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-semibold transition-transform active:scale-95 ${
                            active
                              ? 'bg-[#16241D] text-white shadow-sm'
                              : 'bg-white text-[#44505b] shadow-sm'
                          }`}
                        >
                          <span
                            className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full text-[10px] text-white"
                            style={{ backgroundColor: PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length] }}
                          >
                            {participant.avatarUrl ? (
                              <img
                                src={participant.avatarUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              participant.name.charAt(0)
                            )}
                          </span>
                          <span className="max-w-[90px] truncate">{participant.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedRouteParticipant ? (
                  <div className="rounded-xl bg-white p-3 text-left shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-xs text-white"
                            style={{ backgroundColor: selectedRouteColor }}
                          >
                            {selectedRouteParticipant.avatarUrl ? (
                              <img
                                src={selectedRouteParticipant.avatarUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              selectedRouteParticipant.name.charAt(0)
                            )}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[#16241D]">
                              {selectedRouteParticipant.name}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#6E7C75]">
                              <SelectedRouteTravelIcon className="h-3.5 w-3.5" />
                              {getTravelModeLabel(selectedRouteParticipant.travelMode)}
                              {selectedRouteDetail
                                ? ` · ${getRouteSourceLabel(selectedRouteDetail)}`
                                : ''}
                            </div>
                          </div>
                        </div>

                        {selectedRouteDetail ? (
                          <>
                            <div className="mt-3 text-sm text-[#44505b]">
                              {getRouteHeadline(selectedRouteDetail)}
                            </div>
                            <div className="mt-1 text-xs text-[#9AA8A1]">
                              {formatRouteFee(selectedRouteDetail)}
                            </div>
                          </>
                        ) : (
                          <div className="mt-3 flex items-center gap-2 text-xs text-[#9AA8A1]">
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            경로 계산 중
                          </div>
                        )}
                      </div>

                      {selectedRouteDetail ? (
                        <div className="shrink-0 text-right">
                          <div className="text-lg font-semibold text-[#16241D]">
                            {selectedRouteDetail.duration}분
                          </div>
                          <div className="text-xs text-[#9AA8A1]">
                            {getRouteDistanceLabel(selectedRouteDetail)}
                          </div>
                        </div>
                      ) : null}
                    </div>

	                    {selectedRouteDetail && showSelectedRouteSteps ? (
	                      <div className="mt-3 border-t border-[#eef2f6] pt-3">
                        {selectedRouteMeta ? (
                          <div className="mb-2 rounded-2xl bg-[#F5F9F7] px-3 py-2 text-xs text-[#6E7C75]">
                            {selectedRouteMeta}
                          </div>
                        ) : null}

                        {selectedRouteSteps.length ? (
                          <ol className="max-h-64 space-y-2 overflow-y-auto pr-1">
                            {selectedRouteSteps.map((step, stepIndex) => {
                              const stepDistance = formatRouteStepDistance(step.distance);
                              const stepMeta = [
                                step.duration ? `${step.duration}분` : null,
                                stepDistance,
                                step.stationCount ? `${step.stationCount}개 정류장` : null,
                              ].filter(Boolean);

                              return (
                                <li
                                  key={`${selectedRouteDetailKey}:step:${stepIndex}`}
                                  className="flex gap-2 rounded-2xl bg-[#F5F9F7] px-3 py-2"
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
                          <div className="rounded-2xl bg-[#F5F9F7] px-3 py-2 text-xs text-[#9AA8A1]">
                            {selectedRouteDetail.source === 'estimated'
                              ? selectedRouteDetail.mode === 'car'
	                                ? '자동차 예상이에요'
	                                : '대중교통 예상이에요'
	                              : '경로 요약이에요'}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedRouteError ? (
                  <div className="mt-3 rounded-2xl bg-[#E6F7F0] px-3 py-2 text-xs text-[#0CA178]">
                    {selectedRouteError}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
	        )}
	        </>
	        )}

	        {activePlannerPage === 'candidates' && (
	        <section className="order-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-[#16241D]">
                후보 상세보기
              </h3>
            </div>

	            <div className="flex shrink-0 items-center gap-2">
	              <span className="rounded-full bg-[#F5F9F7] px-3 py-1.5 text-xs font-bold text-[#6E7C75]">
	                {visibleCandidateInsights.length}곳
	              </span>
	              {excludedCandidateIds.length > 0 && (
	                <button
	                  type="button"
                  onClick={() => setExcludedCandidateIds([])}
                  className="h-10 rounded-full bg-white px-3 text-sm text-[#6E7C75] shadow-sm transition-transform active:scale-95"
                >
	                  되돌리기
	                </button>
	              )}
	            </div>
	          </div>

	            <div className="kok-stagger-list space-y-3">
              {visibleCandidateInsights.map((insight) => (
                  <CandidateCard
                    key={insight.candidate.id}
                    insight={insight}
                    selected={selectedInsight?.candidate.id === insight.candidate.id}
                    expanded={expandedCandidateId === insight.candidate.id}
                    onClick={() => handleCandidateCardSelect(insight.candidate.id)}
                    onExclude={() => handleExcludeCandidate(insight.candidate.id)}
                    nearbySections={
                      expandedCandidateId === insight.candidate.id &&
                      selectedInsight?.candidate.id === insight.candidate.id
                        ? nearbySections
                        : []
                    }
                    activeNearbyCategory={activeNearbyCategory}
                    onNearbyCategoryChange={setActiveNearbyCategory}
                    onNearbySearch={() => {
                      setSelectedCandidateId(insight.candidate.id);
                      setExpandedCandidateId(insight.candidate.id);
                      setNearbySearchCandidateId(insight.candidate.id);
                    }}
                    nearbyStatus={nearbyPlacesStatus}
                    nearbyMessage={nearbyPlacesMessage}
                    nearbyError={nearbyPlacesError}
                  />
              ))}

		              {!visibleCandidateInsights.length && (
		                <div className="rounded-2xl border border-dashed border-[#E4EFE9] bg-white/80 px-5 py-8 text-center text-sm text-[#6E7C75]">
			                  {excludedCandidateIds.length
				                    ? '남은 후보가 없어요'
				                    : fallbackNotice ??
				                      (isFairnessMode
				                        ? '조건에 맞는 후보가 없어요'
				                        : '후보가 없어요')}
		                </div>
		              )}
	            </div>

	        </section>
	        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/80 bg-white/88 px-4 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-18px_42px_rgba(20,35,29,0.12)] backdrop-blur-xl">
        <div className="mx-auto max-w-[1040px]">
	          <div className="mb-2 flex items-center justify-between gap-3 px-1">
	            <div className="min-w-0">
	              <div className="truncate text-sm font-black text-[#16241D]">{plannerStageTitle}</div>
	            </div>
            {onlineRoom ? (
              <span className="shrink-0 rounded-full bg-[#E6F7F0] px-3 py-1 text-xs font-extrabold text-[#0CA178]">
                {readyCount}/{Math.max(readyRequiredCount, 0)}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => {
              if (onlineRoom) {
                void handleReadyToggle();
                return;
              }

              openDrawDrawer();
            }}
            disabled={onlineRoom ? readyButtonDisabled : Boolean(drawDisabledReason)}
            className={`kok-pressable flex h-16 w-full items-center justify-center gap-2 rounded-[1.35rem] text-lg font-black tracking-normal text-white shadow-[0_12px_30px_rgba(20,35,29,0.14)] disabled:cursor-not-allowed disabled:opacity-50 ${
              onlineRoom && isCurrentActorReady ? 'bg-[#22c55e]' : 'bg-[#16241D]'
            }`}
          >
            {sharedCandidateStatus === 'loading' || fairnessVerificationPending || isSettingReady ? (
              <LoaderCircle className="h-5 w-5 animate-spin" />
            ) : onlineRoom ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Shuffle className="h-5 w-5" />
            )}
            {onlineRoom
              ? onlineReadyButtonLabel
              : sharedCandidateStatus === 'loading'
	                ? '후보 찾는 중이에요'
	                : fairnessVerificationPending
	                  ? '시간 확인 중이에요'
	                : '추첨 시작'}
          </button>
        </div>
      </div>

      {showOptionsPage && (
        <div className="kok-sheet-enter fixed inset-0 z-50 overflow-y-auto bg-[#f8fbf7] text-[#16241D]">
          <div className="sticky top-0 z-10 border-b border-[#e6ebf0] bg-[#f8fbf7]/94 px-4 py-3 backdrop-blur-xl">
            <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowOptionsPage(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#16241D] shadow-sm transition-transform active:scale-95"
                aria-label="옵션 화면 닫기"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
	              <div className="min-w-0 text-center">
	                <div className="text-base font-semibold text-[#16241D]">옵션</div>
	              </div>
              <button
                type="button"
                onClick={() => setShowOptionsPage(false)}
                className="h-10 rounded-full bg-[#16241D] px-4 text-sm text-white shadow-sm transition-transform active:scale-95"
              >
                적용
              </button>
            </div>
          </div>

          <main className="kok-stagger-list mx-auto flex max-w-[720px] flex-col gap-4 px-4 py-5">
            <section className="rounded-[1.75rem] border border-white/80 bg-white/95 p-4 shadow-[0_10px_30px_rgba(20,35,29,0.06)]">
              <div className="mb-3 text-sm font-semibold text-[#16241D]">모임 종류</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {meetCategories.map((category) => {
                  const active = category.key === selectedCategory;

                  return (
                    <button
                      key={category.key}
                      type="button"
                      onClick={() => handleCategorySelect(category.key)}
                      className={`min-h-12 rounded-2xl px-3 text-sm font-semibold transition-all active:scale-[0.99] ${
                        active
                          ? 'bg-[#12B886] text-white shadow-sm'
                          : 'bg-[#f2f7f2] text-[#52615f]'
                      }`}
                    >
                      {category.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-white/80 bg-white/95 p-4 shadow-[0_10px_30px_rgba(20,35,29,0.06)]">
              <div className="mb-3 text-sm font-semibold text-[#16241D]">선택 방식</div>
              <div className="space-y-2">
                {selectionModes.map((mode) => {
                  const active = mode.key === selectionMode;

                  return (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => handleSelectionModeSelect(mode.key)}
                      className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border px-4 text-left transition-all active:scale-[0.99] ${
                        active
                          ? 'border-[#16241D] bg-[#16241D] text-white shadow-sm'
                          : 'border-[#e6ebf0] bg-white text-[#52615f]'
                      }`}
                    >
                      <span className="text-sm font-semibold">{mode.shortLabel}</span>
                      <span
                        className={`h-3 w-3 rounded-full ${
                          active ? 'bg-[#12B886]' : 'bg-[#dfe7e5]'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </section>

            {isFairnessMode && (
              <section className="rounded-[1.75rem] border border-white/80 bg-white/95 p-4 shadow-[0_10px_30px_rgba(20,35,29,0.06)]">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-[#16241D]">이동시간 공정도</div>
                  <div className="text-xs text-[#6f7b79]">{activeModeDetailLabel}</div>
                </div>
                <div className="grid grid-cols-5 gap-1.5 rounded-2xl bg-[#f2f7f2] p-1.5">
                  {visibleThrillStages.map((stage) => {
                    const active = stage.level === effectiveThrillLevel;

                    return (
                      <button
                        key={stage.level}
                        type="button"
                        onClick={() => handleThrillLevelSelect(stage.level)}
                        className={`h-10 rounded-xl text-sm font-semibold transition-all ${
                          active
                            ? 'bg-[#12B886] text-white shadow-sm'
                            : 'text-[#52615f]'
                        }`}
                      >
                        {thrillButtonLabels[stage.level]}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {!runtimeCapabilities.ai.connected && (
              <section className="rounded-[1.75rem] border border-white/80 bg-white/95 p-4 shadow-[0_10px_30px_rgba(20,35,29,0.06)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-[#16241D]">
                    <Bot className="h-4 w-4 shrink-0 text-[#33415f]" />
                    <span className="truncate text-sm font-semibold">
                      {runtimeAiConfig ? 'AI 연결됨' : 'AI 연결'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsAiConfigOpen(true)}
                    className="inline-flex h-10 items-center justify-center rounded-full bg-[#f2f7f2] px-4 text-sm text-[#16241D] shadow-sm transition-transform active:scale-95"
                  >
                    연결
                  </button>
                </div>
              </section>
            )}
          </main>
        </div>
      )}

      {showDrawer && (
        <RandomDrawer
          key={activeDrawSession.seed ?? 'manual-draw'}
          candidateInsights={activeDrawSession.candidateInsights}
          categoryLabel={activeCategory.label}
          modeLabel={
            isFairnessMode
              ? `${activeMode.shortLabel} · ${activeThrill.shortLabel}`
              : activeMode.shortLabel
          }
          selectionMode={selectionMode}
          thrillLevel={effectiveThrillLevel}
          candidateScope={candidateScope}
          participants={activeDrawSession.participants}
          drawSeed={activeDrawSession.seed}
          canChoose={isCurrentDrawController}
          autoChoose={false}
          sharedSelectedSlotIndex={sharedSelectedSlotIndex}
          sharedChoicePlayAt={sharedChoicePlayAt}
          initialLadderBars={activeDrawSession.ladderBars ?? null}
          waitingMessage={
            onlineRoom && !isCurrentDrawController
	              ? `${activeDrawControllerName}님 진행 중`
              : undefined
          }
          onChoice={handleDrawChoice}
          onLadderBarsChange={handleDrawLadderBarsChange}
          onComplete={handleDrawComplete}
          onClose={closeDrawDrawer}
        />
      )}

      {!runtimeCapabilities.ai.connected && (
        <AiConfigSheet
          open={isAiConfigOpen}
          initialConfig={runtimeAiConfig}
          onClose={() => setIsAiConfigOpen(false)}
          onSave={handleSaveAiConfig}
          onClear={handleClearAiConfig}
        />
      )}
    </div>
  );
}
