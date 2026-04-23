import { useEffect, useState } from 'react';
import { HomeScreen } from './components/HomeScreen';
import { PlannerScreen } from './components/PlannerScreen';
import { ResultScreen } from './components/ResultScreen';
import { AuthMode, AuthSheet } from './components/AuthSheet';
import { AuthUser, loadSessionUser, signOut, subscribeToAuthChanges } from './lib/auth';
import {
  Candidate,
  CandidateScopeKey,
  MeetCategoryKey,
  Participant,
  SelectionModeKey,
  ThrillLevel,
} from './types';

type Screen = 'home' | 'planner' | 'result';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signup');
  const [authRedirectToPlanner, setAuthRedirectToPlanner] = useState(false);
  const [selectedWinner, setSelectedWinner] = useState<Candidate | null>(null);
  const [currentParticipants, setCurrentParticipants] = useState<Participant[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<MeetCategoryKey>('dining');
  const [selectionMode, setSelectionMode] = useState<SelectionModeKey>('balance');
  const [thrillLevel, setThrillLevel] = useState<ThrillLevel>(2);
  const [candidateScope, setCandidateScope] = useState<CandidateScopeKey>('standard');

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

  const openAuth = (mode: AuthMode, redirectToPlanner = false) => {
    setAuthMode(mode);
    setAuthRedirectToPlanner(redirectToPlanner);
    setAuthOpen(true);
  };

  const handleCreateRoom = () => {
    setCurrentParticipants([]);
    setCurrentScreen('planner');
  };

  const handleContinueAsGuest = () => {
    setCurrentParticipants([]);
    setCurrentScreen('planner');
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
          onOpenAuth={openAuth}
          onSignOut={handleSignOut}
        />
      )}

      {currentScreen === 'planner' && (
        <PlannerScreen
          currentUserId={currentUser?.id ?? ''}
          initialParticipants={currentParticipants}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          thrillLevel={thrillLevel}
          onThrillLevelChange={setThrillLevel}
          candidateScope={candidateScope}
          onCandidateScopeChange={setCandidateScope}
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
