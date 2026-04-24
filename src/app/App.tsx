import { useEffect, useState } from 'react';
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
  addRoomParticipant,
  createMeetingRoom,
  getCurrentRoomActorIds,
  getRedrawRequiredVotes,
  loadMeetingRoomByCode,
  rememberLocalRoomParticipant,
  requestRoomRedrawVote,
  resetRoomSelection,
} from './lib/rooms';
import {
  Candidate,
  CandidateScopeKey,
  DrawProof,
  MeetingRoom,
  MeetCategoryKey,
  Participant,
  SelectionModeKey,
  ThrillLevel,
} from './types';

type Screen = 'home' | 'planner' | 'result';

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

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signup');
  const [authRedirectToPlanner, setAuthRedirectToPlanner] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeRoom, setActiveRoom] = useState<MeetingRoom | null>(null);
  const [isOpeningRoom, setIsOpeningRoom] = useState(false);
  const [isRequestingRedraw, setIsRequestingRedraw] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [selectedWinner, setSelectedWinner] = useState<Candidate | null>(null);
  const [drawProof, setDrawProof] = useState<DrawProof | null>(null);
  const [currentParticipants, setCurrentParticipants] = useState<Participant[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<MeetCategoryKey>('dining');
  const [selectionMode, setSelectionMode] = useState<SelectionModeKey>('balance');
  const [thrillLevel, setThrillLevel] = useState<ThrillLevel>(2);
  const [candidateScope, setCandidateScope] = useState<CandidateScopeKey>('wide');
  const [candidateTargetCount, setCandidateTargetCount] = useState(10);

  useEffect(() => {
    let mounted = true;

    loadSessionUser().then((user) => {
      if (mounted) {
        setCurrentUser(user);
      }
    });

    const unsubscribe = subscribeToAuthChanges((user) => {
      if (mounted) {
        setCurrentUser(user);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const code = new URLSearchParams(window.location.search).get('room');

    if (!code) {
      return;
    }

    setIsOpeningRoom(true);
    setRoomError(null);

    withTimeout(
      loadMeetingRoomByCode(code),
      7000,
      '방 정보를 불러오는 응답이 지연되고 있어요.',
    )
      .then((room) => {
        if (!room) {
          setRoomError('찾을 수 없는 약속방이에요.');
          setCurrentScreen('home');
          return;
        }

        setActiveRoom(room);
        setSelectedCategory(room.selectedCategory);
        setCurrentParticipants([]);
        setCurrentScreen('planner');
      })
      .catch((error: Error) => {
        setRoomError(error.message);
      })
      .finally(() => {
        setIsOpeningRoom(false);
      });
  }, []);

  useEffect(() => {
    if (!activeRoom || currentScreen !== 'result') {
      return;
    }

    let active = true;

    const syncResultRoom = () => {
      void loadMeetingRoomByCode(activeRoom.code)
        .then((room) => {
          if (!active || !room) {
            return;
          }

          setActiveRoom(room);

          if (room.status === 'planning' && !room.selectedCandidate) {
            setSelectedWinner(null);
            setDrawProof(null);
            setCurrentScreen('planner');
          }
        })
        .catch(() => {
          // 결과 화면에서는 일시적인 동기화 실패로 사용자를 튕기지 않는다.
        });
    };

    syncResultRoom();
    const intervalId = window.setInterval(syncResultRoom, 2500);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [activeRoom?.code, currentScreen]);

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

  const openAuth = (mode: AuthMode, redirectToPlanner = false) => {
    setAuthMode(mode);
    setAuthRedirectToPlanner(redirectToPlanner);
    setAuthOpen(true);
  };

  const openProfile = () => {
    if (!currentUser) {
      openAuth('login');
      return;
    }

    setProfileOpen(true);
  };

  const handleCreateRoom = () => {
    setIsOpeningRoom(true);
    setRoomError(null);
    setCurrentParticipants([]);
    setActiveRoom(null);
    syncRoomUrl(null);

    void withTimeout(
      createMeetingRoom({
        ownerId: currentUser?.id ?? null,
        selectedCategory,
      }),
      7000,
      '온라인 방 생성 응답이 지연되고 있어요.',
    )
      .then((room) => {
        setActiveRoom(room);
        syncRoomUrl(room);
        setRoomError(null);
        setCurrentScreen('planner');
      })
      .catch((error) => {
        setActiveRoom(null);
        syncRoomUrl(null);
        setRoomError(
          getActionErrorMessage(error, '온라인 방을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'),
        );
      })
      .finally(() => {
        setIsOpeningRoom(false);
      });
  };

  const handleCreateRoomFromPlanner = async (participants: Participant[]) => {
    setIsOpeningRoom(true);
    setRoomError(null);

    try {
      const room = await withTimeout(
        createMeetingRoom({
          ownerId: currentUser?.id ?? null,
          selectedCategory,
        }),
        7000,
        '공유 방 생성 응답이 지연되고 있어요.',
      );

      await Promise.all(
        participants.map((participant) => {
          rememberLocalRoomParticipant(room.id, participant.id);

          return addRoomParticipant({
            roomId: room.id,
            participant,
            userId: currentUser?.id ?? null,
          });
        }),
      );

      setActiveRoom(room);
      syncRoomUrl(room);
    } catch (error) {
      setRoomError(getActionErrorMessage(error, '공유 방을 만들지 못했어요.'));
      throw error;
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

      setActiveRoom(room);
      syncRoomUrl(room);
      setSelectedCategory(room.selectedCategory);
      setCurrentParticipants([]);
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
  ) => {
    setSelectedWinner(winner);
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
  const currentRoomVoterId = currentRoomActorIds[0] ?? null;
  const redrawRequiredVotes = activeRoom
    ? getRedrawRequiredVotes(currentParticipants.length)
    : 0;
  const redrawVoteCount = activeRoom?.redrawVotes.length ?? 0;
  const hasRedrawMajority = activeRoom
    ? redrawVoteCount >= redrawRequiredVotes
    : true;
  const hasRequestedRedraw = activeRoom
    ? activeRoom.redrawVotes.some((voteId) => currentRoomActorIds.includes(voteId))
    : false;
  const canControlCurrentRoomDraw =
    !activeRoom ||
    (activeRoom.drawControllerId
      ? currentRoomActorIds.includes(activeRoom.drawControllerId)
      : !activeRoom.ownerId || activeRoom.ownerId === currentUser?.id);

  const handleRequestRedrawVote = async () => {
    if (!activeRoom) {
      return;
    }

    if (!currentRoomVoterId) {
      setRoomError('다시뽑기 동의 전에 내 위치를 먼저 방에 추가해 주세요.');
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
          setRoomError('과반 동의는 완료됐고, 추첨 담당자만 다시뽑기를 열 수 있어요.');
          return;
        }
      }

      const optimisticRoom = {
        ...roomToReset,
        selectedCandidate: null,
        status: 'planning' as const,
        redrawVotes: [],
        redrawRequestedAt: null,
        updatedAt: new Date().toISOString(),
      };

      setActiveRoom(optimisticRoom);

      void withTimeout(
        resetRoomSelection({
          roomId: roomToReset.id,
          selectedCategory,
        }),
        5000,
        '방 상태를 초기화하는 응답이 지연되고 있어요.',
      )
        .then((room) => {
          setActiveRoom(room);
        })
        .catch(() => {
          setActiveRoom(optimisticRoom);
        })
        .finally(() => {
          setSelectedWinner(null);
          setDrawProof(null);
          setCurrentScreen('planner');
        });
      return;
    }

    setSelectedWinner(null);
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

  const handleAuthSuccess = (user: AuthUser) => {
    setCurrentUser(user);
    setAuthOpen(false);

    if (authRedirectToPlanner) {
      setCurrentParticipants([]);
      setActiveRoom(null);
      syncRoomUrl(null);
      setCurrentScreen('planner');
      setAuthRedirectToPlanner(false);
    }
  };

  const handleSignOut = () => {
    void signOut();
    setCurrentUser(null);
    setProfileOpen(false);
    setCurrentScreen('home');
  };

  const handleProfileSave = async (input: ProfileSettingsInput) => {
    if (!currentUser) {
      return { error: '로그인이 필요해요.' };
    }

    const result = await updateProfileSettings(currentUser, input);

    if (result.user) {
      setCurrentUser(result.user);
    }

    return result;
  };

  return (
    <div className="min-h-screen w-full bg-[#f5f1eb] text-[#1f2a44]">
      {currentScreen === 'home' && (
        <HomeScreen
          currentUser={currentUser}
          onCreateRoom={handleCreateRoom}
          onContinueAsGuest={handleContinueAsGuest}
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
          currentUserHomeLocation={currentUser?.homeLocation ?? null}
          onlineRoom={activeRoom}
          isOpeningRoom={isOpeningRoom}
          roomError={roomError}
          onCreateOnlineRoom={handleCreateRoomFromPlanner}
          onOpenProfile={currentUser ? openProfile : undefined}
          initialParticipants={currentParticipants}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          thrillLevel={thrillLevel}
          onThrillLevelChange={setThrillLevel}
          candidateScope={candidateScope}
          onCandidateScopeChange={setCandidateScope}
          candidateTargetCount={candidateTargetCount}
          onCandidateTargetCountChange={setCandidateTargetCount}
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
        />
      )}

      <AuthSheet
        open={authOpen}
        mode={authMode}
        onModeChange={setAuthMode}
        onClose={() => {
          setAuthOpen(false);
          setAuthRedirectToPlanner(false);
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
