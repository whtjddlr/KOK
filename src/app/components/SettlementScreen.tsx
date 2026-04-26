import { useMemo, useState } from 'react';
import { Calculator, Check, ChevronLeft } from 'lucide-react';
import { Candidate, Participant, TravelInfo } from '../types';
import { buildSettlementPreview } from '../lib/meeting';
import { useWinnerTravelInfo } from '../hooks/useWinnerTravelInfo';

interface SettlementScreenProps {
  winner: Candidate;
  participants: Participant[];
  onBack: () => void;
}

const PARTICIPANT_COLORS = ['#ff7b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#f59e0b', '#ec4899'];

function getTravelSourceMessage(
  status: 'loading' | 'ready' | 'partial' | 'error',
  error: string | null,
) {
  if (status === 'loading') {
    return '실시간 이동비를 확인하는 중이라, 잠시 뒤 더 정확한 정산이 반영됩니다.';
  }

  if (status === 'ready') {
    return '네이버 Directions 5의 거리, 시간, 유류비, 통행료를 바탕으로 정산 보정을 계산했습니다.';
  }

  if (status === 'partial') {
    return '일부 경로는 실시간 값, 일부는 추정값으로 정산을 계산했습니다.';
  }

  return error ?? '실시간 이동비를 가져오지 못해 현재는 추정 이동비 기준으로 정산했습니다.';
}

function getTravelDetailText(info?: TravelInfo) {
  if (!info || info.source !== 'directions') {
    return '거리 기반 추정 이동비';
  }

  return `유류비 ${Math.round(info.fuelPrice ?? 0).toLocaleString()}원 · 통행료 ${Math.round(
    info.tollFare ?? 0,
  ).toLocaleString()}원`;
}

