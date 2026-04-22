import { ArrowRight, MapPin, TrainFront } from 'lucide-react';
import { Candidate, Participant, TravelInfo } from '../types';
import { MapView } from './MapView';
import { getCandidateInsights } from '../lib/meeting';
import { useWinnerTravelInfo } from '../hooks/useWinnerTravelInfo';

interface ResultScreenProps {
  winner: Candidate;
  participants: Participant[];
  onSettlement: () => void;
  onNewDraw: () => void;
}

const PARTICIPANT_COLORS = ['#ff7b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#f59e0b', '#ec4899'];

function getTravelSourceMessage(
  status: 'loading' | 'ready' | 'partial' | 'error',
  error: string | null,
) {
  if (status === 'loading') {
    return '네이버 실시간 경로와 이동비를 불러오는 중입니다...';
  }

  if (status === 'ready') {
    return '네이버 Directions 5 기준으로 거리, 시간, 이동비를 반영했습니다.';
  }

  if (status === 'partial') {
    return '일부 경로만 실시간 응답을 받아 반영했고, 나머지는 추정값으로 보정했습니다.';
  }

  return error ?? '실시간 이동비를 가져오지 못해 현재는 추정 이동비 기준으로 안내 중입니다.';
}

function getTravelDetailText(info: TravelInfo) {
  if (info.source !== 'directions') {
    return '거리 기반 추정 이동비';
  }

  return `유류비 ${Math.round(info.fuelPrice ?? 0).toLocaleString()}원 · 통행료 ${Math.round(
    info.tollFare ?? 0,
  ).toLocaleString()}원`;
}

export function ResultScreen({ winner, participants, onSettlement, onNewDraw }: ResultScreenProps) {
  const winnerInsight = getCandidateInsights(participants, [winner])[0];
  const { travelInfo, status, error, hasLiveData, hasPartialFallback } = useWinnerTravelInfo(
    participants,
    winner,
  );
  const totalTravelCost = travelInfo.reduce((sum, info) => sum + info.cost, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fafaf8] via-[#f5f1eb] to-[#e8dfd0]">
      <div className="px-4 py-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">✨</div>
          <h1 className="text-3xl text-[#1a1a2e] mb-2">오늘의 약속 장소</h1>
          <div className="inline-block bg-gradient-to-r from-[#ff7b6b] to-[#ffa59b] px-8 py-4 rounded-2xl shadow-lg">
            <div className="text-3xl text-white mb-1">{winner.name}</div>
            <div className="text-white/90 text-sm">{winner.district}</div>
          </div>
        </div>

        <div className="mb-6">
          <MapView
            participants={participants}
            candidates={[winner]}
            selectedCandidate={winner}
            reachableCandidateIds={[winner.id]}
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

          <div className="rounded-2xl bg-[#f8fbfd] border border-[#edf2f5] p-4 mb-4">
            <div className="text-xs text-[#9ca3af] mb-2">왜 이 장소가 남았는지</div>
            <p className="text-sm text-[#1a1a2e] leading-relaxed mb-2">{winner.whyItWorks}</p>
            <p className="text-xs text-[#6b7280]">{winnerInsight.accessSummary}</p>
          </div>

          <div className="flex gap-2 flex-wrap">
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
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-[#f5f1eb] rounded-xl flex items-center justify-center flex-shrink-0">
              <TrainFront className="w-5 h-5 text-[#2d3561]" />
            </div>
            <div>
              <h3 className="text-lg text-[#1a1a2e]">이동 요약</h3>
              <p className="text-sm text-[#6b7280]">{winner.routeHint}</p>
            </div>
          </div>

          <div className="rounded-2xl bg-[#f8fbfd] border border-[#edf2f5] px-4 py-3 mb-4 text-sm text-[#44505b]">
            {getTravelSourceMessage(status, error)}
          </div>

          <div className="space-y-3">
            {travelInfo.map((info, index) => (
              <div key={info.participantId} className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0"
                  style={{ backgroundColor: PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length] }}
                >
                  {info.participantName.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="text-sm text-[#1a1a2e]">{info.participantName}</div>
                  <div className="text-xs text-[#9ca3af]">
                    {info.distance}km · {info.duration}분
                  </div>
                  <div className="text-[11px] text-[#9ca3af]">{getTravelDetailText(info)}</div>
                </div>
                <div className="text-sm text-[#6b7280]">{info.cost.toLocaleString()}원</div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-[#f0f0f0] flex items-center justify-between">
            <span className="text-sm text-[#6b7280]">
              {hasLiveData && !hasPartialFallback ? '총 실시간 이동비' : '총 예상 이동비'}
            </span>
            <span className="text-lg text-[#1a1a2e]">{totalTravelCost.toLocaleString()}원</span>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={onSettlement}
            className="w-full h-14 bg-gradient-to-r from-[#2d3561] to-[#3d4575] text-white rounded-2xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            교통비 보정 정산하기
            <ArrowRight className="w-5 h-5" />
          </button>
          <button
            onClick={onNewDraw}
            className="w-full h-14 bg-white text-[#6b7280] rounded-2xl border border-[#e5e7eb] active:scale-95 transition-transform"
          >
            같은 멤버로 다시 추첨
          </button>
        </div>
      </div>
    </div>
  );
}
