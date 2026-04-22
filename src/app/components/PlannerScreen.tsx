import { useEffect, useState } from 'react';
import { ChevronLeft, Plus, Shuffle, Sparkles } from 'lucide-react';
import { Candidate, Participant } from '../types';
import { ParticipantCard } from './ParticipantCard';
import { MapView } from './MapView';
import { CandidateCard } from './CandidateCard';
import { RandomDrawer } from './RandomDrawer';
import { mockCandidates, stationOptions } from '../data/mockData';
import { getCandidateInsights, getDrawPool } from '../lib/meeting';

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
  const [newTravelTime, setNewTravelTime] = useState(40);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  const candidateInsights = getCandidateInsights(participants, mockCandidates);
  const { pool: drawPool, fallbackNotice } = getDrawPool(candidateInsights);
  const selectedInsight =
    candidateInsights.find((insight) => insight.candidate.id === selectedCandidateId) ??
    candidateInsights[0] ??
    null;

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

  const handleAddParticipant = () => {
    if (!newName || !newLocation) {
      return;
    }

    const locationInfo = stationOptions.find((station) => station.name === newLocation);
    if (!locationInfo) {
      return;
    }

    const newParticipant: Participant = {
      id: Date.now().toString(),
      name: newName,
      location: newLocation,
      coordinates: locationInfo.coordinates,
      maxTravelTime: newTravelTime,
    };

    setParticipants((current) => [...current, newParticipant]);
    setNewName('');
    setNewLocation('');
    setNewTravelTime(40);
    setShowAddForm(false);
  };

  const handleRemoveParticipant = (id: string) => {
    setParticipants((current) => current.filter((participant) => participant.id !== id));
  };

  const handleDrawComplete = (winner: Candidate) => {
    setShowDrawer(false);
    onComplete(winner, participants);
  };

  return (
    <div className="min-h-screen bg-[#fafaf8] pb-32">
      <div className="bg-white/92 backdrop-blur-sm border-b border-[#f0f0f0] px-4 py-4 flex items-center justify-between sticky top-0 z-20">
        <button onClick={onBack} className="w-10 h-10 flex items-center justify-center">
          <ChevronLeft className="w-6 h-6 text-[#1a1a2e]" />
        </button>
        <h2 className="text-lg text-[#1a1a2e]">약속 플래너</h2>
        <div className="w-10" />
      </div>

      <div className="px-4 py-6 space-y-6">
        <div className="bg-[#f5f1eb] rounded-3xl p-4 border border-[#ece4d8]">
          <div className="flex items-center gap-2 text-[#1a1a2e] mb-2">
            <Sparkles className="w-4 h-4 text-[#ff7b6b]" />
            <span className="text-sm">공통 접근권을 확인하고, 마지막까지 흔들리는 추첨으로 장소를 정해요.</span>
          </div>
          <p className="text-sm text-[#6b7280] leading-relaxed">
            후보 카드를 누르면 지도에서 해당 지역이 강조됩니다. 참여자 수와 이동 가능 시간을 바꿔가며 바로 비교해 보세요.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm border border-[#f0f0f0]">
            <div className="text-xs text-[#9ca3af] mb-1">참여자</div>
            <div className="text-xl text-[#1a1a2e]">{participants.length}명</div>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm border border-[#f0f0f0]">
            <div className="text-xs text-[#9ca3af] mb-1">추첨 풀</div>
            <div className="text-xl text-[#1a1a2e]">{drawPool.length}곳</div>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm border border-[#f0f0f0]">
            <div className="text-xs text-[#9ca3af] mb-1">선택 중</div>
            <div className="text-base text-[#1a1a2e] truncate">
              {selectedInsight?.candidate.name ?? '-'}
            </div>
          </div>
        </div>

        <MapView
          participants={participants}
          candidates={mockCandidates}
          reachableCandidateIds={drawPool.map((candidate) => candidate.candidate.id)}
          selectedCandidate={selectedInsight?.candidate}
          colors={PARTICIPANT_COLORS}
        />

        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg text-[#1a1a2e]">참여자 ({participants.length})</h3>
            <button
              onClick={() => setShowAddForm((current) => !current)}
              className="flex items-center gap-1 text-sm text-[#2d3561]"
            >
              <Plus className="w-4 h-4" />
              {showAddForm ? '닫기' : '추가'}
            </button>
          </div>

          {showAddForm && (
            <div className="mb-3 bg-white rounded-2xl p-4 shadow-sm border border-[#f0f0f0]">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  type="text"
                  placeholder="이름"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className="w-full h-12 px-4 bg-[#f9f7f4] rounded-xl text-[#1a1a2e] placeholder:text-[#9ca3af] outline-none focus:ring-2 focus:ring-[#2d3561]/20"
                />
                <select
                  value={newLocation}
                  onChange={(event) => setNewLocation(event.target.value)}
                  className="w-full h-12 px-4 bg-[#f9f7f4] rounded-xl text-[#1a1a2e] outline-none focus:ring-2 focus:ring-[#2d3561]/20"
                >
                  <option value="">출발지 선택</option>
                  {stationOptions.map((station) => (
                    <option key={station.name} value={station.name}>
                      {station.name}
                    </option>
                  ))}
                </select>
                <select
                  value={newTravelTime}
                  onChange={(event) => setNewTravelTime(Number(event.target.value))}
                  className="w-full h-12 px-4 bg-[#f9f7f4] rounded-xl text-[#1a1a2e] outline-none focus:ring-2 focus:ring-[#2d3561]/20"
                >
                  <option value={30}>최대 이동 30분</option>
                  <option value={40}>최대 이동 40분</option>
                  <option value={50}>최대 이동 50분</option>
                  <option value={60}>최대 이동 60분</option>
                </select>
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleAddParticipant}
                  className="flex-1 h-11 bg-[#2d3561] text-white rounded-xl active:scale-95 transition-transform"
                >
                  참여자 추가
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="h-11 px-4 bg-[#f5f1eb] text-[#6b7280] rounded-xl active:scale-95 transition-transform"
                >
                  취소
                </button>
              </div>
            </div>
          )}

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
        </section>

        <section>
          <div className="mb-4">
            <h3 className="text-lg text-[#1a1a2e] mb-1">후보 지역 ({candidateInsights.length})</h3>
            <p className="text-sm text-[#6b7280]">
              {fallbackNotice ?? `공통 범위 안에서 바로 추첨 가능한 후보 ${drawPool.length}곳을 골라뒀어요.`}
            </p>
          </div>

          <div className="space-y-3">
            {candidateInsights.map((insight) => (
              <CandidateCard
                key={insight.candidate.id}
                insight={insight}
                selected={selectedInsight?.candidate.id === insight.candidate.id}
                onClick={() => setSelectedCandidateId(insight.candidate.id)}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="px-4 pb-8">
        <div className="rounded-[1.75rem] border border-[#eceff3] bg-white/92 backdrop-blur-xl shadow-[0_18px_40px_rgba(18,28,45,0.12)] p-3">
          <div className="text-xs text-[#6b7280] px-2 pb-2">
            {drawPool.length
              ? `${drawPool.length}개의 후보 안에서 마지막까지 흔들리며 장소를 정해요.`
              : '먼저 참여자를 2명 이상 입력해 주세요.'}
          </div>
          <button
            onClick={() => setShowDrawer(true)}
            disabled={participants.length < 2 || !drawPool.length}
            className="w-full h-14 bg-gradient-to-r from-[#ff7b6b] to-[#ffa59b] text-white rounded-2xl shadow-lg active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Shuffle className="w-5 h-5" />
            공통 범위에서 추첨 시작
          </button>
        </div>
      </div>

      {showDrawer && (
        <RandomDrawer
          candidateInsights={drawPool}
          onComplete={handleDrawComplete}
          onClose={() => setShowDrawer(false)}
        />
      )}
    </div>
  );
}