export function SettlementScreen({ winner, participants, onBack }: SettlementScreenProps) {
  const [totalCost, setTotalCost] = useState<number>(50000);
  const [payments, setPayments] = useState<Record<string, number>>(
    participants.reduce((acc, participant, index) => {
      acc[participant.id] = index === 0 ? 50000 : 0;
      return acc;
    }, {} as Record<string, number>),
  );

  const normalizedPayments = useMemo(() => {
    return participants.reduce<Record<string, number>>((acc, participant, index) => {
      acc[participant.id] = payments[participant.id] ?? (index === 0 ? totalCost : 0);
      return acc;
    }, {});
  }, [participants, payments, totalCost]);

  const { travelInfo, status, error, hasLiveData, hasPartialFallback } = useWinnerTravelInfo(
    participants,
    winner,
  );
  const preview = buildSettlementPreview(
    winner,
    participants,
    normalizedPayments,
    totalCost,
    travelInfo,
  );
  const totalPaid = Object.values(normalizedPayments).reduce((sum, value) => sum + value, 0);

  return (
    <div className="min-h-screen bg-[#fafaf8]">
      <div className="bg-white/92 backdrop-blur-sm border-b border-[#f0f0f0] px-4 py-4 flex items-center justify-between sticky top-0 z-20">
        <button onClick={onBack} className="w-10 h-10 flex items-center justify-center">
          <ChevronLeft className="w-6 h-6 text-[#1a1a2e]" />
        </button>
        <h2 className="text-lg text-[#1a1a2e]">정산하기</h2>
        <div className="w-10" />
      </div>

      <div className="px-4 py-6 space-y-6">
        <div className="bg-gradient-to-br from-[#2d3561] to-[#3d4575] rounded-3xl p-6 text-white">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm opacity-90">약속 장소</div>
              <div className="text-xl">{winner.name}</div>
            </div>
          </div>

          <div className="bg-white/10 rounded-2xl p-4">
            <label className="block text-sm opacity-90 mb-2">총 모임비 입력</label>
            <div className="flex items-center gap-2">
              <span className="text-2xl">₩</span>
              <input
                type="number"
                value={totalCost}
                onChange={(event) => {
                  const nextCost = Number(event.target.value);
                  setTotalCost(nextCost);
                  if (participants[0]) {
                    setPayments((current) => ({
                      ...current,
                      [participants[0].id]:
                        current[participants[0].id] === totalCost
                          ? nextCost
                          : current[participants[0].id],
                    }));
                  }
                }}
                className="flex-1 bg-transparent text-2xl outline-none"
                placeholder="0"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm">
          <h3 className="text-lg text-[#1a1a2e] mb-4">각자 결제한 금액</h3>
          <div className="space-y-3">
            {participants.map((participant, index) => (
              <div key={participant.id} className="flex items-center gap-3">
	                <div
	                  className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden text-white text-sm flex-shrink-0"
	                  style={{ backgroundColor: PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length] }}
	                >
	                  {participant.avatarUrl ? (
	                    <img
	                      src={participant.avatarUrl}
	                      alt=""
	                      className="h-full w-full object-cover"
	                    />
	                  ) : (
	                    participant.name.charAt(0)
	                  )}
	                </div>
                <div className="flex-1 text-sm text-[#1a1a2e]">{participant.name}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#6b7280]">₩</span>
                  <input
                    type="number"
                    value={normalizedPayments[participant.id] || ''}
                    onChange={(event) =>
                      setPayments({ ...payments, [participant.id]: Number(event.target.value) })
                    }
                    className="w-24 h-10 px-3 bg-[#f9f7f4] rounded-xl text-sm text-right outline-none focus:ring-2 focus:ring-[#2d3561]/20"
                    placeholder="0"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-[#f0f0f0]">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#6b7280]">입력된 결제 금액 합계</span>
              <span className={totalPaid === totalCost ? 'text-[#4ecdc4]' : 'text-[#ff7b6b]'}>
                ₩{totalPaid.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm">
          <h3 className="text-lg text-[#1a1a2e] mb-2">교통비 감면 보정</h3>
          <p className="text-sm text-[#6b7280] mb-4">
            멀리 온 사람은 조금 덜 내고, 가까운 사람은 조금 더 내도록 자동 보정했어요.
          </p>

          <div className="rounded-2xl bg-[#f8fbfd] border border-[#edf2f5] px-4 py-3 mb-4 text-sm text-[#44505b]">
            {getTravelSourceMessage(status, error)}
          </div>

          <div className="rounded-2xl bg-[#f8fbfd] border border-[#edf2f5] p-4 mb-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-[#6b7280]">
                {hasLiveData && !hasPartialFallback ? '평균 실시간 이동비' : '평균 예상 이동비'}
              </span>
              <span className="text-[#1a1a2e]">{preview.averageTravelCost.toLocaleString()}원</span>
            </div>
            <div className="text-xs text-[#6b7280]">
              교통비 차이의 일부만 반영해 부담이 과하게 쏠리지 않도록 잡았습니다.
            </div>
          </div>

          <div className="space-y-3">
            {preview.rows.map((item, index) => {
              const detail = travelInfo.find((info) => info.participantId === item.participant.id);

              return (
                <div key={item.participant.id} className="bg-[#f9f7f4] rounded-2xl p-4">
                  <div className="flex items-center gap-3 mb-2">
	                    <div
	                      className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden text-white text-sm"
	                      style={{
	                        backgroundColor: PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length],
	                      }}
	                    >
	                      {item.participant.avatarUrl ? (
	                        <img
	                          src={item.participant.avatarUrl}
	                          alt=""
	                          className="h-full w-full object-cover"
	                        />
	                      ) : (
	                        item.participant.name.charAt(0)
	                      )}
	                    </div>
                    <div className="flex-1">
                      <div className="text-sm text-[#1a1a2e]">{item.participant.name}</div>
                      <div className="text-xs text-[#9ca3af]">
                        이동비 {item.travelCost.toLocaleString()}원
                      </div>
                      <div className="text-[11px] text-[#9ca3af]">{getTravelDetailText(detail)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-[#1a1a2e]">
                        {item.shouldPay.toLocaleString()}원
                      </div>
                      <div className="text-xs text-[#9ca3af]">최종 부담금</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {preview.settlements.length > 0 && (
          <div className="bg-gradient-to-br from-[#4ecdc4] to-[#5eddd4] rounded-3xl p-6 text-white">
            <h3 className="text-lg mb-4">바로 송금하면 되는 금액</h3>
            <div className="space-y-3">
              {preview.settlements.map((settlement, index) => (
                <div
                  key={index}
                  className="bg-white/20 backdrop-blur-sm rounded-2xl p-4 flex items-center gap-3"
                >
                  <div className="flex-1">
                    <div className="text-sm opacity-90 mb-1">
                      {settlement.from} → {settlement.to}
                    </div>
                    <div className="text-xl">{settlement.amount.toLocaleString()}원</div>
                  </div>
                  <button className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <Check className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
