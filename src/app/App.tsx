import { useState } from 'react';
import { HomeScreen } from './components/HomeScreen';
import { PlannerScreen } from './components/PlannerScreen';
import { ResultScreen } from './components/ResultScreen';
import { SettlementScreen } from './components/SettlementScreen';
import { Candidate, Participant } from './types';
import { initialParticipants } from './data/mockData';

type Screen = 'home' | 'planner' | 'result' | 'settlement';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [selectedWinner, setSelectedWinner] = useState<Candidate | null>(null);
  const [currentParticipants, setCurrentParticipants] = useState<Participant[]>(initialParticipants);

  const handleCreateRoom = () => {
    setCurrentScreen('planner');
  };

  const handlePlannerComplete = (winner: Candidate, participants: Participant[]) => {
    setSelectedWinner(winner);
    setCurrentParticipants(participants);
    setCurrentScreen('result');
  };

  const handleSettlement = () => {
    setCurrentScreen('settlement');
  };

  const handleNewDraw = () => {
    setSelectedWinner(null);
    setCurrentScreen('home');
  };

  const handleBack = () => {
    if (currentScreen === 'settlement') {
      setCurrentScreen('result');
    } else if (currentScreen === 'planner') {
      setCurrentScreen('home');
    }
  };

  return (
    <div className="w-full h-full overflow-hidden bg-[#fafaf8]">
      {currentScreen === 'home' && <HomeScreen onCreateRoom={handleCreateRoom} />}

      {currentScreen === 'planner' && (
        <PlannerScreen
          initialParticipants={currentParticipants}
          onBack={handleBack}
          onComplete={handlePlannerComplete}
        />
      )}

      {currentScreen === 'result' && selectedWinner && (
        <ResultScreen
          winner={selectedWinner}
          participants={currentParticipants}
          onSettlement={handleSettlement}
          onNewDraw={handleNewDraw}
        />
      )}

      {currentScreen === 'settlement' && selectedWinner && (
        <SettlementScreen
          winner={selectedWinner}
          participants={currentParticipants}
          onBack={handleBack}
        />
      )}
    </div>
  );
}