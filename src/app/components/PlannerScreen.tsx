import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BookmarkPlus,
  ChevronLeft,
  Copy,
  LoaderCircle,
  LocateFixed,
  Plus,
  Search,
  Settings2,
  Shuffle,
  Sparkles,
  Users,
  Wifi,
} from 'lucide-react';
import {
  Candidate,
  CandidateInsight,
  CandidateScopeKey,
  Coordinates,
  MeetingRoom,
  MeetCategoryKey,
  NearbyPlaceCategory,
  Participant,
  RuntimeAiConfig,
  SavedFriend,
  SelectionModeKey,
  ThrillLevel,
} from '../types';
import { ParticipantCard } from './ParticipantCard';
import { MapView } from './MapView';
import { CandidateCard } from './CandidateCard';
import { RandomDrawer } from './RandomDrawer';
import { AiConfigSheet } from './AiConfigSheet';
import { useLiveCandidateSearch } from '../hooks/useLiveCandidateSearch';
import { getDefaultNearbyCategory, useNearbyPlaces } from '../hooks/useNearbyPlaces';
import { useRuntimeCapabilities } from '../hooks/useRuntimeCapabilities';
import { meetCategories, mockCandidates, selectionModes, thrillStages } from '../data/mockData';
import {
  buildCandidateUniverse,
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
  getRoomShareUrl,
  loadRoomParticipants,
  removeRoomParticipant,
  subscribeToRoomParticipants,
  subscribeToRoomState,
  updateRoomSelection,
} from '../lib/rooms';
import { NearbyPlacesPanel } from './NearbyPlacesPanel';

interface PlannerScreenProps {
  currentUserId: string;
  currentUserName: string;
  onlineRoom: MeetingRoom | null;
  isOpeningRoom?: boolean;
  roomError?: string | null;
  onCreateOnlineRoom?: (participants: Participant[]) => Promise<void>;
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
  onComplete: (winner: Candidate, participants: Participant[], category: MeetCategoryKey) => void;
}

type LocationMode = 'current' | 'address' | 'map';

const PARTICIPANT_COLORS = ['#ff7b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#f59e0b', '#ec4899'];

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

