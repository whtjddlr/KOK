/**
 * 추첨 결과 뒤바뀜 버그 회귀 테스트.
 * 사용자가 화면 슬롯에서 고른 후보(lockedWinner)가 buildDrawPlan 내부의 풀 재계산 때문에
 * 다른 후보로 조용히 바뀌지 않는지 검증한다.
 *
 * 실행: npx tsx scripts/verify-draw-lock.ts
 */
import { buildDrawPlan, getDrawPool } from '../src/app/lib/meeting';
import { CandidateInsight, Participant } from '../src/app/types';

function insight(id: string, name: string, spread: number, avg: number): CandidateInsight {
  return {
    candidate: {
      id,
      name,
      district: name,
      description: '',
      vibe: '',
      coordinates: { lat: 37.5, lng: 127.0 },
      tags: [],
      bestFor: '',
      whyItWorks: '',
      routeHint: '',
      drawMood: '안정 픽',
      categories: ['dining'],
    },
    travelInfo: [],
    averageDistance: avg * 0.45,
    averageDuration: avg,
    maxDuration: avg + spread,
    spreadDuration: spread,
    farthestDuration: avg + spread,
    nearestDuration: avg,
    nearestParticipantName: '가영',
    farthestParticipantName: '나윤',
    centerDistance: 1,
    axisDistance: 1,
    allReachable: true,
    categoryMatched: true,
    accessSummary: '',
  } as CandidateInsight;
}

const participants: Participant[] = [
  { id: 'a', name: '가영', location: '강남', coordinates: { lat: 37.4979, lng: 127.0276 }, maxTravelTime: 45 },
  { id: 'b', name: '나윤', location: '잠실', coordinates: { lat: 37.5133, lng: 127.1001 }, maxTravelTime: 45 },
];

// 10개 후보: 공정성 순으로 정렬되면 spread가 작은 것이 앞. 사용자가 "뒤쪽" 후보를 골랐다고 가정.
const insights: CandidateInsight[] = Array.from({ length: 10 }, (_, i) =>
  insight(`c${i}`, `후보${i}`, 4 + i * 2, 30 + i),
);

// buildDrawPlan이 내부에서 좁히는 풀 확인
const { pool } = getDrawPool(insights, 'balance', 1, 'standard', undefined, participants);
console.log(`입력 후보 수: ${insights.length}, buildDrawPlan 내부 풀 크기: ${pool.length}`);
console.log(`내부 풀 후보 id: [${pool.map((p) => p.candidate.id).join(', ')}]`);

let failures = 0;

// 내부 풀 밖에 있는 후보를 골라본다 (풀에 없는 것 우선, 없으면 마지막 후보).
const poolIds = new Set(pool.map((p) => p.candidate.id));
const outsideChoice =
  insights.find((ins) => !poolIds.has(ins.candidate.id)) ?? insights[insights.length - 1];
console.log(`\n사용자가 고른 후보(풀 밖): ${outsideChoice.candidate.id} / ${outsideChoice.candidate.name}`);

const plan = buildDrawPlan(insights, 'balance', 1, 'standard', outsideChoice, participants, 'seed-1');
console.log(`실제 당첨자: ${plan.winner.candidate.id} / ${plan.winner.candidate.name}`);

if (plan.winner.candidate.id !== outsideChoice.candidate.id) {
  console.log(`❌ FAIL: 고른 후보와 당첨자가 다름 (버그 재현)`);
  failures += 1;
} else {
  console.log(`✅ PASS: 고른 후보가 그대로 당첨됨`);
}

// finalists/sequence에 winner가 포함되는지도 확인
if (!plan.finalists.some((f) => f.candidate.id === plan.winner.candidate.id)) {
  console.log(`❌ FAIL: finalists에 winner 미포함`);
  failures += 1;
} else {
  console.log(`✅ PASS: finalists에 winner 포함`);
}

// 모든 슬롯 후보를 각각 골라 항상 그 후보가 당첨되는지 전수 확인
console.log('\n전수 확인 (10개 후보 각각 선택):');
for (const chosen of insights) {
  const p = buildDrawPlan(insights, 'balance', 1, 'standard', chosen, participants, 'seed-x');
  const ok = p.winner.candidate.id === chosen.candidate.id;
  if (!ok) {
    console.log(`  ❌ ${chosen.candidate.id} 선택 → ${p.winner.candidate.id} 당첨`);
    failures += 1;
  }
}
if (failures === 0) {
  console.log('  ✅ 10개 후보 모두 선택=당첨 일치');
}

// lockedWinner 없이 호출하면 기존 동작(balance는 풀 1위) 유지되는지 확인
const noLock = buildDrawPlan(insights, 'balance', 1, 'standard', null, participants, 'seed-1');
console.log(`\nlockedWinner 없음 → 당첨자: ${noLock.winner.candidate.id} (풀 1위 ${pool[0]?.candidate.id})`);
if (noLock.winner.candidate.id !== pool[0]?.candidate.id) {
  console.log('  ❌ FAIL: lockedWinner 없을 때 balance 기본동작(풀 1위)이 깨짐');
  failures += 1;
} else {
  console.log('  ✅ PASS: lockedWinner 없을 때 기존 동작 유지');
}

console.log(`\n총 실패: ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
