import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BookmarkPlus,
  ChevronLeft,
  LoaderCircle,
  LocateFixed,
  Plus,
  Search,
  Settings2,
  Shuffle,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  Candidate,
  CandidateInsight,
  CandidateScopeKey,
  Coordinates,
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
import { NearbyPlacesPanel } from './NearbyPlacesPanel';

interface PlannerScreenProps {
  currentUserId: string;
  initialParticipants: Participant[];
  selectedCategory: MeetCategoryKey;
  onCategoryChange: (category: MeetCategoryKey) => void;
  selectionMode: SelectionModeKey;
  onSelectionModeChange: (mode: SelectionModeKey) => void;
  thrillLevel: ThrillLevel;
  onThrillLevelChange: (level: ThrillLevel) => void;
  candidateScope: CandidateScopeKey;
  onCandidateScopeChange: (scope: CandidateScopeKey) => void;
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

const candidateScopeSliderOptions: Array<{
  key: CandidateScopeKey;
  label: string;
  targetCount: number;
}> = [
  { key: 'standard', label: '적게', targetCount: 6 },
  { key: 'wide', label: '보통', targetCount: 8 },
  { key: 'max', label: '많게', targetCount: 10 },
];

function getCandidateScopeSliderValue(scope: CandidateScopeKey) {
  const index = candidateScopeSliderOptions.findIndex((option) => option.key === scope);
  return index >= 0 ? index : 1;
}

function getCandidateScopeKeyFromSlider(value: number): CandidateScopeKey {
  return candidateScopeSliderOptions[value]?.key ?? 'wide';
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
  initialParticipants,
  selectedCategory,
  onCategoryChange,
  selectionMode,
  onSelectionModeChange,
  thrillLevel,
  onThrillLevelChange,
  candidateScope,
  onCandidateScopeChange,
  onBack,
  onComplete,
}: PlannerScreenProps) {
  const participantSectionRef = useRef<HTMLElement | null>(null);

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
  const [activeNearbyCategory, setActiveNearbyCategory] = useState<NearbyPlaceCategory>(
    getDefaultNearbyCategory(selectedCategory),
  );
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

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
  const activeThrill =
    thrillStages.find((stage) => stage.level === thrillLevel) ?? thrillStages[0];
  const activeScope =
    candidateScopeOptions.find((scope) => scope.key === candidateScope) ?? candidateScopeOptions[0];
  const activeSliderScope =
    candidateScopeSliderOptions.find((scope) => scope.key === candidateScope) ??
    candidateScopeSliderOptions[1];

  const candidateUniverse = buildCandidateUniverse(
    participants,
    mockCandidates,
    selectedCategory,
    thrillLevel,
  );
  const allCandidateInsights = getCandidateInsights(participants, candidateUniverse, selectedCategory);
  const seedCandidateInsights = getDynamicCandidateInsights(
    participants,
    candidateUniverse,
    selectedCategory,
    selectionMode,
    thrillLevel,
    candidateScope,
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
    thrillLevel,
    candidateScope,
    effectiveRuntimeAiConfig,
    aiConfigSignature,
  );

  const aiCandidateInsights = sortInsightsByCandidateIds(allCandidateInsights, aiCandidateIds);
  const candidateInsights = aiCandidateInsights.length ? aiCandidateInsights : seedCandidateInsights;
  const { pool: drawPool, fallbackNotice } = getDrawPool(
    candidateInsights,
    selectionMode,
    thrillLevel,
    candidateScope,
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

    setParticipants((current) => [...current, createParticipantFromSavedFriend(friend)]);
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
      id: `${Date.now()}`,
      name: newName.trim(),
      location: locationMode === 'current' ? '현재 위치 기준' : newLocation,
      coordinates: newCoordinates,
      maxTravelTime: DEFAULT_MAX_TRAVEL_TIME,
      locationSource: locationMode,
      savedFriendId,
    };

    setParticipants((current) => [...current, newParticipant]);

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
  };

  const handleDrawComplete = (winner: Candidate) => {
    setShowDrawer(false);
    onComplete(winner, participants, selectedCategory);
  };

  const handleOpenParticipantForm = () => {
    setShowAddForm(true);

    window.requestAnimationFrame(() => {
      participantSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
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

      <div className="space-y-6 px-4 py-6">
        <section className="space-y-3">
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

          <div className="flex items-center justify-between gap-3">
            <div className="rounded-full bg-white px-4 py-2 text-xs text-[#44505b] shadow-sm">
              {participants.length}명 입력됨
            </div>

            <button
              type="button"
              onClick={handleOpenParticipantForm}
              className="inline-flex h-11 items-center justify-center rounded-full bg-[#1f2a44] px-5 text-sm text-white shadow-sm transition-transform active:scale-95"
            >
              사람 추가
            </button>
          </div>
        </section>

        <div className="flex items-center justify-between gap-3 rounded-3xl border border-[#ece4d8] bg-[#f5f1eb] px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[#1a1a2e]">
              <Sparkles className="h-4 w-4 text-[#ff7b6b]" />
              <span className="text-sm">핵심 옵션만 보고 바로 시작</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[#6b7280]">
              세부 설정은 필요할 때만 펼쳐서 볼 수 있어요.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedOptions((current) => !current)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm text-[#1a1a2e] shadow-sm transition-transform active:scale-95"
          >
            <Settings2 className="h-4 w-4" />
            {showAdvancedOptions ? '옵션 숨기기' : '옵션 보기'}
          </button>
        </div>

        {showAdvancedOptions && (
          <div className="space-y-6">
            <section>
              <div className="mb-4">
                <h3 className="mb-1 text-lg text-[#1a1a2e]">오늘의 모임</h3>
                <p className="text-sm text-[#6b7280]">분위기만 고르면 후보가 바로 달라집니다.</p>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {meetCategories.map((category) => {
                  const active = category.key === selectedCategory;

                  return (
                    <button
                      key={category.key}
                      type="button"
                      onClick={() => onCategoryChange(category.key)}
                      className={`rounded-2xl border p-4 text-left transition-all ${
                        active
                          ? 'scale-[1.01] border-[#2d3561] bg-white shadow-lg'
                          : 'border-[#eceff3] bg-white/75 shadow-sm'
                      }`}
                    >
                      <div className="mb-2 text-base text-[#1a1a2e]">{category.label}</div>
                      <p className="text-xs leading-relaxed text-[#6b7280]">{category.cue}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-4">
                <h3 className="mb-1 text-lg text-[#1a1a2e]">선정 방식</h3>
                <p className="text-sm text-[#6b7280]">안정적으로 고를지, 동네까지 섞을지 정해 주세요.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {selectionModes.map((mode) => {
                  const active = mode.key === selectionMode;

                  return (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => onSelectionModeChange(mode.key)}
                      className={`rounded-2xl border p-4 text-left transition-all ${
                        active
                          ? 'scale-[1.01] border-[#2d3561] bg-white shadow-lg'
                          : 'border-[#eceff3] bg-white/75 shadow-sm'
                      }`}
                    >
                      <div className="mb-2 text-base text-[#1a1a2e]">{mode.label}</div>
                      <p className="text-xs leading-relaxed text-[#6b7280]">{mode.description}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-4">
                <h3 className="mb-1 text-lg text-[#1a1a2e]">스릴 단계</h3>
                <p className="text-sm text-[#6b7280]">강하게 갈수록 더 의외의 장소가 섞입니다.</p>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {thrillStages.map((stage) => {
                  const active = stage.level === thrillLevel;

                  return (
                    <button
                      key={stage.level}
                      type="button"
                      onClick={() => onThrillLevelChange(stage.level)}
                      className={`rounded-2xl border p-4 text-left transition-all ${
                        active
                          ? 'scale-[1.01] border-[#2d3561] bg-white shadow-lg'
                          : 'border-[#eceff3] bg-white/75 shadow-sm'
                      }`}
                    >
                      <div className="mb-2 text-base text-[#1a1a2e]">{stage.label}</div>
                      <p className="text-xs leading-relaxed text-[#6b7280]">{stage.description}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-4">
                <h3 className="mb-1 text-lg text-[#1a1a2e]">후보 범위</h3>
                <p className="text-sm text-[#6b7280]">보여줄 후보 수를 더 넓히거나 좁힐 수 있어요.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {candidateScopeOptions.map((scope) => {
                  const active = scope.key === candidateScope;

                  return (
                    <button
                      key={scope.key}
                      type="button"
                      onClick={() => onCandidateScopeChange(scope.key)}
                      className={`rounded-2xl border p-4 text-left transition-all ${
                        active
                          ? 'scale-[1.01] border-[#2d3561] bg-white shadow-lg'
                          : 'border-[#eceff3] bg-white/75 shadow-sm'
                      }`}
                    >
                      <div className="mb-2 text-base text-[#1a1a2e]">{scope.label}</div>
                      <p className="text-xs leading-relaxed text-[#6b7280]">{scope.description}</p>
                    </button>
                  );
                })}
              </div>
            </section>

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

        <section ref={participantSectionRef}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg text-[#1a1a2e]">참여자 ({participants.length})</h3>
              <p className="text-sm text-[#6b7280]">주소 검색이나 현재 위치로 한 명씩 추가해 주세요.</p>
            </div>

            <button
              type="button"
              onClick={() => setShowAddForm((current) => !current)}
              className="flex items-center gap-1 text-sm text-[#2d3561]"
            >
              <Plus className="h-4 w-4" />
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

          {participants.length === 0 && !showAddForm && (
            <div className="mb-3 rounded-3xl border border-dashed border-[#d9e0e7] bg-white/80 px-5 py-8 text-center">
              <div className="text-base text-[#1a1a2e]">아직 추가된 사람이 없어요</div>
              <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">
                한 명씩 추가하면서 출발 위치를 잡아두면 바로 후보군을 만들 수 있어요.
              </p>
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-[#2d3561] px-5 text-sm text-white transition-transform active:scale-95"
              >
                첫 사람 추가
              </button>
            </div>
          )}

          <div className="space-y-3">
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

        <section>
          <div className="mb-4">
            <h3 className="mb-1 text-lg text-[#1a1a2e]">
              {activeCategory.label} 후보 지역 ({candidateInsights.length})
            </h3>
            <p className="text-sm text-[#6b7280]">{resolvedCandidateGuideText}</p>
            <button
              type="button"
              onClick={() => setShowCandidateList((current) => !current)}
              className="mt-3 inline-flex h-10 items-center justify-center rounded-full bg-[#f5f1eb] px-4 text-sm text-[#1a1a2e] transition-transform active:scale-95"
            >
              {showCandidateList ? '후보 숨기기' : '후보 보기'}
            </button>
          </div>

          {showCandidateList && (
            <div className="space-y-3">
              {candidateInsights.map((insight) => (
                <CandidateCard
                  key={insight.candidate.id}
                  insight={insight}
                  selected={selectedInsight?.candidate.id === insight.candidate.id}
                  onClick={() => setSelectedCandidateId(insight.candidate.id)}
                  selectedCategory={selectedCategory}
                  selectionMode={selectionMode}
                />
              ))}
            </div>
          )}

          {selectedInsight && (
            <div className="mt-4">
              <NearbyPlacesPanel
                candidate={selectedInsight.candidate}
                sections={nearbySections}
                activeCategory={activeNearbyCategory}
                onCategoryChange={setActiveNearbyCategory}
                status={nearbyPlacesStatus}
                message={nearbyPlacesMessage}
                error={nearbyPlacesError}
              />
            </div>
          )}
        </section>
      </div>

      <div className="px-4 pb-8">
        <div className="rounded-[1.75rem] border border-[#eceff3] bg-white/92 p-3 shadow-[0_18px_40px_rgba(18,28,45,0.12)] backdrop-blur-xl">
          <div className="mb-3 rounded-2xl bg-[#faf7f2] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm text-[#1a1a2e]">후보군 개수</div>
                <div className="mt-1 text-xs text-[#6b7280]">
                  지금은 {drawPool.length}개 후보로 랜덤을 돌려요.
                </div>
              </div>
              <div className="rounded-full bg-white px-3 py-1 text-xs text-[#44505b] shadow-sm">
                {activeSliderScope.targetCount}개 기준
              </div>
            </div>

            <input
              type="range"
              min={0}
              max={candidateScopeSliderOptions.length - 1}
              step={1}
              value={getCandidateScopeSliderValue(candidateScope)}
              onChange={(event) =>
                onCandidateScopeChange(getCandidateScopeKeyFromSlider(Number(event.target.value)))
              }
              className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-[#e7ded2] accent-[#ff7b6b]"
            />

            <div className="mt-3 flex items-center justify-between text-xs text-[#6b7280]">
              {candidateScopeSliderOptions.map((scope) => (
                <button
                  key={scope.key}
                  type="button"
                  onClick={() => onCandidateScopeChange(scope.key)}
                  className={`rounded-full px-2 py-1 transition-colors ${
                    scope.key === candidateScope ? 'bg-white text-[#1a1a2e] shadow-sm' : ''
                  }`}
                >
                  {scope.label}
                </button>
              ))}
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
          modeLabel={`${activeMode.shortLabel} · ${activeThrill.label} · ${activeScope.label}`}
          selectionMode={selectionMode}
          thrillLevel={thrillLevel}
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
