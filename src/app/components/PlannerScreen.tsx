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

const PARTICIPANT_COLORS = ['#ff7b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#f59e0b', '#ec4899'];

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
    return route.mode === 'car' ? '실제 자동차 경로 확인 필요' : '실제 대중교통 경로 확인 필요';
  }

  return route.mode === 'car' ? '자동차 경로' : '대중교통 경로';
}

function getRouteDistanceLabel(route: TravelInfo) {
  return route.source === 'estimated' ? '실경로 확인 전' : `${route.distance}km`;
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

function getLocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return '브라우저 위치 권한이 꺼져 있어요. 권한을 허용해 주세요.';
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return '현재 위치를 찾지 못했어요. 잠시 후 다시 시도해 주세요.';
  }

  return '위치를 가져오는 데 시간이 걸렸어요. 다시 눌러 주세요.';
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
    return '방 정보를 다시 맞추는 중이에요. 잠시 후 다시 시도해 주세요.';
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
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [showCandidateList, setShowCandidateList] = useState(false);
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
  const [expandedRouteKey, setExpandedRouteKey] = useState<string | null>(null);
  const [excludedCandidateIds, setExcludedCandidateIds] = useState<string[]>([]);
  const [activeNearbyCategory, setActiveNearbyCategory] = useState<NearbyPlaceCategory>(
    getDefaultNearbyCategory(selectedCategory),
  );
  const [isLocating, setIsLocating] = useState(false);
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
      ? '핫플 후보 다양화'
      : '집앞 후보 다양화';
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
    ? '온라인 방에서는 모두 같은 후보판으로 동기화해요.'
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
    ? '먼저 참여자를 2명 이상 입력해 주세요.'
    : sharedCandidateStatus === 'loading'
      ? 'AI가 후보를 정리하는 중이에요.'
      : fairnessVerificationPending
        ? '실제 이동시간으로 공정도를 다시 확인 중이에요.'
        : !drawPool.length
          ? fallbackNotice ?? '추첨 가능한 후보가 아직 없어요.'
          : null;
  const onlineReadyBlockedReason =
    onlineRoom && !currentReadyActorId
      ? '레디 전에 내 위치를 먼저 방에 추가해 주세요.'
      : drawBlockedReason;
  const drawDisabledReason = onlineRoom ? onlineReadyBlockedReason : drawBlockedReason;
  const readyButtonDisabled = Boolean(
    isSettingReady || (onlineReadyBlockedReason && !isCurrentActorReady),
  );
  const readyStatusText = onlineRoom
    ? onlineReadyBlockedReason
      ? onlineReadyBlockedReason
      : isOnlineReadyComplete
        ? '모두 레디 완료. 진행자가 게임을 시작해요.'
        : isCurrentActorReady
          ? `레디 완료 ${readyCount}/${readyRequiredCount}. 다른 참여자를 기다리는 중이에요.`
          : `${readyRequiredCount}명 모두 레디하면 추첨 게임이 열려요.`
    : drawBlockedReason ??
      (isFairnessMode
        ? `이동시간 차이 ${activeSpreadLimit}분 이하 기준으로 고른 ${drawPool.length}개의 후보 안에서 마지막 랜덤을 돌립니다.`
        : `${activeMode.shortLabel} 후보 ${drawPool.length}개 안에서 마지막 랜덤을 돌립니다.`);
  const onlineReadyButtonLabel = onlineRoom
    ? isSettingReady
      ? '레디 반영 중'
      : !currentReadyActorId
        ? '내 위치 추가 필요'
        : participants.length < 2
          ? '참여자 2명 필요'
          : sharedCandidateStatus === 'loading'
            ? 'AI 후보 정리 중'
            : fairnessVerificationPending
              ? '실제 이동시간 확인 중'
              : !drawPool.length
                ? '기준 후보 없음'
                : isOnlineReadyComplete
                  ? `모두 레디 ${readyCount}/${readyRequiredCount}`
                  : isCurrentActorReady
                    ? `레디 완료 ${readyCount}/${readyRequiredCount}`
                    : `레디 ${readyCount}/${readyRequiredCount}`
    : null;
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
      setRoomMessage(error instanceof Error ? error.message : '추첨 준비 중 방 상태를 다시 확인하지 못했어요.');
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
    setActiveNearbyCategory(getDefaultNearbyCategory(selectedCategory));
  }, [selectedCategory, selectedCandidateId]);

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
  const isSelfProfileAdded = Boolean(
    currentUserHomeLocation &&
      (selfProfileParticipant ||
        participants.some(
          (participant) =>
            participant.createdBy === currentUserId &&
            participant.name === currentUserName &&
            participant.location === currentUserHomeLocation.location,
        )),
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

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedRoomLink(true);
      window.setTimeout(() => setCopiedRoomLink(false), 1600);
    } catch {
      setRoomMessage(shareUrl);
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
  };

  const handleAddressSearch = async () => {
    const query = addressQuery.trim();

    if (!query) {
      setLocationError('검색할 주소를 먼저 입력해 주세요.');
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
            : '검색 결과가 없어요. 도로명이나 건물명으로 다시 검색해 주세요.',
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
      setLocationError(error instanceof Error ? error.message : '주소 검색 중 오류가 발생했어요.');
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
      setLocationError('이 브라우저에서는 현재 위치 기능을 지원하지 않아요.');
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
      setLocationError(error instanceof Error ? error.message : '선택한 위치 주소를 찾지 못했어요.');
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

  const handleQuickAddSelfProfile = () => {
    if (!currentUserId || !currentUserHomeLocation) {
      onOpenProfile?.();
      return;
    }

    if (isSelfProfileAdded) {
      return;
    }

    if (
      !isSupportedServiceAreaLocation({
        location: currentUserHomeLocation.location,
        coordinates: currentUserHomeLocation.coordinates,
      })
    ) {
      setRoomMessage(SERVICE_AREA_UNSUPPORTED_MESSAGE);
      return;
    }

    const nextParticipant: Participant = {
      id: `participant-self-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: currentUserName,
      avatarUrl: currentUserAvatarUrl,
      location: currentUserHomeLocation.location,
      coordinates: currentUserHomeLocation.coordinates,
      maxTravelTime: DEFAULT_MAX_TRAVEL_TIME,
      travelMode: 'transit',
      gender: currentUserGender,
      locationSource: currentUserHomeLocation.locationSource ?? 'address',
      savedFriendId: selfProfileParticipantKey,
      createdBy: currentUserId,
    };

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
    handleQuickAddSelfProfile();
  }, [
    currentUserHomeLocation,
    currentUserId,
    handleQuickAddSelfProfile,
    isSelfProfileAdded,
    onlineRoom?.id,
  ]);

  const handleEditSelfLocationForThisRoom = () => {
    if (!currentUserId || !currentUserHomeLocation) {
      onOpenProfile?.();
      return;
    }

    const targetParticipant =
      selfProfileParticipant ??
      participants.find(
        (participant) =>
          participant.createdBy === currentUserId &&
          participant.name === currentUserName &&
          participant.location === currentUserHomeLocation.location,
      ) ??
      null;
    const draftLocation = targetParticipant?.location ?? currentUserHomeLocation.location;
    const draftCoordinates = targetParticipant?.coordinates ?? currentUserHomeLocation.coordinates;

    setEditingSelfParticipantId(
      targetParticipant?.id ??
        `participant-self-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    setNewName(currentUserName);
    setNewGender(currentUserGender);
    setNewTravelMode(targetParticipant?.travelMode ?? 'transit');
    setLocationMode('address');
    setAddressQuery(draftLocation);
    setAddressResults([]);
    setNewLocation(draftLocation);
    setNewCoordinates(draftCoordinates);
    setLocationError(null);
    setSaveNewFriend(false);
    setShowAddForm(true);

    window.requestAnimationFrame(() => {
      participantSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

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
      setLocationError('위치를 먼저 선택해 주세요.');
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

  const handleExcludeCandidate = (candidateId: string) => {
    setExcludedCandidateIds((current) =>
      current.includes(candidateId) ? current : [...current, candidateId],
    );

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
      setRoomMessage('레디 전에 내 위치를 먼저 방에 추가해 주세요.');
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
      setRoomMessage(error instanceof Error ? error.message : '레디 상태를 반영하지 못했어요.');
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
          setRoomMessage(error instanceof Error ? error.message : '결과를 방에 저장하지 못했어요.');
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
      ? 'AI가 후보 지역을 정리 중이에요.'
      : sharedCandidateError
        ? sharedCandidateError
        : fairnessVerificationMessage
          ? fairnessVerificationMessage
        : sharedCandidateMessage
          ? sharedCandidateMessage
          : fallbackNotice ?? `공통 범위 안에서 바로 추첨 가능한 후보 ${drawPool.length}곳을 골라뒀어요.`;
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
        setRoomMessage('사다리 추가 동기화가 잠시 지연되고 있어요. 선택 시 최종 사다리는 다시 공유됩니다.');
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
        setRoomMessage('게임 진행 동기화가 잠시 지연되고 있어요. 결과는 방에 저장됩니다.');
      });
  };

  return (
    <div className="min-h-screen bg-[#f5f1eb] pb-32 text-[#1f2a44]">
      <div className="sticky top-0 z-20 flex items-center justify-between rounded-b-[2rem] bg-[#f5f1eb]/88 px-5 py-4 shadow-[0_10px_30px_rgba(26,26,46,0.08)] backdrop-blur-md">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-[#1f2a44] shadow-sm transition-transform active:scale-95"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h2 className="absolute left-1/2 -translate-x-1/2 text-xl font-black tracking-[-0.05em] text-[#1f2a44]">
          KoK
        </h2>
        {onOpenProfile ? (
          <button
            type="button"
            onClick={onOpenProfile}
            className="inline-flex h-10 max-w-[132px] items-center gap-1.5 rounded-full bg-white px-3 text-sm text-[#1f2a44] shadow-sm transition-transform active:scale-95"
            aria-label="프로필 설정"
          >
            {currentUserAvatarUrl ? (
              <img
                src={currentUserAvatarUrl}
                alt=""
                className="h-5 w-5 shrink-0 rounded-full object-cover"
              />
            ) : (
              <UserRound className="h-4 w-4 shrink-0 text-[#6b7280]" />
            )}
            <span className="truncate">{currentUserName}</span>
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      <div className="mx-auto flex max-w-[1040px] flex-col gap-4 px-4 py-5 sm:gap-5 sm:py-6">
        {onlineRoom && (
          <section className="rounded-[1.75rem] border border-white/70 bg-white/92 px-4 py-3 shadow-[0_10px_30px_rgba(26,26,46,0.08)] backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#1f2a44]">
                  <Wifi className="h-4 w-4 shrink-0 text-[#22c55e]" />
                  <span className="shrink-0">방 코드</span>
                  <span className="rounded-full bg-[#f5f1eb] px-2.5 py-1 text-xs text-[#45464d]">
                    {onlineRoom.code}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[#8a94a2]">
                  {participants.length}명 참여 · 레디 {readyCount}/{Math.max(readyRequiredCount, 0)}
                  {isOnlineReadyComplete && activeDrawControllerId
                    ? ` · 진행자 ${activeDrawControllerName}`
                    : ''}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyRoomLink}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[#1f2a44] px-4 text-sm text-white shadow-sm transition-transform active:scale-95"
              >
                <Copy className="h-4 w-4" />
                {copiedRoomLink ? '복사됨' : '공유'}
              </button>
            </div>

            {(displayRoomMessage || roomSyncStatus === 'error') && (
              <div className="mt-3 rounded-xl bg-[#fff8e8] px-3 py-2 text-xs text-[#8a621c]">
                {displayRoomMessage || '방 동기화를 확인해 주세요.'}
              </div>
            )}
          </section>
        )}

        <section className="order-1 space-y-3">
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

        <div className="order-3 flex flex-col gap-3 rounded-[1.75rem] border border-white/70 bg-white/92 px-4 py-3 shadow-[0_10px_30px_rgba(26,26,46,0.06)] backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#ff7b6b]" />
            <span className="rounded-full bg-[#fff2ee] px-3 py-1 text-xs font-semibold text-[#ff7b6b]">
              {activeCategory.label}
            </span>
            <span className="rounded-full bg-[#f5f1eb] px-3 py-1 text-xs font-semibold text-[#1f2a44]">
              {activeMode.shortLabel}
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs text-[#1a1a2e] shadow-sm">
              {activeModeDetailLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedOptions((current) => !current)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm text-[#1a1a2e] shadow-sm transition-transform active:scale-95 sm:self-auto"
          >
            <Settings2 className="h-4 w-4" />
            {showAdvancedOptions ? '옵션 숨기기' : '옵션 보기'}
          </button>
        </div>

        {showAdvancedOptions && (
          <div className="order-3 space-y-3 rounded-[1.5rem] border border-white/70 bg-white/95 p-4 shadow-[0_10px_30px_rgba(26,26,46,0.08)]">
            <section className="space-y-2">
              <div className="text-xs font-semibold text-[#8a94a2]">모임</div>
              <div className="flex flex-wrap gap-2">
                {meetCategories.map((category) => {
                  const active = category.key === selectedCategory;

                  return (
                    <button
                      key={category.key}
                      type="button"
                      onClick={() => handleCategorySelect(category.key)}
                      className={`h-9 rounded-full px-3.5 text-sm transition-all ${
                        active
                          ? 'bg-[#ff7b6b] text-white shadow-sm'
                          : 'bg-[#f5f1eb] text-[#44505b]'
                      }`}
                    >
                      {category.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <div className="text-xs font-semibold text-[#8a94a2]">방식</div>
              <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-[#f5f1eb] p-1.5">
                {selectionModes.map((mode) => {
                  const active = mode.key === selectionMode;

                  return (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => handleSelectionModeSelect(mode.key)}
                      className={`min-h-10 rounded-xl px-2 py-2 text-[13px] leading-tight break-keep transition-all sm:text-sm ${
                        active
                          ? 'bg-[#1f2a44] text-white shadow-sm'
                          : 'text-[#44505b]'
                      }`}
                    >
                      {mode.shortLabel}
                    </button>
                  );
                })}
              </div>
            </section>

            {isFairnessMode && (
		            <section className="rounded-2xl bg-[#faf7f2] p-3">
		              <div className="mb-2 flex items-center justify-between gap-2">
		                <div className="text-xs font-semibold text-[#8a94a2]">이동시간 공정도</div>
		                <div className="text-xs text-[#8a94a2]">
		                  {activeModeDetailLabel}
		                </div>
		              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {visibleThrillStages.map((stage) => {
                  const active = stage.level === effectiveThrillLevel;

                  return (
                    <button
                      key={stage.level}
                      type="button"
                      onClick={() => handleThrillLevelSelect(stage.level)}
                      className={`h-9 rounded-full text-sm transition-all ${
                        active
                          ? 'bg-[#ff7b6b] text-white shadow-sm'
                          : 'bg-white text-[#44505b]'
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
              <div className="rounded-2xl border border-[#e6ebf0] bg-white px-3 py-2.5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-[#1a1a2e]">
                    <Bot className="h-4 w-4 shrink-0 text-[#2d3561]" />
                    <span className="truncate text-sm">
                      {runtimeAiConfig ? 'AI 연결됨' : 'AI 연결'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsAiConfigOpen(true)}
                    className="inline-flex h-8 items-center justify-center rounded-full bg-[#f5f1eb] px-3 text-xs text-[#1a1a2e] shadow-sm transition-transform active:scale-95"
                  >
                    연결
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-medium shadow-sm transition-all active:scale-95 ${
                  showAddForm
                    ? 'border-[#1f2a44] bg-[#1f2a44] text-white'
                    : 'border-[#dfe5eb] bg-white text-[#2d3561] hover:bg-[#f8fbfd]'
                }`}
              >
                <Plus className={`h-4 w-4 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
                {showAddForm ? '닫기' : '수동 추가'}
              </button>
            </div>
          )}

          {currentUserId && (
            <div className="mb-3 flex flex-col gap-3 rounded-[1.75rem] border border-white/70 bg-white/95 p-4 shadow-[0_10px_30px_rgba(26,26,46,0.06)] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f5f1eb] text-[#2d3561]">
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
                  <div className="text-sm font-medium text-[#1a1a2e]">내 정보</div>
                  <div className="mt-1 truncate text-sm text-[#6b7280]">
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
                      : '기본 출발지를 저장하면 바로 추가할 수 있어요.'}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={handleQuickAddSelfProfile}
                  disabled={Boolean(currentUserHomeLocation && isSelfProfileAdded)}
                  className="h-10 rounded-full bg-[#1f2a44] px-4 text-sm text-white shadow-sm transition-transform active:scale-95 disabled:opacity-55"
                >
                  {currentUserHomeLocation
                    ? isSelfProfileAdded
                      ? '추가됨'
                      : '내 위치 추가'
                    : '내 정보 저장'}
                </button>
                <button
                  type="button"
                  onClick={
                    currentUserHomeLocation
                      ? handleEditSelfLocationForThisRoom
                      : onOpenProfile
                  }
                  className="h-10 rounded-full bg-[#f5f1eb] px-4 text-sm text-[#44505b] transition-transform active:scale-95"
                >
                  {currentUserHomeLocation ? '이번 위치 수정' : '수정'}
                </button>
              </div>
            </div>
          )}

          {!isGuestMode && savedFriends.length > 0 && (
            <div className="mb-3 rounded-[1.75rem] border border-white/70 bg-white/95 p-3 shadow-[0_10px_30px_rgba(26,26,46,0.06)]">
              <div className="mb-2 flex items-center justify-between gap-2 text-[#1a1a2e]">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-[#2d3561]" />
                  <span className="text-sm">저장된 친구</span>
                </div>
                <span className="text-xs text-[#8a94a2]">눌러서 추가</span>
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
                          ? 'border-[#e8edf3] bg-[#f5f1eb] text-[#9ca3af]'
                          : 'border-[#dfe7ef] bg-[#f8fbfd] text-[#1a1a2e] hover:border-[#2d3561]/30 hover:bg-white'
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
                            alreadyAdded ? 'bg-white text-[#9ca3af]' : 'bg-[#1f2a44] text-white'
                          }`}
                        >
                          {alreadyAdded ? '✓' : '+'}
                        </span>
                        <span className="min-w-0 truncate">{friend.name}</span>
                        <span className="hidden max-w-28 truncate text-xs text-[#8a94a2] sm:inline">
                          {getSafeLocationLabel(friend.location)}
                        </span>
                        {friend.gender && friend.gender !== 'unspecified' && (
                          <span className="inline-flex shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-[#6b7280]">
                            {getParticipantGenderLabel(friend.gender)}
                          </span>
                        )}
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-[#6b7280]">
                          <TravelIcon className="h-3 w-3" />
                          {getTravelModeLabel(friend.travelMode)}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteSavedFriend(friend.id)}
                        className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#9ca3af] transition-colors hover:bg-[#ffdad6] hover:text-[#ba1a1a]"
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
            <div className="mb-3 flex flex-col gap-4 rounded-[1.75rem] border border-dashed border-[#dfe7ef] bg-white/78 p-5 text-center shadow-[0_10px_30px_rgba(26,26,46,0.04)] sm:flex-row sm:items-center sm:justify-between sm:text-left">
              <div className="flex min-w-0 flex-col items-center gap-3 sm:flex-row">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f5f1eb] text-[#2d3561]">
                  {onlineRoom ? <Wifi className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#1a1a2e]">
                    {onlineRoom ? '온라인 참여를 기다리는 중' : '참여자가 아직 없어요'}
                  </div>
                  <div className="mt-1 text-sm leading-relaxed text-[#6b7280]">
                    직접 입력이 필요하면 수동 추가를 열어 주세요.
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#1f2a44] px-4 text-sm font-medium text-white shadow-sm transition-transform active:scale-95"
              >
                <Plus className="h-4 w-4" />
                수동 추가
              </button>
            </div>
          )}

          {showAddForm && (
            <div className="mb-3 rounded-[2rem] border border-white/70 bg-white/95 p-5 shadow-[0_10px_30px_rgba(26,26,46,0.08)]">
              <BookmarkPlus className="mb-4 h-4 w-4 text-[#2d3561]" />

              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="이름"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-[#edf1f4] bg-[#fbfaf8] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:border-[#d8e0ea] focus:ring-2 focus:ring-[#2d3561]/10"
                />

                <div className="rounded-2xl border border-[#e8edf3] bg-[#f8fbfd] p-3">
                  <div className="mb-2 text-xs text-[#6b7280]">성별</div>
                  <div className="flex flex-wrap gap-2">
                    {participantGenderOptions.map((option) => {
                      const active = newGender === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setNewGender(option.value)}
                          className={`rounded-full px-3 py-1.5 text-xs transition-all ${
                            active ? 'bg-[#1f2a44] text-white shadow-sm' : 'bg-white text-[#44505b]'
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
                          ? 'bg-[#1f2a44] text-white shadow-sm'
                          : 'text-[#6b7280]'
                      }`}
                    >
                      주소 검색
                    </button>

                    <button
                      type="button"
                      onClick={() => handleLocationModeChange('current')}
                      className={`h-11 rounded-xl px-3 text-sm font-medium transition-all ${
                        locationMode === 'current'
                          ? 'bg-[#1f2a44] text-white shadow-sm'
                          : 'text-[#6b7280]'
                      }`}
                    >
                      현재 위치
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLocationModeChange('map')}
                      className={`h-11 rounded-xl px-3 text-sm font-medium transition-all ${
                        locationMode === 'map'
                          ? 'bg-[#1f2a44] text-white shadow-sm'
                          : 'text-[#6b7280]'
                      }`}
                    >
                      지도에서 찍기
                    </button>
                  </div>

                  {locationMode === 'current' ? (
                    <div className="rounded-2xl border border-[#e8edf3] bg-[#f8fbfd] p-4">
                      <button
                        type="button"
                        onClick={handleUseCurrentLocation}
                        disabled={isLocating}
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#eef4ff] text-[#2d5aa7] transition-transform active:scale-95 disabled:opacity-60"
                      >
                        {isLocating ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <LocateFixed className="h-4 w-4" />
                        )}
                        {isLocating ? '현재 위치 찾는 중' : '현재 위치 가져오기'}
                      </button>

                      <div className="mt-3 text-xs leading-relaxed text-[#6b7280]">
                        브라우저 위치 권한을 허용하면 출발지를 바로 반영할 수 있어요.
                      </div>

                      {newCoordinates && (
                        <div className="mt-3 rounded-xl border border-[#e8edf3] bg-white px-3 py-2 text-xs text-[#1a1a2e]">
                          현재 위치가 들어왔어요.
                        </div>
                      )}

                      {locationError && (
                        <div className="mt-3 rounded-xl border border-[#ffd9cf] bg-[#fff5f2] px-3 py-2 text-xs text-[#c15b3d]">
                          {locationError}
                        </div>
                      )}
                    </div>
                  ) : locationMode === 'map' ? (
                    <div className="rounded-2xl border border-[#e8edf3] bg-[#f8fbfd] p-4">
                      <div className="rounded-2xl bg-white px-4 py-4">
                        <div className="text-sm text-[#1a1a2e]">
                          지도에서 우클릭하거나 길게 눌러 출발지를 찍어주세요.
                        </div>
                        <div className="mt-2 text-xs leading-relaxed text-[#6b7280]">
                          지도에서 고른 곳이 바로 이 사람 위치로 들어갑니다.
                        </div>
                      </div>

                      {newCoordinates && (
                        <div className="mt-3 rounded-xl border border-[#e8edf3] bg-white px-3 py-2 text-xs text-[#1a1a2e]">
                          {newLocation
                            ? getSafeLocationLabel(newLocation)
                            : '선택한 위치가 들어왔어요.'}
                        </div>
                      )}

                      {locationError && (
                        <div className="mt-3 rounded-xl border border-[#ffd9cf] bg-[#fff5f2] px-3 py-2 text-xs text-[#c15b3d]">
                          {locationError}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-[#e8edf3] bg-[#f8fbfd] p-2">
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
                          className="h-11 min-w-0 flex-1 rounded-lg border-0 bg-transparent px-3 text-sm text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:ring-0"
                        />

                        <button
                          type="button"
                          onClick={() => {
                            void handleAddressSearch();
                          }}
                          disabled={isSearchingAddress}
                          className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#eef4ff] px-4 text-sm font-medium text-[#2d5aa7] transition-transform active:scale-95 disabled:opacity-60"
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
                                    ? 'border-[#2d3561] bg-white shadow-sm'
                                    : 'border-[#e8edf3] bg-white/85'
                                }`}
                              >
                                <div className="text-sm text-[#1a1a2e]">
                                  {locationLabel}
                                </div>
                                {(result.roadAddress || result.jibunAddress) && (
                                  <div className="mt-1 text-xs text-[#6b7280]">
                                    {result.roadAddress || result.jibunAddress}
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {newCoordinates && (
                        <div className="mt-3 rounded-xl border border-[#e8edf3] bg-white px-3 py-2 text-xs text-[#1a1a2e]">
                          선택한 주소가 들어왔어요: {getSafeLocationLabel(newLocation)}
                        </div>
                      )}

                      {locationError && (
                        <div className="mt-3 rounded-xl border border-[#ffd9cf] bg-[#fff5f2] px-3 py-2 text-xs text-[#c15b3d]">
                          {locationError}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-[#e8edf3] bg-[#f8fbfd] p-3">
                  <div className="mb-2 text-xs text-[#6b7280]">이동수단</div>
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
                            active ? 'bg-[#1f2a44] text-white shadow-sm' : 'text-[#6b7280]'
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
                  className="hidden h-12 w-full rounded-xl bg-[#f9f7f4] px-4 text-[#1a1a2e] outline-none focus:ring-2 focus:ring-[#2d3561]/20 sm:col-span-3"
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
                  다음에도 쓰게 친구로 저장
                </label>
              )}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={handleAddParticipant}
                  className="h-11 rounded-2xl bg-[#2d3561] px-5 text-white transition-transform active:scale-95 sm:min-w-[180px]"
                >
                  {isEditingSelfLocation ? '이번 위치 적용' : '참여자 추가'}
                </button>

                <button
                  type="button"
                  onClick={resetParticipantDraft}
                  className="h-11 rounded-2xl bg-[#f5f1eb] px-5 text-[#6b7280] transition-transform active:scale-95"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </section>

        {participants.length > 0 && (
          <section className="order-4 rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-[0_10px_30px_rgba(26,26,46,0.08)]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#1f2a44]">참여자 목록</h3>
                <p className="text-xs text-[#76777e]">원하지 않는 사람은 바로 뺄 수 있어요.</p>
              </div>
              <span className="rounded-full bg-[#f5f1eb] px-3 py-1 text-xs text-[#44505b]">
                {participants.length}명
              </span>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
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
                className="mt-3 rounded-[1.25rem] border border-[#e8edf3] bg-[#f8fbfd] p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-[#1a1a2e]">
                      <Route className="h-4 w-4 text-[#2d3561]" />
                      {selectedInsight.candidate.name}까지
                    </div>
                    <div className="mt-1 text-xs text-[#8a94a2]">
                      참여자별 선택 이동수단으로 계산
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
                              ? 'bg-[#1f2a44] text-white shadow-sm'
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
                            <div className="truncate text-sm font-semibold text-[#1a1a2e]">
                              {selectedRouteParticipant.name}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#6b7280]">
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
                            <div className="mt-1 text-xs text-[#8a94a2]">
                              {formatRouteFee(selectedRouteDetail)}
                            </div>
                          </>
                        ) : (
                          <div className="mt-3 flex items-center gap-2 text-xs text-[#8a94a2]">
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            경로 계산 중
                          </div>
                        )}
                      </div>

                      {selectedRouteDetail ? (
                        <div className="shrink-0 text-right">
                          <div className="text-lg font-semibold text-[#1a1a2e]">
                            {selectedRouteDetail.duration}분
                          </div>
                          <div className="text-xs text-[#8a94a2]">
                            {getRouteDistanceLabel(selectedRouteDetail)}
                          </div>
                        </div>
                      ) : null}
                    </div>

	                    {selectedRouteDetail && showSelectedRouteSteps ? (
	                      <div className="mt-3 border-t border-[#eef2f6] pt-3">
                        {selectedRouteMeta ? (
                          <div className="mb-2 rounded-2xl bg-[#f8fbfd] px-3 py-2 text-xs text-[#6b7280]">
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
                                  className="flex gap-2 rounded-2xl bg-[#fbf8fb] px-3 py-2"
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
                          <div className="rounded-2xl bg-[#fbf8fd] px-3 py-2 text-xs text-[#8a94a2]">
                            {selectedRouteDetail.source === 'estimated'
                              ? selectedRouteDetail.mode === 'car'
                                ? '자동차 상세 경로를 받지 못해 임시 예상 시간만 표시 중이에요.'
                                : '대중교통 상세 경로를 받지 못해 임시 예상 시간만 표시 중이에요.'
                              : '실시간 경로는 받았지만 단계 안내가 비어 있어 요약만 표시 중이에요.'}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedRouteError ? (
                  <div className="mt-3 rounded-2xl bg-[#fff7ed] px-3 py-2 text-xs text-[#b45309]">
                    {selectedRouteError}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        )}

        <section className="order-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-[#1f2a44]">
                후보 {visibleCandidateInsights.length}곳
              </h3>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {excludedCandidateIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExcludedCandidateIds([])}
                  className="h-10 rounded-full bg-white px-3 text-sm text-[#6b7280] shadow-sm transition-transform active:scale-95"
                >
                  되돌리기
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCandidateList((current) => !current)}
                className="h-10 rounded-full bg-white px-4 text-sm text-[#1f2a44] shadow-sm transition-transform active:scale-95"
              >
                {showCandidateList ? '접기' : '보기'}
              </button>
            </div>
          </div>

          {showCandidateList && (
            <div className="space-y-3">
              {visibleCandidateInsights.map((insight) => (
                  <CandidateCard
                    key={insight.candidate.id}
                    insight={insight}
                    selected={selectedInsight?.candidate.id === insight.candidate.id}
                    onClick={() => setSelectedCandidateId(insight.candidate.id)}
                    onExclude={() => handleExcludeCandidate(insight.candidate.id)}
                    nearbySections={selectedInsight?.candidate.id === insight.candidate.id ? nearbySections : []}
                    activeNearbyCategory={activeNearbyCategory}
                    onNearbyCategoryChange={setActiveNearbyCategory}
                    onNearbySearch={() => setNearbySearchCandidateId(insight.candidate.id)}
                    nearbyStatus={nearbyPlacesStatus}
                    nearbyMessage={nearbyPlacesMessage}
                    nearbyError={nearbyPlacesError}
                  />
              ))}

	              {!visibleCandidateInsights.length && (
	                <div className="rounded-2xl border border-dashed border-[#d9e0e7] bg-white/80 px-5 py-8 text-center text-sm text-[#6b7280]">
		                  {excludedCandidateIds.length
		                    ? '남은 후보가 없어요. 되돌리기를 눌러 다시 볼 수 있습니다.'
		                    : fallbackNotice ??
		                      (isFairnessMode
		                        ? '조건에 맞는 후보가 없어요. 공정도를 넓히거나 다른 방식을 골라 주세요.'
		                        : '조건에 맞는 후보가 없어요. 다른 모임 방식이나 카테고리를 골라 주세요.')}
	                </div>
	              )}
            </div>
          )}

        </section>
      </div>

      <div className="mx-auto max-w-[1040px] px-4 pb-8">
        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-4 shadow-[0_18px_42px_rgba(26,26,46,0.12)] backdrop-blur-xl">
          {!onlineRoom && (
            <div className="px-2 pb-2 text-xs text-[#76777e]">
              {readyStatusText}
            </div>
          )}

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
            className={`flex h-16 w-full items-center justify-center gap-2 rounded-[1.35rem] text-lg font-bold tracking-[-0.03em] text-white shadow-[0_10px_30px_rgba(26,26,46,0.12)] transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
              onlineRoom && isCurrentActorReady ? 'bg-[#22c55e]' : 'bg-[#1f2a44]'
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
                ? 'AI 후보 정리 중'
                : fairnessVerificationPending
                  ? '실제 이동시간 확인 중'
                : '장소 추첨 시작'}
          </button>
        </div>
      </div>

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
              ? `${activeDrawControllerName}님이 게임을 진행 중이에요. 결과가 정해지면 자동으로 넘어갑니다.`
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
