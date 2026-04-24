import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BookmarkPlus,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
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
  RuntimeAiConfig,
  SavedFriend,
  SelectionModeKey,
  ThrillLevel,
  TravelInfo,
  TravelMode,
  TravelRouteStep,
} from '../types';
import { ParticipantCard } from './ParticipantCard';
import { MapView } from './MapView';
import { CandidateCard } from './CandidateCard';
import { RandomDrawer } from './RandomDrawer';
import { AiConfigSheet } from './AiConfigSheet';
import { useLiveCandidateSearch } from '../hooks/useLiveCandidateSearch';
import { useCandidateTravelRoutes } from '../hooks/useCandidateTravelRoutes';
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
  getPreferredDrawControllerId,
  getRoomShareUrl,
  loadMeetingRoomByCode,
  loadRoomParticipants,
  rememberLocalRoomParticipant,
  removeRoomParticipant,
  updateRoomDrawController,
  updateRoomSelection,
} from '../lib/rooms';
import { NearbyPlacesPanel } from './NearbyPlacesPanel';
import type { UserHomeLocation } from '../lib/auth';

interface PlannerScreenProps {
  currentUserId: string;
  currentUserName: string;
  currentUserHomeLocation?: UserHomeLocation | null;
  onlineRoom: MeetingRoom | null;
  isOpeningRoom?: boolean;
  roomError?: string | null;
  onCreateOnlineRoom?: (participants: Participant[]) => Promise<void>;
  onOpenProfile?: () => void;
  initialParticipants: Participant[];
  selectedCategory: MeetCategoryKey;
  onCategoryChange: (category: MeetCategoryKey) => void;
  selectionMode: SelectionModeKey;
  onSelectionModeChange: (mode: SelectionModeKey) => void;
  thrillLevel: ThrillLevel;
  onThrillLevelChange: (level: ThrillLevel) => void;
  candidateScope: CandidateScopeKey;
  onCandidateScopeChange: (scope: CandidateScopeKey) => void;
  candidateTargetCount: number;
  onCandidateTargetCountChange: (count: number) => void;
  onBack: () => void;
  onComplete: (
    winner: Candidate,
    participants: Participant[],
    category: MeetCategoryKey,
    proof?: DrawProof | null,
  ) => void;
}

type LocationMode = 'current' | 'address' | 'map';

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

const candidateScopeOptions: Array<{
  key: CandidateScopeKey;
  label: string;
  description: string;
  targetCount: number;
  sliderValue: number;
}> = [
  {
    key: 'standard',
    label: '기본',
    description: '핵심 후보 위주로 빠르게 좁힙니다.',
  },
  {
    key: 'wide',
    label: '넓게',
    description: '조금 더 다양한 지역을 함께 봅니다.',
  },
  {
    key: 'max',
    label: '최대',
    description: '가능한 후보를 최대한 넓게 펼칩니다.',
  },
];

const MIN_CANDIDATE_TARGET_COUNT = 4;
const MAX_CANDIDATE_TARGET_COUNT = 20;
const thrillButtonLabels: Record<ThrillLevel, string> = {
  1: 'Lv.1',
  2: 'Lv.2',
  3: 'Lv.3',
  4: 'Lv.4',
  5: 'Lv.5',
};

function clampCandidateTargetCount(count: number) {
  return Math.max(
    MIN_CANDIDATE_TARGET_COUNT,
    Math.min(MAX_CANDIDATE_TARGET_COUNT, Math.round(count)),
  );
}

function getCandidateScopeFromTargetCount(count: number): CandidateScopeKey {
  if (count >= 14) {
    return 'max';
  }

  if (count >= 9) {
    return 'wide';
  }

  return 'standard';
}

function formatCoordinatePreview(coordinates: Coordinates) {
  return `${coordinates.lat.toFixed(3)}, ${coordinates.lng.toFixed(3)}`;
}

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
    return 'ODsay';
  }

  if (route.source === 'directions') {
    return '네이버';
  }

  return '예상';
}

function formatRouteFee(route: TravelInfo) {
  if (route.mode === 'car') {
    const fuel = Math.round(route.fuelPrice ?? route.cost ?? 0);
    const toll = Math.round(route.tollFare ?? 0);
    return toll > 0
      ? `유류비 ${fuel.toLocaleString()}원 · 통행료 ${toll.toLocaleString()}원`
      : `유류비 ${fuel.toLocaleString()}원`;
  }

  return `${Math.round(route.cost ?? 0).toLocaleString()}원 · 환승 ${route.transferCount ?? 0}회`;
}

