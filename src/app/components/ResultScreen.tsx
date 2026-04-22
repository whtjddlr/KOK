import { MapPin, Clock, Navigation, ArrowRight } from 'lucide-react';
import { Candidate, Participant } from '../types';
import { MapView } from './MapView';

interface ResultScreenProps {
  winner: Candidate;
  participants: Participant[];
  onSettlement: () => void;
  onNewDraw: () => void;
}

const PARTICIPANT_COLORS = ['#ff7b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#f59e0b', '#ec4899'];

export function ResultScreen({ winner, participants, onSettlement, onNewDraw }: ResultScreenProps) {
  const mockTravelInfo = participants.map((p, index) => ({
    name: p.name,
    distance: Math.round(Math.random() * 15 + 5),
    time: Math.round(Math.random() * 40 + 20),
    cost: Math.round((Math.random() * 2000 + 1500) / 100) * 100,
    color: PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length],
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fafaf8] via-[#f5f1eb] to-[#e8dfd0]">
      <div className="px-4 py-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🎉</div>
          <h1 className="text-3xl text-[#1a1a2e] mb-2">오늘의 약속 장소</h1>
          <div className="inline-block bg-gradient-to-r from-[#ff7b6b] to-[#ffa59b] px-8 py-4 rounded-2xl shadow-lg">
            <div className="text-3xl text-white mb-1">{winner.name}</div>
            <div className="text-white/90 text-sm">{winner.vibe}</div>
          </div>
        </div>

        <div className="mb-6">
          <MapView
            participants={participants}
            candidates={[winner]}
            selectedCandidate={winner}
            colors={PARTICIPANT_COLORS}
          />
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm mb-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 bg-[#f5f1eb] rounded-xl flex items-center justify-center flex-shrink-0">
              <MapPin className="w-5 h-5 text-[#2d3561]" />
            </div>
            <div>
              <h3 className="text-lg text-[#1a1a2e] mb-1">장소 정보</h3>
              <p className="text-sm text-[#6b7280] leading-relaxed">{winner.description}</p>
            </div>
          </div>

          <div className="flex gap-2">
            {winner.tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1.5 bg-[#f5f1eb] text-[#2d3561] text-sm rounded-full"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm mb-6">
          <h3 className="text-lg text-[#1a1a2e] mb-4">이동 정보</h3>
          <div className="space-y-3">
            {mockTravelInfo.map((info, index) => (
              <div key={index} className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0"
                  style={{ backgroundColor: info.color }}
                >
                  {info.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="text-sm text-[#1a1a2e]">{info.name}</div>
                  <div className="text-xs text-[#9ca3af]">
                    {info.distance}km · {info.time}분
                  </div>
                </div>
                <div className="text-sm text-[#6b7280]">₩{info.cost.toLocaleString()}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-[#f0f0f0] flex items-center justify-between">
            <span className="text-sm text-[#6b7280]">총 예상 교통비</span>
            <span className="text-lg text-[#1a1a2e]">
              ₩{mockTravelInfo.reduce((sum, info) => sum + info.cost, 0).toLocaleString()}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={onSettlement}
            className="w-full h-14 bg-gradient-to-r from-[#2d3561] to-[#3d4575] text-white rounded-2xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            정산하러 가기
            <ArrowRight className="w-5 h-5" />
          </button>
          <button
            onClick={onNewDraw}
            className="w-full h-14 bg-white text-[#6b7280] rounded-2xl border border-[#e5e7eb] active:scale-95 transition-transform"
          >
            새로운 약속 만들기
          </button>
        </div>
      </div>
    </div>
  );
}
