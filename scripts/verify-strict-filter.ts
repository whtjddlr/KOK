/**
 * "치우친 곳 빼기"(filterFairDrawPool) 검증.
 * 멀리 흩어진 그룹처럼 치우친 후보가 낀 풀에서, 필터가 공평 한도 초과 후보를 제거하는지 확인.
 * 실행: npx tsx scripts/verify-strict-filter.ts
 */
import {
  buildCandidateUniverse,
  getCandidateInsights,
  getDrawPool,
  getFairnessSpreadLimit,
  filterFairDrawPool,
} from '../src/app/lib/meeting';
import { mockCandidates } from '../src/app/data/mockData';
import { Coordinates, Participant } from '../src/app/types';

function p(id: string, name: string, coordinates: Coordinates): Participant {
  return { id, name, location: name, coordinates, maxTravelTime: 45 };
}
function randCoord(s: number): Coordinates {
  return { lat: 37.45 + (Math.sin(s * 12.9898) * 0.5 + 0.5) * 0.28, lng: 126.82 + (Math.sin(s * 78.233) * 0.5 + 0.5) * 0.4 };
}
function maxSpread(pool: { spreadDuration: number }[]) {
  return pool.length ? Math.max(...pool.map((i) => i.spreadDuration)) : 0;
}

let removedTotal = 0;
let checkedPools = 0;
let overLimitAfterFilter = 0;
let emptyAfterFilter = 0;

for (let s = 0; s < 600; s += 1) {
  const n = 3 + (s % 3); // 3~5명
  // 일부러 한 명을 멀리 떨어뜨려 치우친 후보가 생기게 함
  const base = randCoord(s);
  const parts = [
    p('a', 'A', base),
    p('b', 'B', { lat: base.lat + 0.01, lng: base.lng + 0.008 }),
    ...(n >= 4 ? [p('c', 'C', { lat: base.lat + 0.15, lng: base.lng + 0.11 })] : []),
    ...(n >= 5 ? [p('d', 'D', { lat: base.lat - 0.12, lng: base.lng + 0.14 })] : []),
  ];
  const universe = buildCandidateUniverse(parts, mockCandidates, 'dining', 1);
  const insights = getCandidateInsights(parts, universe, 'dining', 'balance');
  const pool = getDrawPool(insights, 'balance', 1, 'standard', 10, parts).pool;
  if (!pool.length) continue;

  const limit = getFairnessSpreadLimit(1, parts);
  const filtered = filterFairDrawPool(pool, 1, parts);
  checkedPools += 1;
  removedTotal += pool.length - filtered.length;

  // 필터 후 남은 후보는 모두 한도 이내여야 함
  if (filtered.some((i) => i.spreadDuration > limit)) overLimitAfterFilter += 1;
  if (filtered.length === 0) emptyAfterFilter += 1;
}

console.log(`검사한 풀: ${checkedPools}개 (3~5명, 1명 멀리 배치)`);
console.log(`필터가 제거한 치우친 후보 총합: ${removedTotal}개 (풀당 평균 ${(removedTotal / checkedPools).toFixed(2)}개)`);
console.log(`필터 후에도 한도 초과가 남은 풀: ${overLimitAfterFilter}개 ${overLimitAfterFilter === 0 ? '✅' : '❌'}`);
console.log(`필터 후 완전히 빈 풀(모두 치우침 → 폴백 필요): ${emptyAfterFilter}개 (호출부에서 원본 폴백)`);

// 구체 예시 1개
const demo = [
  p('a', 'A', { lat: 37.4979, lng: 127.0276 }),
  p('b', 'B', { lat: 37.5, lng: 127.03 }),
  p('c', 'C', { lat: 37.65, lng: 126.72 }),
];
const dUniverse = buildCandidateUniverse(demo, mockCandidates, 'dining', 1);
const dInsights = getCandidateInsights(demo, dUniverse, 'dining', 'balance');
const dPool = getDrawPool(dInsights, 'balance', 1, 'standard', 10, demo).pool;
const dFiltered = filterFairDrawPool(dPool, 1, demo);
console.log('\n예시 (A·B 가깝고 C 멀리):');
console.log(`  끄기: ${dPool.length}개, 최대 편차 ${maxSpread(dPool)}분`);
console.log(`  켜기: ${dFiltered.length}개, 최대 편차 ${maxSpread(dFiltered)}분`);

process.exitCode = overLimitAfterFilter === 0 ? 0 : 1;
