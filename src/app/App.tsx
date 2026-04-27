import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { HomeScreen } from './components/HomeScreen';
import { PlannerScreen } from './components/PlannerScreen';
import { ResultScreen } from './components/ResultScreen';
import { AuthMode, AuthSheet } from './components/AuthSheet';
import { ProfileSheet } from './components/ProfileSheet';
import {
  AuthUser,
  ProfileSettingsInput,
  loadSessionUser,
  signOut,
  subscribeToAuthChanges,
  updateProfileSettings,
} from './lib/auth';
import {
  createMeetingRoom,
  deleteOwnedMeetingRoom,
  deleteOwnedMeetingRooms,
  getCurrentRoomActorIds,
  getParticipantActorKey,
  getRedrawRequiredVotes,
  loadMeetingRoomByCode,
  loadRoomParticipants,
  loadOwnedMeetingRooms,
  requestRoomRedrawVote,
  resetRoomSelection,
  subscribeToRoomState,
} from './lib/rooms';
import {
  Candidate,
  DrawProof,
  MeetingRoom,
  MeetCategoryKey,
  Participant,
  SelectionModeKey,
  ThrillLevel,
  WinnerRouteSnapshot,
} from './types';

type Screen = 'home' | 'planner' | 'result';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

function isStandaloneApp() {
  if (typeof window === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  );
}

function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    setIsInstalled(isStandaloneApp());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
      setGuideOpen(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      setGuideOpen(true);
      return;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;

    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
    }

    setDeferredPrompt(null);
  };

  if (isInstalled) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void handleInstallClick();
        }}
        className="fixed left-4 top-4 z-50 inline-flex h-11 items-center gap-2 rounded-full border border-white/80 bg-white/92 px-4 text-sm font-extrabold tracking-[-0.03em] text-[#1f2a44] shadow-[0_12px_30px_rgba(26,26,46,0.14)] backdrop-blur-md transition-transform active:scale-95"
        aria-label="KoK 앱 설치"
      >
        <Download className="h-4 w-4" />
        설치
      </button>

      {guideOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#1f2a44]/30 px-4 pb-4 backdrop-blur-sm sm:items-center sm:pb-0">
          <section className="w-full max-w-[420px] rounded-[1.75rem] bg-white p-6 text-[#1f2a44] shadow-[0_30px_80px_rgba(26,26,46,0.24)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-[#ff7468]">KoK 설치</p>
                <h2 className="mt-1 text-2xl font-black tracking-[-0.06em]">앱처럼 열기</h2>
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f5f1eb] text-[#1f2a44]"
                aria-label="설치 안내 닫기"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 space-y-3 text-base font-semibold leading-relaxed tracking-[-0.04em] text-[#666b78]">
              <p>Chrome/Edge에서는 주소창의 설치 아이콘이나 브라우저 메뉴의 “앱 설치”를 누르면 돼요.</p>
              <p>iPhone은 Safari 공유 버튼에서 “홈 화면에 추가”를 선택하면 됩니다.</p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function getActionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        window.clearTimeout(timeoutId);
      });
  });
}

function getRoomCodeFromUrl() {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() ?? '';
}