function getRouteHeadline(route: TravelInfo) {
  if (route.routeSummary) {
    return route.routeSummary;
  }

  return route.mode === 'car' ? '자동차 경로' : '대중교통 예상 경로';
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
        participant.location,
        participant.coordinates.lat.toFixed(6),
        participant.coordinates.lng.toFixed(6),
        participant.maxTravelTime,
        participant.travelMode ?? 'transit',
        participant.locationSource ?? '',
        participant.savedFriendId ?? '',
        participant.createdBy ?? '',
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

export function PlannerScreen({
  currentUserId,
  currentUserName,
  currentUserHomeLocation = null,
  onlineRoom,
  isOpeningRoom = false,
  roomError: externalRoomError = null,
  onCreateOnlineRoom,
  onOpenProfile,
  initialParticipants,
  selectedCategory,
  onCategoryChange,
  selectionMode,
  onSelectionModeChange,
  thrillLevel,
  onThrillLevelChange,
  candidateScope,
  onCandidateScopeChange,
  candidateTargetCount,
  onCandidateTargetCountChange,
  onBack,
  onComplete,
}: PlannerScreenProps) {
  const participantSectionRef = useRef<HTMLElement | null>(null);
  const participantsRef = useRef<Participant[]>(initialParticipants);
  const seenRoomWinnerRef = useRef<string | null>(null);

  const [participants, setParticipants] = useState<Participant[]>(initialParticipants);
  const [savedFriends, setSavedFriends] = useState<SavedFriend[]>([]);
  const [runtimeAiConfig, setRuntimeAiConfig] = useState<RuntimeAiConfig | null>(null);
  const [isAiConfigOpen, setIsAiConfigOpen] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [showCandidateList, setShowCandidateList] = useState(false);
  const [showAddForm, setShowAddForm] = useState(() => initialParticipants.length === 0);
  const [showDrawer, setShowDrawer] = useState(false);
  const [saveNewFriend, setSaveNewFriend] = useState(true);
  const [newName, setNewName] = useState('');
  const [locationMode, setLocationMode] = useState<LocationMode>('address');
  const [addressQuery, setAddressQuery] = useState('');
  const [addressResults, setAddressResults] = useState<AddressSearchResult[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [newLocation, setNewLocation] = useState('');
  const [newCoordinates, setNewCoordinates] = useState<Coordinates | null>(null);
  const [newTravelMode, setNewTravelMode] = useState<TravelMode>('transit');
  const newTravelTime = DEFAULT_MAX_TRAVEL_TIME;
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
  const [isCreatingRoomFromPlanner, setIsCreatingRoomFromPlanner] = useState(false);
  const [nearbySearchCandidateId, setNearbySearchCandidateId] = useState<string | null>(null);
  const [syncedRoom, setSyncedRoom] = useState<MeetingRoom | null>(onlineRoom);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    setSyncedRoom(onlineRoom);
  }, [onlineRoom]);

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
    setRoomSyncStatus('loading');
    setRoomMessage(null);

    const syncParticipants = () => {
      if (isSyncingParticipants) {
        return;
      }

      isSyncingParticipants = true;

      void loadRoomParticipants(onlineRoom.id)
        .then((nextParticipants) => {
          if (!active) {
            return;
          }

          setParticipants((current) => mergeSyncedParticipants(current, nextParticipants));
          setRoomSyncStatus('connected');
        })
        .catch((error: Error) => {
          if (!active) {
            return;
          }

          setRoomSyncStatus('error');
          setRoomMessage(error.message);
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
          if (!active || !room) {
            return;
          }

          setSyncedRoom(room);

          if (room.status !== 'decided' || !room.selectedCandidate) {
            return;
          }

          const winnerKey = `${room.selectedCandidate.id}-${room.updatedAt}`;

          if (seenRoomWinnerRef.current === winnerKey) {
            return;
          }

          seenRoomWinnerRef.current = winnerKey;
          onCategoryChange(room.selectedCategory);
          onComplete(room.selectedCandidate, participantsRef.current, room.selectedCategory);
        })
        .catch((error: Error) => {
          if (active) {
            setRoomMessage(error.message);
          }
        })
        .finally(() => {
          isSyncingRoom = false;
        });
    };

    syncParticipants();
    syncRoomState();

    const participantsIntervalId = window.setInterval(syncParticipants, 2500);
    const roomIntervalId = window.setInterval(syncRoomState, 3500);

    return () => {
      active = false;
      window.clearInterval(participantsIntervalId);
      window.clearInterval(roomIntervalId);
    };
  }, [onlineRoom, onCategoryChange, onComplete]);

  useEffect(() => {
    let active = true;

    void loadSavedFriends(currentUserId).then((friends) => {
      if (!active) {
        return;
      }

      setSavedFriends(friends);
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
    setSaveNewFriend(!isGuestMode);
  }, [isGuestMode]);

  const activeCategory =
    meetCategories.find((category) => category.key === selectedCategory) ?? meetCategories[0];
  const activeMode =
    selectionModes.find((mode) => mode.key === selectionMode) ?? selectionModes[0];
  const effectiveThrillLevel: ThrillLevel =
    selectionMode === 'balance' ? 1 : thrillLevel;
  const activeThrill =
    thrillStages.find((stage) => stage.level === effectiveThrillLevel) ?? thrillStages[0];
  const visibleThrillStages = thrillStages;
  const activeScope =
    candidateScopeOptions.find((scope) => scope.key === candidateScope) ?? candidateScopeOptions[0];
  const activeCandidateTargetCount = clampCandidateTargetCount(candidateTargetCount);
  const roomActorIds = useMemo(
    () =>
      getCurrentRoomActorIds({
        roomId: roomState?.id ?? null,
        currentUserId,
        participants,
      }),
    [currentUserId, participants, roomState?.id],
  );
  const fallbackDrawControllerId = useMemo(
    () => getPreferredDrawControllerId(participants, roomState?.ownerId),
    [participants, roomState?.ownerId],
  );
  const activeDrawControllerId = roomState?.drawControllerId ?? fallbackDrawControllerId;
  const drawControllerName =
    participants.find(
      (participant) => getParticipantActorKey(participant) === activeDrawControllerId,
    )?.name ?? '추첨 담당자';
  const canStartOnlineDraw =
    !roomState || (activeDrawControllerId ? roomActorIds.includes(activeDrawControllerId) : false);

  useEffect(() => {
    if (!onlineRoom || !participants.length) {
      return;
    }

    const currentControllerStillPresent =
      roomState?.drawControllerId &&
      participants.some(
        (participant) => getParticipantActorKey(participant) === roomState.drawControllerId,
      );

    if (currentControllerStillPresent) {
      return;
    }

    const nextControllerId = getPreferredDrawControllerId(
      participants,
      roomState?.ownerId ?? onlineRoom.ownerId,
    );

    if (!nextControllerId || nextControllerId === roomState?.drawControllerId) {
      return;
    }

    void updateRoomDrawController({
      roomId: onlineRoom.id,
      drawControllerId: nextControllerId,
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
    onlineRoom,
    participants,
    roomState?.drawControllerId,
    roomState?.ownerId,
  ]);

  const candidateUniverse = useMemo(
    () =>
      buildCandidateUniverse(
        participants,
        mockCandidates,
        selectedCategory,
        effectiveThrillLevel,
      ),
    [effectiveThrillLevel, participants, selectedCategory],
  );
  const allCandidateInsights = useMemo(
    () => getCandidateInsights(participants, candidateUniverse, selectedCategory),
    [candidateUniverse, participants, selectedCategory],
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
  const candidateCountLimited =
    participants.length >= 2 &&
    activeCandidateTargetCount > scopedCandidateInsights.length;
  const candidateSliderMax = scopedCandidateInsights.length
    ? Math.max(MIN_CANDIDATE_TARGET_COUNT, Math.min(MAX_CANDIDATE_TARGET_COUNT, scopedCandidateInsights.length))
    : MIN_CANDIDATE_TARGET_COUNT;
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
    source: aiCandidateSource,
    message: aiCandidateMessage,
    error: aiCandidateError,
  } = useLiveCandidateSearch(
    participants,
    scopedCandidateInsights,
    fallbackCandidateIds,
    selectedCategory,
    selectionMode,
    effectiveThrillLevel,
    candidateScope,
    effectiveRuntimeAiConfig,
    aiConfigSignature,
    effectiveCandidateTargetCount,
  );

  const aiCandidateInsights = useMemo(
    () => sortInsightsByCandidateIds(scopedCandidateInsights, aiCandidateIds),
    [aiCandidateIds, scopedCandidateInsights],
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
  const candidateInsights = useMemo(
    () =>
      rawCandidateInsights.filter(
        (insight) => !excludedCandidateIds.includes(insight.candidate.id),
      ),
    [excludedCandidateIds, rawCandidateInsights],
  );
  const { pool: drawPool, fallbackNotice } = useMemo(
    () =>
      getDrawPool(
        candidateInsights,
        selectionMode,
        effectiveThrillLevel,
        candidateScope,
        effectiveCandidateTargetCount,
      ),
    [
      candidateInsights,
      candidateScope,
      effectiveCandidateTargetCount,
      effectiveThrillLevel,
      selectionMode,
    ],
  );
  const drawDisabledReason = participants.length < 2
    ? '먼저 참여자를 2명 이상 입력해 주세요.'
    : !canStartOnlineDraw
      ? `${drawControllerName}만 최종 랜덤 추첨을 시작할 수 있어요.`
      : !drawPool.length
        ? '추첨 가능한 후보가 아직 없어요.'
        : aiCandidateStatus === 'loading'
          ? 'AI가 후보를 정리하는 중이에요.'
          : null;

  const selectedInsight = useMemo(
    () =>
      candidateInsights.find((insight) => insight.candidate.id === selectedCandidateId) ??
      candidateInsights[0] ??
      null,
    [candidateInsights, selectedCandidateId],
  );
  const {
    routes: selectedCandidateRoutes,
    status: selectedRouteStatus,
    error: selectedRouteError,
    hasLiveData: selectedRouteHasLiveData,
  } = useCandidateTravelRoutes(participants, selectedInsight?.candidate ?? null);

  useEffect(() => {
    setExpandedRouteKey(null);
  }, [selectedInsight?.candidate.id]);

  const nearbySearchEnabled =
    Boolean(selectedInsight) && nearbySearchCandidateId === selectedInsight?.candidate.id;
  const {
    sections: nearbySections,
    status: nearbyPlacesStatus,
    error: nearbyPlacesError,
    message: nearbyPlacesMessage,
  } = useNearbyPlaces(selectedInsight?.candidate ?? null, selectedCategory, nearbySearchEnabled);
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
    if (!candidateInsights.length) {
      setSelectedCandidateId(null);
      return;
    }

    if (
      !selectedCandidateId ||
      !candidateInsights.some((insight) => insight.candidate.id === selectedCandidateId)
    ) {
      setSelectedCandidateId(candidateInsights[0].candidate.id);
    }
  }, [candidateInsights, selectedCandidateId]);

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

  useEffect(() => {
    if (!participants.length) {
      setShowAddForm(true);
    }
  }, [participants.length]);

  const savedFriendIds = useMemo(
    () => new Set(savedFriends.map((friend) => friend.id)),
    [savedFriends],
  );
  const selfProfileParticipantKey = currentUserId ? `self-profile-${currentUserId}` : '';
  const isSelfProfileAdded = Boolean(
    currentUserHomeLocation &&
      participants.some(
        (participant) =>
          participant.savedFriendId === selfProfileParticipantKey ||
          (participant.createdBy === currentUserId &&
            participant.name === currentUserName &&
            participant.location === currentUserHomeLocation.location),
      ),
  );

  const persistFriends = (nextFriends: SavedFriend[]) => {
    setSavedFriends(nextFriends);
    void persistSavedFriends(currentUserId, nextFriends);
  };

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

  const handleCreateShareRoom = async () => {
    if (!onCreateOnlineRoom) {
      return;
    }

    setIsCreatingRoomFromPlanner(true);
    setRoomMessage(null);

    try {
      await onCreateOnlineRoom(participants);
    } catch (error) {
      setRoomMessage(error instanceof Error ? error.message : '공유 방을 만들지 못했어요.');
    } finally {
      setIsCreatingRoomFromPlanner(false);
    }
  };

  const resetLocationDraft = () => {
    setAddressQuery('');
    setAddressResults([]);
    setNewLocation('');
    setNewCoordinates(null);
    setLocationError(null);
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
      const results = await searchAddress(query);

      if (!results.length) {
        setLocationError('검색 결과가 없어요. 도로명이나 건물명으로 다시 검색해 주세요.');
        return;
      }

      const nextResults = results.slice(0, 5);
      const firstResult = nextResults[0];

      setAddressResults(nextResults);

      if (firstResult) {
        setNewLocation(firstResult.title);
        setAddressQuery(firstResult.title);
        setNewCoordinates(firstResult.coordinates);
      }
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : '주소 검색 중 오류가 발생했어요.');
    } finally {
      setIsSearchingAddress(false);
    }
  };

  const handleSelectAddressResult = (result: AddressSearchResult) => {
    setNewLocation(result.title);
    setAddressQuery(result.title);
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
        setNewCoordinates({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
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
      setNewLocation(result.title);
      setAddressQuery(result.title);
    } catch (error) {
      setNewLocation(`${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)}`);
      setAddressQuery('');
      setLocationError(error instanceof Error ? error.message : '선택한 위치 주소를 찾지 못했어요.');
    }
  };

  const handleQuickAddSavedFriend = (friend: SavedFriend) => {
    if (isFriendAlreadyAdded(participants, friend)) {
      return;
    }

    const nextParticipant = createParticipantFromSavedFriend(friend);
    setParticipants((current) => [...current, nextParticipant]);

    if (onlineRoom) {
      rememberLocalRoomParticipant(onlineRoom.id, nextParticipant.id);
      void addRoomParticipant({
        roomId: onlineRoom.id,
        participant: nextParticipant,
        userId: currentUserId || null,
      }).catch((error: Error) => {
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

    const nextParticipant: Participant = {
      id: `participant-self-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: currentUserName,
      location: currentUserHomeLocation.location,
      coordinates: currentUserHomeLocation.coordinates,
      maxTravelTime: DEFAULT_MAX_TRAVEL_TIME,
      travelMode: 'transit',
      locationSource: currentUserHomeLocation.locationSource ?? 'address',
      savedFriendId: selfProfileParticipantKey,
      createdBy: currentUserId,
    };

    setParticipants((current) => [...current, nextParticipant]);

    if (onlineRoom) {
      rememberLocalRoomParticipant(onlineRoom.id, nextParticipant.id);
      void addRoomParticipant({
        roomId: onlineRoom.id,
        participant: nextParticipant,
        userId: currentUserId || null,
      }).catch((error: Error) => {
        forgetLocalRoomParticipant(onlineRoom.id, nextParticipant.id);
        setRoomMessage(error.message);
        setParticipants((current) =>
          current.filter((participant) => participant.id !== nextParticipant.id),
        );
      });
    }
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

    const shouldSaveNewFriend = !isGuestMode && saveNewFriend;
    const savedFriendId = shouldSaveNewFriend ? `friend-${Date.now()}` : undefined;
    const newParticipant: Participant = {
      id: `participant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: newName.trim(),
      location: locationMode === 'current' ? '현재 위치 기준' : newLocation,
      coordinates: newCoordinates,
      maxTravelTime: DEFAULT_MAX_TRAVEL_TIME,
      travelMode: newTravelMode,
      locationSource: locationMode,
      savedFriendId,
      createdBy: currentUserId || null,
    };

    setParticipants((current) => [...current, newParticipant]);

    if (onlineRoom) {
      rememberLocalRoomParticipant(onlineRoom.id, newParticipant.id);
      void addRoomParticipant({
        roomId: onlineRoom.id,
        participant: newParticipant,
        userId: currentUserId || null,
      }).catch((error: Error) => {
        forgetLocalRoomParticipant(onlineRoom.id, newParticipant.id);
        setRoomMessage(error.message);
        setParticipants((current) =>
          current.filter((participant) => participant.id !== newParticipant.id),
        );
      });
    }

    if (shouldSaveNewFriend) {
      const nextSavedFriend = buildSavedFriendFromParticipant(newParticipant);
      persistFriends(upsertSavedFriend(savedFriends, nextSavedFriend));
    }

    setNewName('');
    setShowAddForm(false);
    setSaveNewFriend(!isGuestMode);
    setLocationMode('address');
    setNewTravelMode('transit');
    resetLocationDraft();
  };

  const handleRemoveParticipant = (id: string) => {
    setParticipants((current) => current.filter((participant) => participant.id !== id));

    if (onlineRoom) {
      forgetLocalRoomParticipant(onlineRoom.id, id);
      void removeRoomParticipant(onlineRoom.id, id).catch((error: Error) => {
        setRoomMessage(error.message);
      });
    }
  };

  const handleSelectionModeSelect = (mode: SelectionModeKey) => {
    onSelectionModeChange(mode);

    if (mode === 'balance') {
      onThrillLevelChange(1);
      return;
    }

    if (thrillLevel < 3) {
      onThrillLevelChange(3);
    }
  };

  const handleThrillLevelSelect = (level: ThrillLevel) => {
    if (selectionMode === 'balance') {
      return;
    }

    onThrillLevelChange(level);
  };

  const handleExcludeCandidate = (candidateId: string) => {
    setExcludedCandidateIds((current) =>
      current.includes(candidateId) ? current : [...current, candidateId],
    );

    if (selectedCandidateId === candidateId) {
      const nextInsight = candidateInsights.find((insight) => insight.candidate.id !== candidateId);
      setSelectedCandidateId(nextInsight?.candidate.id ?? null);
    }
  };

  const handleCandidateTargetCountChange = (count: number) => {
    const nextCount = clampCandidateTargetCount(count);

    onCandidateTargetCountChange(nextCount);
    onCandidateScopeChange(getCandidateScopeFromTargetCount(nextCount));
  };

  const handleDrawComplete = (winner: Candidate, proof: DrawProof) => {
    setShowDrawer(false);

    if (onlineRoom) {
      void updateRoomSelection({
        roomId: onlineRoom.id,
        selectedCategory,
        selectedCandidate: winner,
      })
        .then((room) => {
          setSyncedRoom(room);
        })
        .catch((error: Error) => {
          setRoomMessage(error.message);
        });
    }

    onComplete(winner, participants, selectedCategory, proof);
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
    aiCandidateStatus === 'loading'
      ? 'AI가 후보 지역을 정리 중이에요.'
      : aiCandidateError
        ? aiCandidateError
        : aiCandidateMessage
          ? aiCandidateMessage
          : fallbackNotice ?? `공통 범위 안에서 바로 추첨 가능한 후보 ${drawPool.length}곳을 골라뒀어요.`;

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
          Drop
        </h2>
        {onOpenProfile ? (
          <button
            type="button"
            onClick={onOpenProfile}
            className="inline-flex h-10 max-w-[132px] items-center gap-1.5 rounded-full bg-white px-3 text-sm text-[#1f2a44] shadow-sm transition-transform active:scale-95"
            aria-label="프로필 설정"
          >
            <UserRound className="h-4 w-4 shrink-0 text-[#6b7280]" />
            <span className="truncate">{currentUserName}</span>
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      <div className="mx-auto flex max-w-[1040px] flex-col gap-4 px-4 py-5 sm:gap-5 sm:py-6">
        {onlineRoom ? (
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
                  {participants.length}명 참여 · 추첨 {drawControllerName}
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

            {(roomMessage || roomSyncStatus === 'error') && (
              <div className="mt-3 rounded-xl bg-[#fff8e8] px-3 py-2 text-xs text-[#8a621c]">
                {roomMessage || '방 동기화를 확인해 주세요.'}
              </div>
            )}
          </section>
        ) : (
          <section className="relative flex items-center justify-between gap-3 rounded-[1.75rem] border border-white/70 bg-white/92 px-4 py-3 shadow-[0_10px_30px_rgba(26,26,46,0.08)] backdrop-blur-sm">
            <div className="min-w-0 text-sm text-[#76777e]">
              혼자 쓰는 중
            </div>
            <button
              type="button"
              onClick={() => {
                void handleCreateShareRoom();
              }}
              disabled={isOpeningRoom || isCreatingRoomFromPlanner}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[#1f2a44] px-4 text-sm text-white shadow-sm transition-transform active:scale-95 disabled:opacity-60"
            >
              {(isOpeningRoom || isCreatingRoomFromPlanner) && (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              )}
              공유 방 만들기
            </button>
            {(roomMessage || externalRoomError) && (
              <div className="absolute left-4 right-4 top-full mt-2 rounded-xl bg-[#fff8e8] px-3 py-2 text-xs text-[#8a621c]">
                {roomMessage || externalRoomError}
              </div>
            )}
          </section>
        )}

        <section className="order-1 space-y-3">
          <MapView
            participants={participants}
            candidates={candidateInsights.map((insight) => insight.candidate)}
            reachableCandidateIds={drawPool.map((candidate) => candidate.candidate.id)}
            selectedCandidate={selectedInsight?.candidate}
            nearbyPlaces={nearbyMapPlaces}
            onCandidateSelect={setSelectedCandidateId}
            locationPickerEnabled
            locationPickerHintVisible={(showAddForm && locationMode === 'map') || participants.length === 0}
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
            {selectionMode === 'neighborhood' && (
              <span className="rounded-full bg-white px-3 py-1 text-xs text-[#1a1a2e] shadow-sm">
                강도 {effectiveThrillLevel}
              </span>
            )}
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
          <div className="order-3 space-y-5 rounded-[1.75rem] border border-white/70 bg-white/95 p-5 shadow-[0_10px_30px_rgba(26,26,46,0.08)]">
            <section>
              <div className="mb-3 text-sm font-semibold text-[#45464d]">오늘의 모임</div>
              <div className="flex flex-wrap gap-2">
                {meetCategories.map((category) => {
                  const active = category.key === selectedCategory;

                  return (
                    <button
                      key={category.key}
                      type="button"
                      onClick={() => onCategoryChange(category.key)}
                      className={`h-10 rounded-full px-4 text-sm transition-all ${
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

            <section>
              <div className="mb-3 text-sm font-semibold text-[#45464d]">선정 방식</div>
              <div className="grid grid-cols-2 gap-2">
                {selectionModes.map((mode) => {
                  const active = mode.key === selectionMode;

                  return (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => handleSelectionModeSelect(mode.key)}
                      className={`h-10 rounded-full px-4 text-sm transition-all ${
                        active
                          ? 'bg-[#1f2a44] text-white shadow-sm'
                          : 'bg-[#f5f1eb] text-[#44505b]'
                      }`}
                    >
                      {mode.shortLabel}
                    </button>
                  );
                })}
              </div>
            </section>

            {selectionMode === 'neighborhood' && (
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-[#1a1a2e]">랜덤 강도</div>
                  <div className="text-xs text-[#8a94a2]">
                    {activeThrill.shortLabel}
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
                        className={`h-10 rounded-full text-sm transition-all ${
                          active
                            ? 'bg-[#ff7b6b] text-white shadow-sm'
                            : 'bg-[#f5f1eb] text-[#44505b]'
                        }`}
                      >
                        {thrillButtonLabels[stage.level]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 truncate text-xs text-[#8a94a2]">
                  {activeThrill.description}
                </p>
              </section>
            )}

            {!runtimeCapabilities.ai.connected && (
              <div className="rounded-3xl border border-[#e6ebf0] bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-[#1a1a2e]">
                      <Bot className="h-4 w-4 text-[#2d3561]" />
                      <span className="text-sm">
                        {runtimeAiConfig ? 'AI 후보 생성 연결됨' : 'AI 후보 생성 연결 필요'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">
                      {runtimeAiConfig
                        ? `${runtimeAiConfig.provider === 'upstage' ? 'Upstage' : 'OpenAI'} · ${runtimeAiConfig.model}`
                        : '키를 넣어두면 AI가 먼저 후보군을 정리합니다.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsAiConfigOpen(true)}
                    className="inline-flex h-10 items-center justify-center rounded-full bg-[#f5f1eb] px-4 text-sm text-[#1a1a2e] shadow-sm transition-transform active:scale-95"
                  >
                    연결
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <section ref={participantSectionRef} className="order-2">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-bold tracking-[-0.04em] text-[#1f2a44]">사람 추가</h3>
              <p className="text-sm text-[#76777e]">주소나 지도에서 출발 위치를 정해 주세요.</p>
            </div>

            <button
              type="button"
              onClick={() => setShowAddForm((current) => !current)}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-medium shadow-sm transition-all active:scale-95 ${
                showAddForm
                  ? 'border-[#1f2a44] bg-[#1f2a44] text-white'
                  : 'border-[#dfe5eb] bg-white text-[#2d3561] hover:bg-[#f8fbfd]'
              }`}
            >
              <Plus className={`h-4 w-4 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
              {showAddForm ? '닫기' : '추가'}
            </button>
          </div>

          {currentUserId && (
            <div className="mb-3 flex flex-col gap-3 rounded-[1.75rem] border border-white/70 bg-white/95 p-4 shadow-[0_10px_30px_rgba(26,26,46,0.06)] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f5f1eb] text-[#2d3561]">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#1a1a2e]">내 정보</div>
                  <div className="mt-1 truncate text-sm text-[#6b7280]">
                    {currentUserHomeLocation
                      ? `${currentUserName} · ${currentUserHomeLocation.location}`
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
                  onClick={onOpenProfile}
                  className="h-10 rounded-full bg-[#f5f1eb] px-4 text-sm text-[#44505b] transition-transform active:scale-95"
                >
                  수정
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
                          {friend.location}
                        </span>
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

          {showAddForm && (
            <div className="mb-3 rounded-[2rem] border border-white/70 bg-white/95 p-5 shadow-[0_10px_30px_rgba(26,26,46,0.08)]">
              <div className="mb-4 flex flex-col gap-2 text-sm text-[#1a1a2e] sm:flex-row sm:items-center sm:justify-between">
                <BookmarkPlus className="h-4 w-4 text-[#2d3561]" />
                {isGuestMode
                  ? '게스트 모드에서는 이번 약속에만 반영돼요.'
                  : '입력한 친구는 다음에도 바로 불러올 수 있어요.'}
              </div>

              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="이름"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-[#edf1f4] bg-[#fbfaf8] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:border-[#d8e0ea] focus:ring-2 focus:ring-[#2d3561]/10"
                />

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
                          현재 위치가 들어왔어요: {formatCoordinatePreview(newCoordinates)}
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
                          선택한 좌표가 바로 이 사람 위치로 들어갑니다.
                        </div>
                      </div>

                      {newCoordinates && (
                        <div className="mt-3 rounded-xl border border-[#e8edf3] bg-white px-3 py-2 text-xs text-[#1a1a2e]">
                          {newLocation || `${newCoordinates.lat.toFixed(4)}, ${newCoordinates.lng.toFixed(4)}`}
                        </div>
                      )}

                      {locationError && (
                        <div className="mt-3 rounded-xl border border-[#ffd9cf] bg-[#fff5f2] px-3 py-2 text-xs text-[#c15b3d]">
                          {locationError}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-[#e8edf3] bg-[#f8fbfd] p-4">
                      <div className="flex flex-col gap-2 sm:flex-row">
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
                          className="h-12 flex-1 rounded-2xl border border-[#edf1f4] bg-white px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:border-[#d8e0ea] focus:ring-2 focus:ring-[#2d3561]/10"
                        />

                        <button
                          type="button"
                          onClick={() => {
                            void handleAddressSearch();
                          }}
                          disabled={isSearchingAddress}
                          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#eef4ff] px-5 text-sm text-[#2d5aa7] transition-transform active:scale-95 disabled:opacity-60"
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
                            const isSelected = newLocation === result.title;

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
                                  {result.title}
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
                          선택한 주소가 들어왔어요: {newLocation}
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

              {isGuestMode ? (
                <div className="mt-2 px-1 text-xs text-[#8a94a2]">
                  게스트 모드라 저장 없이 이번 약속에만 반영돼요.
                </div>
              ) : (
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
                  참여자 추가
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setSaveNewFriend(!isGuestMode);
                    setLocationMode('address');
                    setNewTravelMode('transit');
                    resetLocationDraft();
                  }}
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
                  onSaveFriend={isGuestMode ? undefined : handleSaveParticipantFriend}
                  isSavedFriend={Boolean(
                    participant.savedFriendId && savedFriendIds.has(participant.savedFriendId),
                  )}
                  color={PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length]}
                />
              ))}
            </div>

            {selectedInsight ? (
              <div className="mt-3 rounded-[1.25rem] border border-[#e8edf3] bg-[#f8fbfd] p-3">
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

                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {participants.map((participant, index) => {
                    const route =
                      selectedCandidateRoutes.find((item) => item.participantId === participant.id) ??
                      null;
                    const TravelIcon = getTravelModeIcon(participant.travelMode);
                    const color = PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length];
                    const routeKey = `${selectedInsight.candidate.id}:${participant.id}`;
                    const isRouteExpanded = expandedRouteKey === routeKey;
                    const routeSteps = route?.routeSteps ?? [];
                    const routeMeta = route ? getRouteDetailMeta(route) : '';

                    return (
                      <button
                        key={routeKey}
                        type="button"
                        disabled={!route}
                        onClick={() =>
                          setExpandedRouteKey((current) => (current === routeKey ? null : routeKey))
                        }
                        className="w-full rounded-xl bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:shadow-none"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs text-white"
                                style={{ backgroundColor: color }}
                              >
                                {participant.name.charAt(0)}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-sm text-[#1a1a2e]">
                                  {participant.name}
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#6b7280]">
                                  <TravelIcon className="h-3.5 w-3.5" />
                                  {getTravelModeLabel(participant.travelMode)}
                                  {route ? ` · ${getRouteSourceLabel(route)}` : ''}
                                </div>
                              </div>
                            </div>

                            {route ? (
                              <>
                                <div className="mt-3 text-sm text-[#44505b]">
                                  {getRouteHeadline(route)}
                                </div>
                                <div className="mt-1 text-xs text-[#8a94a2]">
                                  {formatRouteFee(route)}
                                </div>
                              </>
                            ) : (
                              <div className="mt-3 flex items-center gap-2 text-xs text-[#8a94a2]">
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                경로 계산 중
                              </div>
                            )}
                          </div>

                          {route ? (
                            <div className="shrink-0 text-right">
                              <div className="text-lg text-[#1a1a2e]">{route.duration}분</div>
                              <div className="text-xs text-[#8a94a2]">{route.distance}km</div>
                              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#f5f1eb] px-2 py-1 text-[11px] text-[#6b7280]">
                                {isRouteExpanded ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                                {isRouteExpanded ? '접기' : '상세'}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {route && isRouteExpanded ? (
                          <div className="mt-3 border-t border-[#eef2f6] pt-3">
                            {routeMeta ? (
                              <div className="mb-2 rounded-2xl bg-[#f8fbfd] px-3 py-2 text-xs text-[#6b7280]">
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
                                      key={`${routeKey}:step:${stepIndex}`}
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
                                실시간 요약 경로만 받아왔어요. 더 자세한 안내는 지도 앱에서 확인할 수 있어요.
                              </div>
                            )}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

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
                후보 {candidateInsights.length}곳
              </h3>
              <p className="mt-1 truncate text-sm text-[#8a94a2]">
                {aiCandidateStatus === 'loading'
                  ? '후보 정리 중'
                  : excludedCandidateIds.length
                    ? `${excludedCandidateIds.length}곳 제외됨`
                    : `${activeCategory.label} 기준`}
              </p>
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
              {candidateInsights.map((insight) => (
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

              {!candidateInsights.length && (
                <div className="rounded-2xl border border-dashed border-[#d9e0e7] bg-white/80 px-5 py-8 text-center text-sm text-[#6b7280]">
                  남은 후보가 없어요. 되돌리기를 눌러 다시 볼 수 있습니다.
                </div>
              )}
            </div>
          )}

        </section>
      </div>

      <div className="mx-auto max-w-[1040px] px-4 pb-8">
        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-4 shadow-[0_18px_42px_rgba(26,26,46,0.12)] backdrop-blur-xl">
          <div className="mb-3 space-y-3">
            <div className="rounded-[1.5rem] bg-[#f5f1eb] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#1f2a44]">후보군 개수</div>
                  <div className="mt-1 text-xs text-[#76777e]">
                    {candidateCountLimited
                      ? `가능 ${effectiveCandidateTargetCount}개 · 요청 ${activeCandidateTargetCount}개`
                      : `최대 ${activeCandidateTargetCount}개 · 현재 ${drawPool.length}개`}
                  </div>
                </div>
                <div className="rounded-full bg-white px-3 py-1 text-xs text-[#45464d] shadow-sm">
                  {effectiveCandidateTargetCount}개
                </div>
              </div>

              <input
                type="range"
                min={MIN_CANDIDATE_TARGET_COUNT}
                max={candidateSliderMax}
                step={1}
                value={Math.min(activeCandidateTargetCount, candidateSliderMax)}
                onChange={(event) =>
                  handleCandidateTargetCountChange(Number(event.target.value))
                }
                className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-[#e4e2e4] accent-[#ff7b6b]"
              />

              <div className="mt-3 grid grid-cols-5 gap-2 text-xs text-[#76777e]">
                {[4, 8, 12, 16, 20].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => handleCandidateTargetCountChange(count)}
                    disabled={count > candidateSliderMax}
                    className={`rounded-full px-2 py-2 transition-colors ${
                      count === activeCandidateTargetCount ? 'bg-white text-[#1a1a2e] shadow-sm' : ''
                    } disabled:opacity-35`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-2 pb-2 text-xs text-[#76777e]">
            {drawDisabledReason ??
              `${drawPool.length}개의 후보 안에서 마지막 랜덤을 돌립니다.`}
          </div>

          <button
            type="button"
            onClick={() => setShowDrawer(true)}
            disabled={Boolean(drawDisabledReason)}
            className="flex h-16 w-full items-center justify-center gap-2 rounded-[1.35rem] bg-[#1f2a44] text-lg font-bold tracking-[-0.03em] text-white shadow-[0_10px_30px_rgba(26,26,46,0.12)] transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aiCandidateStatus === 'loading' ? (
              <LoaderCircle className="h-5 w-5 animate-spin" />
            ) : (
              <Shuffle className="h-5 w-5" />
            )}
            {aiCandidateStatus === 'loading'
              ? 'AI 후보 정리 중'
              : `${activeCategory.label} 랜덤 추첨 시작`}
          </button>
        </div>
      </div>

      {showDrawer && (
        <RandomDrawer
          candidateInsights={drawPool}
          categoryLabel={activeCategory.label}
          modeLabel={
            selectionMode === 'neighborhood'
              ? `${activeMode.shortLabel} · ${activeThrill.label} · ${activeScope.label}`
              : `${activeMode.shortLabel} · ${activeScope.label}`
          }
          selectionMode={selectionMode}
          thrillLevel={effectiveThrillLevel}
          candidateScope={candidateScope}
          onComplete={handleDrawComplete}
          onClose={() => setShowDrawer(false)}
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
