import { useEffect, useState } from 'react';
import { HomeScreen } from './components/HomeScreen';
import { PlannerScreen } from './components/PlannerScreen';
import { ResultScreen } from './components/ResultScreen';
import { AuthMode, AuthSheet } from './components/AuthSheet';
import { AuthUser, loadSessionUser, signOut, subscribeToAuthChanges } from './lib/auth';
import { addRoomParticipant, createMeetingRoom, loadMeetingRoomByCode } from './lib/rooms';
import {
  Candidate,
  CandidateScopeKey,
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
  const [activeRoom, setActiveRoom] = useState<MeetingRoom | null>(null);
  const [isOpeningRoom, setIsOpeningRoom] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [selectedWinner, setSelectedWinner] = useState<Candidate | null>(null);
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

    loadMeetingRoomByCode(code)
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

  const handleCreateRoom = () => {
    setIsOpeningRoom(true);
    setRoomError(null);
    setCurrentParticipants([]);
    setActiveRoom(null);
    syncRoomUrl(null);
    setCurrentScreen('planner');

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
      })
      .catch((error) => {
        setActiveRoom(null);
        syncRoomUrl(null);
        setRoomError(
          `${getActionErrorMessage(error, '온라인 방을 만들지 못했어요.')} 로컬 모드로 먼저 시작했어요.`,
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
        participants.map((participant) =>
          addRoomParticipant({
            roomId: room.id,
            participant,
            userId: currentUser?.id ?? null,
          }),
        ),
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
  ) => {
    setSelectedWinner(winner);
    setCurrentParticipants(participants);
    setSelectedCategory(category);
    setCurrentScreen('result');
  };

  const handleBackToPlanner = () => {
    setSelectedWinner(null);
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
    setCurrentScreen('home');
  };

  return (
    <div className="min-h-screen w-full bg-[#fafaf8]">
      {currentScreen === 'home' && (
        <HomeScreen
          currentUser={currentUser}
          onCreateRoom={handleCreateRoom}
          onContinueAsGuest={handleContinueAsGuest}
          onJoinRoom={handleJoinRoom}
          onOpenAuth={openAuth}
          onSignOut={handleSignOut}
          isOpeningRoom={isOpeningRoom}
          roomError={roomError}
        />
      )}

      {currentScreen === 'planner' && (
        <PlannerScreen
          currentUserId={currentUser?.id ?? ''}
          currentUserName={currentUser?.name ?? '게스트'}
          onlineRoom={activeRoom}
          isOpeningRoom={isOpeningRoom}
          roomError={roomError}
          onCreateOnlineRoom={handleCreateRoomFromPlanner}
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
    </div>
  );
}