function getAuthUserSignature(user: AuthUser | null) {
  if (!user) {
    return '';
  }

  return JSON.stringify({
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    loginId: user.loginId,
    email: user.email,
    gender: user.gender,
    preferences: user.preferences,
    homeLocation: user.homeLocation,
  });
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

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signup');
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeRoom, setActiveRoom] = useState<MeetingRoom | null>(null);
  const [ownedRooms, setOwnedRooms] = useState<MeetingRoom[]>([]);
  const [isLoadingOwnedRooms, setIsLoadingOwnedRooms] = useState(false);
  const [deletingRoomIds, setDeletingRoomIds] = useState<string[]>([]);
  const [ownedRoomsError, setOwnedRoomsError] = useState<string | null>(null);
  const [isOpeningRoom, setIsOpeningRoom] = useState(false);
  const [isRequestingRedraw, setIsRequestingRedraw] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [selectedWinner, setSelectedWinner] = useState<Candidate | null>(null);
  const [selectedRouteSnapshot, setSelectedRouteSnapshot] =
    useState<WinnerRouteSnapshot | null>(null);
  const [drawProof, setDrawProof] = useState<DrawProof | null>(null);
  const [currentParticipants, setCurrentParticipants] = useState<Participant[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<MeetCategoryKey>('dining');
  const [selectionMode, setSelectionMode] = useState<SelectionModeKey>('balance');
  const [thrillLevel, setThrillLevel] = useState<ThrillLevel>(1);
  const currentUserSignatureRef = useRef('');
  const handledInviteCodeRef = useRef('');

  const setCurrentUserIfChanged = (user: AuthUser | null) => {
    const nextSignature = getAuthUserSignature(user);

    if (currentUserSignatureRef.current === nextSignature) {
      return;
    }

    currentUserSignatureRef.current = nextSignature;
    setCurrentUser(user);
  };

  useEffect(() => {
    let mounted = true;

    loadSessionUser()
      .then((user) => {
        if (mounted) {
          setCurrentUserIfChanged(user);
        }
      })
      .catch(() => {
        if (mounted) {
          setCurrentUserIfChanged(null);
        }
      })
      .finally(() => {
        if (mounted) {
          setIsAuthReady(true);
        }
      });

    const unsubscribe = subscribeToAuthChanges((user) => {
      if (mounted) {
        setCurrentUserIfChanged(user);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const refreshOwnedRooms = async (userId = currentUser?.id ?? '') => {
    if (!userId) {
      setOwnedRooms([]);
      setOwnedRoomsError(null);
      return;
    }

    setIsLoadingOwnedRooms(true);
    setOwnedRoomsError(null);

    try {
      const rooms = await withTimeout(
        loadOwnedMeetingRooms(userId),
        7000,
        '기존 방 목록 응답이 지연되고 있어요.',
      );

      setOwnedRooms(rooms);
    } catch (error) {
      setOwnedRooms([]);
      setOwnedRoomsError(getActionErrorMessage(error, '기존 방 목록을 불러오지 못했어요.'));
    } finally {
      setIsLoadingOwnedRooms(false);
    }
  };

  useEffect(() => {
    if (!currentUser) {
      setOwnedRooms([]);
      setOwnedRoomsError(null);
      return;
    }

    void refreshOwnedRooms(currentUser.id);
  }, [currentUser?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!isAuthReady) {
      return;
    }

    const code = getRoomCodeFromUrl();

    if (!code) {
      return;
    }

    if (!currentUser) {
      handledInviteCodeRef.current = '';
      setCurrentScreen('home');
      setRoomError('초대 링크로 들어왔어요. 회원가입 또는 로그인하면 바로 방에 참여해요.');
      setAuthMode('signup');
      setAuthOpen(true);
      return;
    }

    if (handledInviteCodeRef.current === code) {
      return;
    }

    handledInviteCodeRef.current = code;

    setIsOpeningRoom(true);
    setRoomError(null);

    withTimeout(
      loadMeetingRoomByCode(code),
      7000,
      '방 정보를 불러오는 응답이 지연되고 있어요.',
    )
      .then(async (room) => {
        if (!room) {
          setRoomError('찾을 수 없는 약속방이에요.');
          setCurrentScreen('home');
          return;
        }

        const roomParticipants = await withTimeout(
          loadRoomParticipants(room.id),
          7000,
          '참가자 목록 응답이 지연되고 있어요.',
        ).catch(() => [] as Participant[]);

        setActiveRoom(room);
        setSelectedCategory(room.selectedCategory);
        setSelectionMode(room.selectionMode);
        setThrillLevel(room.thrillLevel);
        setCurrentParticipants(roomParticipants);
        setCurrentScreen('planner');
      })
      .catch((error: Error) => {
        setRoomError(error.message);
      })
      .finally(() => {
        setIsOpeningRoom(false);
      });
  }, [currentUser?.id, isAuthReady]);

  useEffect(() => {
    if (!activeRoom || currentScreen !== 'result') {
      return;
    }

    let active = true;

    const applyRoomUpdate = (room: MeetingRoom) => {
      if (!active) {
        return;
      }

      setActiveRoom((current) =>
        getMeetingRoomSignature(current) === getMeetingRoomSignature(room) ? current : room,
      );

      if (room.status === 'planning' && !room.selectedCandidate) {
        setSelectedWinner(null);
        setSelectedRouteSnapshot(null);
        setDrawProof(null);
        setCurrentScreen('planner');
      }

      if (room.status === 'decided' && room.selectedCandidate) {
        setSelectedWinner(room.selectedCandidate);
        setSelectedCategory(room.selectedCategory);
        setSelectionMode(room.selectionMode);
        setThrillLevel(room.thrillLevel);
        setSelectedRouteSnapshot(room.selectedRouteSnapshot ?? null);
      }
    };

    const syncResultRoom = () => {
      void loadMeetingRoomByCode(activeRoom.code)
        .then((room) => {
          if (!room) {
            return;
          }

          applyRoomUpdate(room);
        })
        .catch(() => {
          // 결과 화면에서는 일시적인 동기화 실패로 사용자를 튕기지 않는다.
        });
    };

    syncResultRoom();
    const unsubscribe = subscribeToRoomState(activeRoom.id, applyRoomUpdate);
    const intervalId = window.setInterval(syncResultRoom, 2500);

    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, [activeRoom?.code, activeRoom?.id, currentScreen]);

  const syncRoomUrl = (room: MeetingRoom | null) => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);

    if (room) {
      url.searchParams.set('room', room.code);
    } else {
      url.searchParams.delete('room');
    }

    window.history.replaceState({}, '', url.toString());
  };

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const openProfile = () => {
    if (!currentUser) {
      openAuth('login');
      return;
    }

    setProfileOpen(true);
  };

  const openOnlineRoom = async ({
    ownerId,
    timeoutMessage = '온라인 방 생성 응답이 지연되고 있어요.',
    fallbackMessage = '온라인 방을 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
  }: {
    ownerId: string | null;
    timeoutMessage?: string;
    fallbackMessage?: string;
  }) => {
    setIsOpeningRoom(true);
    setRoomError(null);
    setCurrentParticipants([]);
    setSelectedWinner(null);
    setSelectedRouteSnapshot(null);
    setDrawProof(null);
    setActiveRoom(null);
    syncRoomUrl(null);

    try {
      const room = await withTimeout(
        createMeetingRoom({
          ownerId,
          selectedCategory,
          selectionMode,
          thrillLevel,
        }),
        7000,
        timeoutMessage,
      );

      setActiveRoom(room);
      syncRoomUrl(room);
      setRoomError(null);
      setCurrentScreen('planner');
      void refreshOwnedRooms(ownerId ?? undefined);
    } catch (error) {
      setActiveRoom(null);
      syncRoomUrl(null);
      setRoomError(getActionErrorMessage(error, fallbackMessage));
      setCurrentScreen('home');
    } finally {
      setIsOpeningRoom(false);
    }
  };

  const handleContinueAsGuest = () => {
    setActiveRoom(null);
    syncRoomUrl(null);
    setCurrentParticipants([]);
    setCurrentScreen('planner');
  };

  const handleCreateRoomFromHome = () => {
    if (!currentUser) {
      openAuth('login');
      return;
    }

    void openOnlineRoom({
      ownerId: currentUser.id,
    });
  };

  const handleOpenExistingRoom = (room: MeetingRoom) => {
    void handleJoinRoom(room.code);
  };

  const handleDeleteExistingRoom = async (room: MeetingRoom) => {
    if (!currentUser) {
      openAuth('login');
      return;
    }

    const memberCount = room.memberCount ?? room.members?.length ?? 0;
    const confirmed = window.confirm(
      memberCount > 1
        ? `${room.code} 방에서 나갈까요? 다른 사람이 남아 있으면 방은 유지됩니다.`
        : `${room.code} 방을 삭제할까요? 남은 사람이 없으면 방이 삭제됩니다.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingRoomIds([room.id]);
    setOwnedRoomsError(null);

    try {
      await withTimeout(
        deleteOwnedMeetingRoom({
          roomId: room.id,
          ownerId: currentUser.id,
        }),
        7000,
        '방 삭제 응답이 지연되고 있어요.',
      );

      setOwnedRooms((current) => current.filter((item) => item.id !== room.id));
    } catch (error) {
      setOwnedRoomsError(getActionErrorMessage(error, '방을 정리하지 못했어요.'));
    } finally {
      setDeletingRoomIds([]);
    }
  };

  const handleDeleteExistingRooms = async (rooms: MeetingRoom[]) => {
    if (!currentUser) {
      openAuth('login');
      return;
    }

    const targetRooms = rooms;

    if (!targetRooms.length) {
      setOwnedRoomsError('정리할 수 있는 방이 없어요.');
      return;
    }

    const confirmed = window.confirm(
      `${targetRooms.length}개 방을 정리할까요? 다른 사람이 남아 있는 방은 나가기로 처리됩니다.`,
    );

    if (!confirmed) {
      return;
    }

    const targetRoomIds = targetRooms.map((room) => room.id);
    setDeletingRoomIds(targetRoomIds);
    setOwnedRoomsError(null);

    try {
      await withTimeout(
        deleteOwnedMeetingRooms({
          roomIds: targetRoomIds,
          ownerId: currentUser.id,
        }),
        7000,
        '방 삭제 응답이 지연되고 있어요.',
      );

      setOwnedRooms((current) => current.filter((item) => !targetRoomIds.includes(item.id)));
    } catch (error) {
      setOwnedRoomsError(getActionErrorMessage(error, '선택한 방을 정리하지 못했어요.'));
    } finally {
      setDeletingRoomIds([]);
    }
  };

  const handleJoinRoom = async (code: string) => {
    const normalizedCode = code.trim().toUpperCase();

    if (!normalizedCode) {
      setRoomError('방 코드를 입력해 주세요.');
      return;
    }

    setIsOpeningRoom(true);
    setRoomError(null);

    try {
      const room = await withTimeout(
        loadMeetingRoomByCode(normalizedCode),
        7000,
        '방 입장 응답이 지연되고 있어요.',
      );

      if (!room) {
        setRoomError('찾을 수 없는 약속방이에요.');
        return;
      }

      const roomParticipants = await withTimeout(
        loadRoomParticipants(room.id),
        7000,
        '참가자 목록 응답이 지연되고 있어요.',
      ).catch(() => [] as Participant[]);

      setActiveRoom(room);
      syncRoomUrl(room);
      setSelectedCategory(room.selectedCategory);
      setSelectionMode(room.selectionMode);
      setThrillLevel(room.thrillLevel);
      setCurrentParticipants(roomParticipants);
      setSelectedWinner(null);
      setSelectedRouteSnapshot(null);
      setDrawProof(null);
      setCurrentScreen('planner');
    } catch (error) {
      setRoomError(getActionErrorMessage(error, '약속방에 들어가지 못했어요.'));
    } finally {
      setIsOpeningRoom(false);
    }
  };

  const handlePlannerComplete = (
    winner: Candidate,
    participants: Participant[],
    category: MeetCategoryKey,
    proof?: DrawProof | null,
    routeSnapshot?: WinnerRouteSnapshot | null,
  ) => {
    setSelectedWinner(winner);
    setSelectedRouteSnapshot(routeSnapshot ?? null);
    setDrawProof(proof ?? null);
    setCurrentParticipants(participants);
    setSelectedCategory(category);
    setCurrentScreen('result');
  };

  const currentRoomActorIds = activeRoom
    ? getCurrentRoomActorIds({
        roomId: activeRoom.id,
        currentUserId: currentUser?.id ?? '',
        participants: currentParticipants,
      })
    : [];
  const roomParticipantActorIds = activeRoom
    ? [...new Set(currentParticipants.map((participant) => getParticipantActorKey(participant)))]
    : [];
  const currentRoomVoterId = currentRoomActorIds[0] ?? null;
  const redrawRequiredVotes = activeRoom
    ? getRedrawRequiredVotes(roomParticipantActorIds.length)
    : 0;
  const redrawVoteCount = activeRoom
    ? activeRoom.redrawVotes.filter((voteId) => roomParticipantActorIds.includes(voteId)).length
    : 0;
  const isSoloOnlineResult = Boolean(
    activeRoom && roomParticipantActorIds.length > 0 && roomParticipantActorIds.length === 1,
  );
  const hasRedrawMajority = activeRoom
    ? isSoloOnlineResult || redrawVoteCount >= redrawRequiredVotes
    : true;
  const hasRequestedRedraw = activeRoom
    ? activeRoom.redrawVotes.some((voteId) => currentRoomActorIds.includes(voteId))
    : false;
  const canControlCurrentRoomDraw =
    !activeRoom ||
    isSoloOnlineResult ||
    Boolean(currentRoomVoterId) ||
    !activeRoom.ownerId ||
    activeRoom.ownerId === currentUser?.id;

  const handleRequestRedrawVote = async () => {
    if (!activeRoom) {
      return;
    }

    if (!currentRoomVoterId) {
      setRoomError('방에 참여한 사람만 다시뽑기를 요청할 수 있어요.');
      return;
    }

    setIsRequestingRedraw(true);
    setRoomError(null);

    try {
      const room = await withTimeout(
        requestRoomRedrawVote({
          room: activeRoom,
          voterId: currentRoomVoterId,
        }),
        5000,
        '다시뽑기 동의 응답이 지연되고 있어요.',
      );

      setActiveRoom(room);
    } catch (error) {
      setRoomError(getActionErrorMessage(error, '다시뽑기 동의를 반영하지 못했어요.'));
    } finally {
      setIsRequestingRedraw(false);
    }
  };

  const handleBackToPlanner = () => {
    const roomToReset = activeRoom;

    if (roomToReset) {
      if (roomToReset.status === 'decided') {
        if (!hasRedrawMajority) {
          void handleRequestRedrawVote();
          return;
        }

        if (!canControlCurrentRoomDraw) {
          setRoomError('과반 동의는 완료됐고, 참여자가 다시뽑기를 열 수 있어요.');
          return;
        }
      }

      const optimisticRoom = {
        ...roomToReset,
        selectedCandidate: null,
        selectedCategory,
        selectionMode,
        thrillLevel,
        status: 'planning' as const,
        drawControllerId: null,
        drawReadyIds: roomToReset.status === 'decided' ? roomToReset.drawReadyIds : [],
        redrawVotes: [],
        redrawRequestedAt: null,
        updatedAt: new Date().toISOString(),
      };

      setActiveRoom(optimisticRoom);
      setIsRequestingRedraw(true);
      setRoomError(null);

      void withTimeout(
        resetRoomSelection({
          roomId: roomToReset.id,
          selectedCategory,
          selectionMode,
          thrillLevel,
          preserveReadiness: roomToReset.status === 'decided',
        }),
        5000,
        '방 상태를 초기화하는 응답이 지연되고 있어요.',
      )
        .then((room) => {
          setActiveRoom(room);
          setSelectedWinner(null);
          setSelectedRouteSnapshot(null);
          setDrawProof(null);
          setCurrentScreen('planner');
        })
        .catch((error) => {
          setActiveRoom(roomToReset);
          setRoomError(getActionErrorMessage(error, '방 상태를 다시 연결하지 못했어요.'));
        })
        .finally(() => {
          setIsRequestingRedraw(false);
        });
      return;
    }

    setSelectedWinner(null);
    setSelectedRouteSnapshot(null);
    setDrawProof(null);
    setCurrentScreen('planner');
  };

  const handleBack = () => {
    if (currentScreen === 'planner') {
      setActiveRoom(null);
      syncRoomUrl(null);
      setCurrentScreen('home');
      return;
    }

    if (currentScreen === 'result') {
      handleBackToPlanner();
    }
  };

  const handleGoHome = () => {
    setActiveRoom(null);
    setSelectedWinner(null);
    setSelectedRouteSnapshot(null);
    setDrawProof(null);
    setCurrentParticipants([]);
    setRoomError(null);
    syncRoomUrl(null);
    setCurrentScreen('home');
  };

  const handleAuthSuccess = (user: AuthUser) => {
    setCurrentUserIfChanged(user);
    setAuthOpen(false);

    if (activeRoom) {
      void refreshOwnedRooms(user.id);
      return;
    }

    const roomCodeFromUrl = getRoomCodeFromUrl();

    if (roomCodeFromUrl) {
      handledInviteCodeRef.current = roomCodeFromUrl;
      void handleJoinRoom(roomCodeFromUrl);
      void refreshOwnedRooms(user.id);
      return;
    }

    if (authMode === 'login') {
      setCurrentScreen('home');
      void refreshOwnedRooms(user.id);
      return;
    }

    void openOnlineRoom({
      ownerId: user.id,
      timeoutMessage: '로그인 후 방을 만드는 응답이 지연되고 있어요.',
      fallbackMessage: '로그인은 됐지만 온라인 방을 만들지 못했어요. 잠시 후 다시 로그인해 주세요.',
    });
  };

  const handleSignOut = () => {
    void signOut();
    setCurrentUserIfChanged(null);
    setProfileOpen(false);
    setCurrentScreen('home');
  };

  const handleProfileSave = async (input: ProfileSettingsInput) => {
    if (!currentUser) {
      return { error: '로그인이 필요해요.' };
    }

    const result = await updateProfileSettings(currentUser, input);

    if (result.user) {
      setCurrentUserIfChanged(result.user);
    }

    return result;
  };

  return (
    <div className="min-h-screen w-full bg-[#f5f1eb] text-[#1f2a44]">
      {currentScreen === 'home' && <InstallAppButton />}

      {currentScreen === 'home' && (
        <HomeScreen
          currentUser={currentUser}
          onContinueAsGuest={handleContinueAsGuest}
          onCreateRoom={handleCreateRoomFromHome}
          createdRooms={ownedRooms}
          isLoadingCreatedRooms={isLoadingOwnedRooms}
          createdRoomsError={ownedRoomsError}
          deletingRoomIds={deletingRoomIds}
          onRefreshRooms={() => {
            void refreshOwnedRooms();
          }}
          onOpenExistingRoom={handleOpenExistingRoom}
          onDeleteExistingRoom={handleDeleteExistingRoom}
          onDeleteExistingRooms={handleDeleteExistingRooms}
          onJoinRoom={handleJoinRoom}
          onOpenAuth={openAuth}
          onOpenProfile={openProfile}
          onSignOut={handleSignOut}
          isOpeningRoom={isOpeningRoom}
          roomError={roomError}
        />
      )}

      {currentScreen === 'planner' && (
        <PlannerScreen
          currentUserId={currentUser?.id ?? ''}
          currentUserName={currentUser?.name ?? '게스트'}
          currentUserAvatarUrl={currentUser?.avatarUrl ?? null}
          currentUserGender={currentUser?.gender ?? 'unspecified'}
          currentUserHomeLocation={currentUser?.homeLocation ?? null}
          onlineRoom={activeRoom}
          onOpenProfile={currentUser ? openProfile : undefined}
          initialParticipants={currentParticipants}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          thrillLevel={thrillLevel}
          onThrillLevelChange={setThrillLevel}
          onBack={handleBack}
          onComplete={handlePlannerComplete}
        />
      )}

      {currentScreen === 'result' && selectedWinner && (
        <ResultScreen
          winner={selectedWinner}
          participants={currentParticipants}
          selectedCategory={selectedCategory}
          selectionMode={selectionMode}
          currentUser={currentUser}
          routeSnapshot={selectedRouteSnapshot ?? activeRoom?.selectedRouteSnapshot ?? null}
          redrawControl={
            activeRoom
              ? {
                  isOnlineRoom: true,
                  voteCount: redrawVoteCount,
                  requiredVotes: redrawRequiredVotes,
                  hasRequested: hasRequestedRedraw,
                  hasMajority: hasRedrawMajority,
                  canReset: hasRedrawMajority && canControlCurrentRoomDraw,
                  isBusy: isRequestingRedraw,
                  message: roomError,
                  onRequest: handleRequestRedrawVote,
                }
              : null
          }
          onBack={handleBackToPlanner}
          onNewDraw={handleBackToPlanner}
          onHome={handleGoHome}
        />
      )}

      <AuthSheet
        open={authOpen}
        mode={authMode}
        onModeChange={setAuthMode}
        onClose={() => {
          setAuthOpen(false);
        }}
        onSuccess={handleAuthSuccess}
      />
      <ProfileSheet
        open={profileOpen}
        currentUser={currentUser}
        onClose={() => setProfileOpen(false)}
        onSave={handleProfileSave}
      />
    </div>
  );
}
