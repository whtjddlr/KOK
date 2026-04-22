import { useState } from 'react';
import { Plus, ChevronLeft, Shuffle } from 'lucide-react';
import { Participant, Candidate } from '../types';
import { ParticipantCard } from './ParticipantCard';
import { MapView } from './MapView';
import { CandidateCard } from './CandidateCard';
import { RandomDrawer } from './RandomDrawer';
import { mockCandidates, seoulStations } from '../data/mockData';

interface PlannerScreenProps {
  initialParticipants: Participant[];
  onBack: () => void;
  onComplete: (winner: Candidate, participants: Participant[]) => void;
}

const PARTICIPANT_COLORS = ['#ff7b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#f59e0b', '#ec4899'];

export function PlannerScreen({ initialParticipants, onBack, onComplete }: PlannerScreenProps) {
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');

  const handleAddParticipant = () => {
    if (newName && newLocation) {
      const randomCoords = {
        lat: 37.4 + Math.random() * 0.3,
        lng: 126.7 + Math.random() * 0.5,
      };
      const newParticipant: Participant = {
        id: Date.now().toString(),
        name: newName,
        location: newLocation,
        coordinates: randomCoords,
        maxTravelTime: 40,
      };
      setParticipants([...participants, newParticipant]);
      setNewName('');
      setNewLocation('');
      setShowAddForm(false);
    }
  };

  const handleRemoveParticipant = (id: string) => {
    setParticipants(participants.filter((p) => p.id !== id));
  };

  const handleDrawComplete = (winner: Candidate) => {
    onComplete(winner, participants);
  };

  return (
    <div className="min-h-screen bg-[#fafaf8] flex flex-col">
      <div className="bg-white border-b border-[#f0f0f0] px-4 py-4 flex items-center justify-between sticky top-0 z-10">
        <button onClick={onBack} className="w-10 h-10 flex items-center justify-center">
          <ChevronLeft className="w-6 h-6 text-[#1a1a2e]" />
        </button>
        <h2 className="text-lg text-[#1a1a2e]">약속 플래너</h2>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        <div className="px-4 py-6">
          <MapView
            participants={participants}
            candidates={mockCandidates}
            colors={PARTICIPANT_COLORS}
          />
        </div>

        <div className="px-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg text-[#1a1a2e]">참여자 ({participants.length})</h3>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1 text-sm text-[#2d3561]"
            >
              <Plus className="w-4 h-4" />
              추가
            </button>
          </div>

          <div className="space-y-3">
            {participants.map((participant, index) => (
              <ParticipantCard
                key={participant.id}
                participant={participant}
                onRemove={handleRemoveParticipant}
                color={PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length]}
              />
            ))}
          </div>

          {showAddForm && (
            <div className="mt-3 bg-white rounded-2xl p-4 shadow-sm border border-[#f0f0f0]">
              <input
                type="text"
                placeholder="이름"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full h-12 px-4 bg-[#f9f7f4] rounded-xl mb-3 text-[#1a1a2e] placeholder:text-[#9ca3af] outline-none focus:ring-2 focus:ring-[#2d3561]/20"
              />
              <select
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                className="w-full h-12 px-4 bg-[#f9f7f4] rounded-xl mb-3 text-[#1a1a2e] outline-none focus:ring-2 focus:ring-[#2d3561]/20"
              >
                <option value="">출발지 선택</option>
                {seoulStations.map((station) => (
                  <option key={station} value={station}>
                    {station}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={handleAddParticipant}
                  className="flex-1 h-10 bg-[#2d3561] text-white rounded-xl active:scale-95 transition-transform"
                >
                  추가
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 h-10 bg-[#f5f1eb] text-[#6b7280] rounded-xl active:scale-95 transition-transform"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 mb-6">
          <h3 className="text-lg text-[#1a1a2e] mb-4">후보 장소 ({mockCandidates.length})</h3>
          <div className="space-y-3">
            {mockCandidates.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} />
            ))}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#f0f0f0] p-4 safe-area-bottom">
        <button
          onClick={() => setShowDrawer(true)}
          disabled={participants.length < 2}
          className="w-full h-14 bg-gradient-to-r from-[#ff7b6b] to-[#ffa59b] text-white rounded-2xl shadow-lg active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Shuffle className="w-5 h-5" />
          랜덤 추첨 시작
        </button>
      </div>

      {showDrawer && (
        <RandomDrawer
          candidates={mockCandidates}
          onComplete={handleDrawComplete}
          onClose={() => setShowDrawer(false)}
        />
      )}
    </div>
  );
}