export function PlannerScreen({
  currentUserId,
  currentUserName,
  onlineRoom,
  isOpeningRoom = false,
  roomError: externalRoomError = null,
  onCreateOnlineRoom,
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
  const newTravelTime = DEFAULT_MAX_TRAVEL_TIME;
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
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

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

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
    setRoomSyncStatus('loading');
    setRoomMessage(null);

    loadRoomParticipants(onlineRoom.id)
      .then((nextParticipants) => {
        if (!active) {
          return;
        }

        setParticipants(nextParticipants);
        setRoomSyncStatus('connected');
      })
      .catch((error: Error) => {
        if (!active) {
          return;
        }

        setRoomSyncStatus('error');
        setRoomMessage(error.message);
      });

    const unsubscribeParticipants = subscribeToRoomParticipants(
      onlineRoom.id,
      (nextParticipants) => {
        if (!active) {
          return;
        }

        setParticipants(nextParticipants);
        setRoomSyncStatus('connected');
      },
      (message) => {
        if (!active) {
          return;
        }

        setRoomSyncStatus('error');
        setRoomMessage(message);
      },
    );

    const unsubscribeRoom = subscribeToRoomState(
      onlineRoom.id,
      (room) => {
        if (!active || room.status !== 'decided' || !room.selectedCandidate) {
          return;
        }

        const winnerKey = `${room.selectedCandidate.id}-${room.updatedAt}`;

        if (seenRoomWinnerRef.current === winnerKey) {
          return;
        }

        seenRoomWinnerRef.current = winnerKey;
        onCategoryChange(room.selectedCategory);
        onComplete(room.selectedCandidate, participantsRef.current, room.selectedCategory);
      },
      (message) => {
        if (!active) {
          return;
        }

        setRoomMessage(message);
      },
    );

    return () => {
      active = false;
      unsubscribeParticipants();
      unsubscribeRoom();
    };
  }, [onlineRoom, onCategoryChange, onComplete]);

  useEffect(() => {
    let active = true;

    void loadSavedFriends(currentUserId).then((friends) => {
      if (active) {
        setSavedFriends(friends);
      }
    });

    return () => {
      active = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    setRuntimeAiConfig(loadRuntimeAiConfig());
  }, []);

  const isGuestMode = !currentUserId;
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
    selectionMode === 'balance' ? 1 : thrillLevel >= 3 ? thrillLevel : 3;
  const activeThrill =
    thrillStages.find((stage) => stage.level === effectiveThrillLevel) ?? thrillStages[0];
  const visibleThrillStages = thrillStages.filter((stage) => stage.level >= 3);
  const activeScope =
    candidateScopeOptions.find((scope) => scope.key === candidateScope) ?? candidateScopeOptions[0];
  const activeCandidateTargetCount = clampCandidateTargetCount(candidateTargetCount);

  const candidateUniverse = buildCandidateUniverse(
    participants,
    mockCandidates,
    selectedCategory,
    effectiveThrillLevel,
  );
  const allCandidateInsights = getCandidateInsights(participants, candidateUniverse, selectedCategory);
  const effectiveCandidateTargetCount = allCandidateInsights.length
    ? Math.min(activeCandidateTargetCount, allCandidateInsights.length)
    : activeCandidateTargetCount;
  const candidateCountLimited =
    allCandidateInsights.length > 0 && activeCandidateTargetCount > allCandidateInsights.length;
  const candidateSliderMax = allCandidateInsights.length
    ? Math.max(MIN_CANDIDATE_TARGET_COUNT, Math.min(MAX_CANDIDATE_TARGET_COUNT, allCandidateInsights.length))
    : MAX_CANDIDATE_TARGET_COUNT;
  const seedCandidateInsights = getDynamicCandidateInsights(
    participants,
    candidateUniverse,
    selectedCategory,
    selectionMode,
    effectiveThrillLevel,
    candidateScope,
    effectiveCandidateTargetCount,
  );

  const {
    candidateIds: aiCandidateIds,
    status: aiCandidateStatus,
    source: aiCandidateSource,
    message: aiCandidateMessage,
    error: aiCandidateError,
  } = useLiveCandidateSearch(
    participants,
    allCandidateInsights,
    seedCandidateInsights.map((insight) => insight.candidate.id),
    selectedCategory,
    selectionMode,
    effectiveThrillLevel,
    candidateScope,
    effectiveRuntimeAiConfig,
    aiConfigSignature,
    effectiveCandidateTargetCount,
  );

  const aiCandidateInsights = sortInsightsByCandidateIds(allCandidateInsights, aiCandidateIds);
  const rawCandidateInsights = aiCandidateInsights.length ? aiCandidateInsights : seedCandidateInsights;
  const candidateInsights = rawCandidateInsights.filter(
    (insight) => !excludedCandidateIds.includes(insight.candidate.id),
  );
  const { pool: drawPool, fallbackNotice } = getDrawPool(
    candidateInsights,
    selectionMode,
    effectiveThrillLevel,
    candidateScope,
    effectiveCandidateTargetCount,
  );

  const selectedInsight =
    candidateInsights.find((insight) => insight.candidate.id === selectedCandidateId) ??
    candidateInsights[0] ??
    null;
  const {
    sections: nearbySections,
    status: nearbyPlacesStatus,
    error: nearbyPlacesError,
    message: nearbyPlacesMessage,
  } = useNearbyPlaces(selectedInsight?.candidate ?? null, selectedCategory);
  const nearbyMapPlaces =
    nearbySections.find((section) => section.key === activeNearbyCategory)?.items ?? [];

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

      setAddressResults(results.slice(0, 5));
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
      void addRoomParticipant({
        roomId: onlineRoom.id,
        participant: nextParticipant,
        userId: currentUserId || null,
      }).catch((error: Error) => {
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
      locationSource: locationMode,
      savedFriendId,
      createdBy: currentUserId || null,
    };

    setParticipants((current) => [...current, newParticipant]);

    if (onlineRoom) {
      void addRoomParticipant({
        roomId: onlineRoom.id,
        participant: newParticipant,
        userId: currentUserId || null,
      }).catch((error: Error) => {
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
    resetLocationDraft();
  };

  const handleRemoveParticipant = (id: string) => {
    setParticipants((current) => current.filter((participant) => participant.id !== id));

    if (onlineRoom) {
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

    onThrillLevelChange(level < 3 ? 3 : level);
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

  const handleDrawComplete = (winner: Candidate) => {
    setShowDrawer(false);

    if (onlineRoom) {
      void updateRoomSelection({
        roomId: onlineRoom.id,
        selectedCategory,
        selectedCandidate: winner,
      }).catch((error: Error) => {
        setRoomMessage(error.message);
      });
    }

    onComplete(winner, participants, selectedCategory);
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
    <div className="min-h-screen bg-[#fafaf8] pb-32">
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[#f0f0f0] bg-white/92 px-4 py-4 backdrop-blur-sm">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center"
        >
          <ChevronLeft className="h-6 w-6 text-[#1a1a2e]" />
        </button>
        <h2 className="text-lg text-[#1a1a2e]">약속 플래너</h2>
        <div className="w-10" />
      </div>

      <div className="mx-auto flex max-w-[1040px] flex-col gap-5 px-4 py-5 sm:gap-6 sm:py-6">
        {onlineRoom ? (
          <section className="rounded-2xl border border-[#e8edf3] bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm text-[#1a1a2e]">
                  <Wifi className="h-4 w-4 shrink-0 text-[#22c55e]" />
                  <span className="shrink-0">방 코드</span>
                  <span className="rounded-full bg-[#eef4ff] px-2.5 py-1 text-xs text-[#2d5aa7]">
                    {onlineRoom.code}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[#8a94a2]">
                  {participants.length}명 참여
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyRoomLink}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[#1f2a44] px-4 text-sm text-white transition-transform active:scale-95"
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
          <section className="relative flex items-center justify-between gap-3 rounded-2xl border border-[#e8edf3] bg-white px-4 py-3 shadow-sm">
            <div className="min-w-0 text-sm text-[#667085]">
              혼자 쓰는 중
            </div>
            <button
              type="button"
              onClick={() => {
                void handleCreateShareRoom();
              }}
              disabled={isOpeningRoom || isCreatingRoomFromPlanner}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[#1f2a44] px-4 text-sm text-white transition-transform active:scale-95 disabled:opacity-60"
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

        <div className="order-3 flex flex-col gap-3 rounded-2xl border border-[#ece4d8] bg-[#f5f1eb] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#ff7b6b]" />
            <span className="rounded-full bg-white px-3 py-1 text-xs text-[#1a1a2e] shadow-sm">
              {activeCategory.label}
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs text-[#1a1a2e] shadow-sm">
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
          <div className="order-3 space-y-4 rounded-2xl border border-[#e8edf3] bg-white p-4 shadow-sm">
            <section>
              <div className="mb-2 text-sm font-medium text-[#1a1a2e]">오늘의 모임</div>
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
                          ? 'bg-[#1f2a44] text-white shadow-sm'
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
              <div className="mb-2 text-sm font-medium text-[#1a1a2e]">선정 방식</div>
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
                <div className="grid grid-cols-2 gap-2">
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
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg text-[#1a1a2e]">사람 추가</h3>
              <p className="text-sm text-[#6b7280]">주소나 지도에서 출발 위치를 정해 주세요.</p>
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

          {!isGuestMode && savedFriends.length > 0 && (
            <div className="mb-4 rounded-3xl border border-[#eceff3] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-[#1a1a2e]">
                <Users className="h-4 w-4 text-[#2d3561]" />
                <span className="text-sm">저장된 친구</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {savedFriends.map((friend) => {
                  const alreadyAdded = isFriendAlreadyAdded(participants, friend);

                  return (
                    <div
                      key={friend.id}
                      className="rounded-2xl border border-[#edf2f5] bg-[#f8fbfd] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base text-[#1a1a2e]">{friend.name}</div>
                          <div className="mt-1 text-sm text-[#6b7280]">{friend.location}</div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleQuickAddSavedFriend(friend)}
                          disabled={alreadyAdded}
                          className="rounded-full bg-white px-3 py-1.5 text-xs text-[#1a1a2e] transition-transform active:scale-95 disabled:opacity-55"
                        >
                          {alreadyAdded ? '추가됨' : '바로 추가'}
                        </button>
                      </div>

                      <div className="hidden mt-3 text-xs text-[#9ca3af]">
                        최대 {friend.maxTravelTime}분 이동 가능
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {showAddForm && (
            <div className="mb-3 rounded-[1.75rem] border border-[#eceff3] bg-white p-5 shadow-sm">
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
                          placeholder="도로명, 건물명, 동네 이름"
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
                                  {result.roadAddress || result.title}
                                </div>
                                {result.jibunAddress && (
                                  <div className="mt-1 text-xs text-[#6b7280]">
                                    {result.jibunAddress}
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
          <section className="order-4 rounded-[1.75rem] border border-[#eceff3] bg-white/90 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base text-[#1a1a2e]">참여자 목록</h3>
                <p className="text-xs text-[#8a94a2]">원하지 않는 사람은 여기서 바로 뺄 수 있어요.</p>
              </div>
              <span className="rounded-full bg-[#f5f1eb] px-3 py-1 text-xs text-[#44505b]">
                {participants.length}명
              </span>
            </div>

            <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
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
          </section>
        )}

        <section className="order-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg text-[#1a1a2e]">
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
                className="h-10 rounded-full bg-[#f5f1eb] px-4 text-sm text-[#1a1a2e] transition-transform active:scale-95"
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
        <div className="rounded-[1.25rem] border border-[#eceff3] bg-white/94 p-3 shadow-[0_18px_40px_rgba(18,28,45,0.12)] backdrop-blur-xl">
          <div className="mb-3 space-y-3">
            <div className="rounded-xl bg-[#faf7f2] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-[#1a1a2e]">후보군 개수</div>
                  <div className="mt-1 text-xs text-[#6b7280]">
                    {candidateCountLimited
                      ? `가능 ${effectiveCandidateTargetCount}개 · 요청 ${activeCandidateTargetCount}개`
                      : `최대 ${activeCandidateTargetCount}개 · 현재 ${drawPool.length}개`}
                  </div>
                </div>
                <div className="rounded-full bg-white px-3 py-1 text-xs text-[#44505b] shadow-sm">
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
                className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-[#e7ded2] accent-[#ff7b6b]"
              />

              <div className="mt-3 grid grid-cols-5 gap-2 text-xs text-[#6b7280]">
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

          <div className="px-2 pb-2 text-xs text-[#6b7280]">
            {aiCandidateStatus === 'loading'
              ? 'AI가 후보를 정리하는 중이에요.'
              : drawPool.length
                ? `${drawPool.length}개의 후보 안에서 마지막 랜덤을 돌립니다.`
                : '먼저 참여자를 2명 이상 입력해 주세요.'}
          </div>

          <button
            type="button"
            onClick={() => setShowDrawer(true)}
            disabled={participants.length < 2 || !drawPool.length || aiCandidateStatus === 'loading'}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#ff7b6b] to-[#ffa59b] text-white shadow-lg transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
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
