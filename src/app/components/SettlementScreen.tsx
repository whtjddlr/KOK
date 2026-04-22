import { useState } from 'react';
import { ChevronLeft, Calculator, ArrowRight, Check } from 'lucide-react';
import { Participant, Candidate } from '../types';

interface SettlementScreenProps {
  winner: Candidate;
  participants: Participant[];
  onBack: () => void;
}

const PARTICIPANT_COLORS = ['#ff7b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#f59e0b', '#ec4899'];

export function SettlementScreen({ winner, participants, onBack }: SettlementScreenProps) {
  const [totalCost, setTotalCost] = useState<number>(50000);
  const [payments, setPayments] = useState<Record<string, number>>(
    participants.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {})
  );

  const mockTravelCosts = participants.reduce(
    (acc, p, index) => ({
      ...acc,
      [p.id]: Math.round((Math.random() * 2000 + 1500) / 100) * 100,
    }),
    {} as Record<string, number>
  );

  const totalPaid = Object.values(payments).reduce((sum, val) => sum + val, 0);
  const perPersonBase = totalCost / participants.length;

  const adjustedAmounts = participants.map((p) => {
    const travelCost = mockTravelCosts[p.id];
    const avgTravel =
      Object.values(mockTravelCosts).reduce((a, b) => a + b, 0) / participants.length;
    const travelAdjustment = avgTravel - travelCost;
    const shouldPay = perPersonBase - travelAdjustment * 0.5;
    const paid = payments[p.id] || 0;
    const balance = paid - shouldPay;

    return {
      participant: p,
      travelCost,
      shouldPay: Math.round(shouldPay),
      paid,
      balance: Math.round(balance),
    };
  });

  const settlements = adjustedAmounts
    .filter((a) => a.balance < 0)
    .flatMap((debtor) => {
      const debtAmount = Math.abs(debtor.balance);
      const creditors = adjustedAmounts.filter((a) => a.balance > 0);

      return creditors
        .filter((creditor) => creditor.balance > 0)
        .map((creditor) => {
          const amount = Math.min(debtAmount, creditor.balance);
          return {
            from: debtor.participant.name,
            to: creditor.participant.name,
            amount,
          };
        })
        .filter((s) => s.amount > 0);
    })
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-[#fafaf8] flex flex-col">
      <div className="bg-white border-b border-[#f0f0f0] px-4 py-4 flex items-center justify-between sticky top-0 z-10">
        <button onClick={onBack} className="w-10 h-10 flex items-center justify-center">
          <ChevronLeft className="w-6 h-6 text-[#1a1a2e]" />
        </button>
        <h2 className="text-lg text-[#1a1a2e]">정산하기</h2>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="bg-gradient-to-br from-[#2d3561] to-[#3d4575] rounded-3xl p-6 text-white mb-6">
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
            <label className="block text-sm opacity-90 mb-2">총 비용 입력</label>
            <div className="flex items-center gap-2">
              <span className="text-2xl">₩</span>
              <input
                type="number"
                value={totalCost}
                onChange={(e) => setTotalCost(Number(e.target.value))}
                className="flex-1 bg-transparent text-2xl outline-none"
                placeholder="0"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm mb-6">
          <h3 className="text-lg text-[#1a1a2e] mb-4">각자 결제한 금액</h3>
          <div className="space-y-3">
            {participants.map((p, index) => (
              <div key={p.id} className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0"
                  style={{
                    backgroundColor: PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length],
                  }}
                >
                  {p.name.charAt(0)}
                </div>
                <div className="flex-1 text-sm text-[#1a1a2e]">{p.name}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#6b7280]">₩</span>
                  <input
                    type="number"
                    value={payments[p.id] || ''}
                    onChange={(e) =>
                      setPayments({ ...payments, [p.id]: Number(e.target.value) })
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
              <span className="text-[#6b7280]">결제 금액 합계</span>
              <span
                className={
                  totalPaid === totalCost ? 'text-[#4ecdc4]' : 'text-[#ff7b6b]'
                }
              >
                ₩{totalPaid.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm mb-6">
          <h3 className="text-lg text-[#1a1a2e] mb-2">교통비 보정 정산</h3>
          <p className="text-sm text-[#6b7280] mb-4">
            이동 거리가 먼 사람은 덜 내도록 자동 조정됩니다
          </p>

          <div className="space-y-3">
            {adjustedAmounts.map((item, index) => (
              <div
                key={item.participant.id}
                className="bg-[#f9f7f4] rounded-2xl p-4"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm"
                    style={{
                      backgroundColor: PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length],
                    }}
                  >
                    {item.participant.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-[#1a1a2e]">{item.participant.name}</div>
                    <div className="text-xs text-[#9ca3af]">
                      교통비 ₩{item.travelCost.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-[#1a1a2e]">
                      ₩{item.shouldPay.toLocaleString()}
                    </div>
                    <div className="text-xs text-[#9ca3af]">부담액</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {settlements.length > 0 && (
          <div className="bg-gradient-to-br from-[#4ecdc4] to-[#5eddd4] rounded-3xl p-6 text-white mb-6">
            <h3 className="text-lg mb-4">💸 송금 안내</h3>
            <div className="space-y-3">
              {settlements.map((settlement, index) => (
                <div
                  key={index}
                  className="bg-white/20 backdrop-blur-sm rounded-2xl p-4 flex items-center gap-3"
                >
                  <div className="flex-1">
                    <div className="text-sm opacity-90 mb-1">
                      {settlement.from} → {settlement.to}
                    </div>
                    <div className="text-xl">₩{settlement.amount.toLocaleString()}</div>
                  </div>
                  <button className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <Check className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="h-20" />
      </div>
    </div>
  );
}
