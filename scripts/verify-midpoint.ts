/**
 * 중간지점 추천 파이프라인 검증 하네스.
 * PlannerScreen.tsx:1266-1290과 동일한 흐름을 다양한 거리 시나리오로 실행한다:
 *   buildCandidateUniverse → getCandidateInsights → (isCloseGroup) getCloseBalancedCandidateInsights
 *
 * 실행: npx tsx scripts/verify-midpoint.ts
 */
import {
  buildCandidateUniverse,
  getCandidateInsights,
  getCloseBalancedCandidateInsights,
  getCloseParticipantContext,
  getDistanceKm,
} from '../src/app/lib/meeting';
import { mockCandidates } from '../src/app/data/mockData';
import { Coordinates, Participant } from '../src/app/types';

function participant(
  id: string,
  name: string,
  location: string,
  coordinates: Coordinates,
): Participant {
  return { id, name, location, coordinates, maxTravelTime: 45 };
}

interface Scenario {
  key: string;
  title: string;
  participants: Participant[];
}

const scenarios: Scenario[] = [
  {
    key: 'same-spot',
    title: '동일 지점 2명 (강남역)',
    participants: [
      participant('a', '가영', '강남역', { lat: 37.4979, lng: 127.0276 }),
      participant('b', '나윤', '강남역', { lat: 37.4979, lng: 127.0276 }),
    ],
  },
  {
    key: 'walk-dense',
    title: '도보권 2명 · 역 밀집지역 (강남역 ±0.3km)',
    participants: [
      participant('a', '가영', '강남역 북측', { lat: 37.5009, lng: 127.0276 }),
      participant('b', '나윤', '강남역 남측', { lat: 37.4949, lng: 127.0276 }),
    ],
  },
  {
    key: 'walk-sparse',
    title: '도보권 2명 · 역 희박지역 (마곡, ~0.8km)',
    participants: [
      participant('a', '가영', '마곡동', { lat: 37.5636, lng: 126.8251 }),
      participant('b', '나윤', '마곡나루', { lat: 37.5566, lng: 126.8262 }),
    ],
  },
  {
    key: 'near-sparse',
    title: '근거리 2명 · 역 희박지역 (천호–강동, ~0.9km)',
    participants: [
      participant('a', '가영', '천호동', { lat: 37.5385, lng: 127.1238 }),
      participant('b', '나윤', '강동역 근처', { lat: 37.5359, lng: 127.1327 }),
    ],
  },
  {
    key: 'near-dense',
    title: '근거리 2명 · 역 밀집지역 (신림–서울대입구, ~2km)',
    participants: [
      participant('a', '가영', '신림동', { lat: 37.4842, lng: 126.9297 }),
      participant('b', '나윤', '서울대입구', { lat: 37.4812, lng: 126.9527 }),
    ],
  },
  {
    key: 'mid-hubs',
    title: '중거리 2명 (사당–잠실, ~12km)',
    participants: [
      participant('a', '가영', '사당역', { lat: 37.4766, lng: 126.9817 }),
      participant('b', '나윤', '잠실역', { lat: 37.5133, lng: 127.1001 }),
    ],
  },
  {
    key: 'far',
    title: '원거리 2명 (수원역–노원역, ~44km)',
    participants: [
      participant('a', '가영', '수원역', { lat: 37.266, lng: 126.9998 }),
      participant('b', '나윤', '노원역', { lat: 37.6558, lng: 127.0612 }),
    ],
  },
  {
    key: 'trio-close',
    title: '근거리 3명 (관악: 신림·봉천·낙성대)',
    participants: [
      participant('a', '가영', '신림동', { lat: 37.4842, lng: 126.9297 }),
      participant('b', '나윤', '봉천동', { lat: 37.4824, lng: 126.9419 }),
      participant('c', '다혜', '낙성대', { lat: 37.4769, lng: 126.9637 }),
    ],
  },
  {
    key: 'trio-sparse',
    title: '근거리 3명 · 역 희박 (천호·강동·둔촌, ~1.5km)',
    participants: [
      participant('a', '가영', '천호동', { lat: 37.5385, lng: 127.1238 }),
      participant('b', '나윤', '강동역 근처', { lat: 37.5359, lng: 127.1327 }),
      participant('c', '다혜', '성내동', { lat: 37.5297, lng: 127.128 }),
    ],
  },
  {
    key: 'incheon-sparse',
    title: '근거리 2명 · 초희박지역 (인천 구월동, ~1km)',
    participants: [
      participant('a', '가영', '구월동', { lat: 37.4478, lng: 126.7317 }),
      participant('b', '나윤', '간석동', { lat: 37.4568, lng: 126.7326 }),
    ],
  },
  {
    key: 'eunpyeong-sparse',
    title: '근거리 2명 · 초희박지역 (은평 불광·연신내, ~1.5km)',
    participants: [
      participant('a', '가영', '불광동', { lat: 37.6103, lng: 126.929 }),
      participant('b', '나윤', '연신내', { lat: 37.6191, lng: 126.9209 }),
    ],
  },
  {
    key: 'cluster',
    title: '클러스터 3명 (부천 2명 + 강남 1명)',
    participants: [
      participant('a', '가영', '부천시청', { lat: 37.5045, lng: 126.7662 }),
      participant('b', '나윤', '부천 중동', { lat: 37.5029, lng: 126.7748 }),
      participant('c', '다혜', '강남역', { lat: 37.4979, lng: 127.0276 }),
    ],
  },
];

function idPrefix(id: string) {
  const known = ['midpoint-', 'close-range-', 'close-center-', 'participant-near-', 'thrill-'];
  const hit = known.find((prefix) => id.startsWith(prefix));
  return hit ? hit.replace(/-$/, '') : 'seed';
}

function pairKm(participants: Participant[]) {
  let max = 0;
  for (let i = 0; i < participants.length; i += 1) {
    for (let j = i + 1; j < participants.length; j += 1) {
      max = Math.max(max, getDistanceKm(participants[i].coordinates, participants[j].coordinates));
    }
  }
  return max;
}

let flagTotal = 0;

for (const scenario of scenarios) {
  const { participants } = scenario;
  const closeCtx = getCloseParticipantContext(participants);
  const universe = buildCandidateUniverse(participants, mockCandidates, 'dining', 1);
  const insights = getCandidateInsights(participants, universe, 'dining', 'balance');
  const scoped = closeCtx.isCloseGroup
    ? getCloseBalancedCandidateInsights(insights, participants)
    : insights;

  const generatedCounts = universe.reduce<Record<string, number>>((acc, candidate) => {
    const prefix = idPrefix(candidate.id);
    acc[prefix] = (acc[prefix] ?? 0) + 1;
    return acc;
  }, {});

  const flags: string[] = [];
  if (scoped.length < 3) {
    flags.push(`후보 부족: 최종 ${scoped.length}개 (<3)`);
  }
  if (closeCtx.isCloseGroup) {
    const top = scoped[0];
    if (top && top.centerDistance > closeCtx.candidateLimitKm + 3.2) {
      flags.push(
        `1순위가 중심에서 과도하게 멂: ${top.candidate.name} centerDistance=${top.centerDistance}km (한도 ${(closeCtx.candidateLimitKm + 3.2).toFixed(1)}km)`,
      );
    }
    const syntheticOnly = scoped.every((item) => item.candidate.id.startsWith('close-center-'));
    if (scoped.length > 0 && syntheticOnly) {
      flags.push('실제 장소 없이 합성 중심좌표 후보만 남음');
    }
  } else {
    const top = scoped[0];
    const pair = pairKm(participants);
    if (top && top.centerDistance > pair * 0.45) {
      flags.push(
        `1순위가 중심축에서 이탈: ${top.candidate.name} centerDistance=${top.centerDistance}km (참여자 최대거리 ${pair.toFixed(1)}km)`,
      );
    }
    if (top && top.spreadDuration > 25) {
      flags.push(`1순위 이동시간 격차 큼: spread=${top.spreadDuration}분`);
    }
  }
  flagTotal += flags.length;

  console.log('='.repeat(78));
  console.log(`[${scenario.key}] ${scenario.title}`);
  console.log(
    `  closeGroup=${closeCtx.isCloseGroup} spreadKm=${closeCtx.spreadKm.toFixed(2)} ` +
      `limitKm=${closeCtx.candidateLimitKm.toFixed(2)} pairKm=${pairKm(participants).toFixed(2)}`,
  );
  console.log(
    `  universe=${universe.length} (${Object.entries(generatedCounts)
      .map(([key, count]) => `${key}:${count}`)
      .join(', ')})`,
  );
  console.log(`  최종 후보 수: ${scoped.length}`);
  for (const insight of scoped.slice(0, 6)) {
    const durations = insight.travelInfo.map((info) => `${info.duration}분`).join('/');
    console.log(
      `    - ${insight.candidate.name.padEnd(14, ' ')} [${idPrefix(insight.candidate.id)}] ` +
        `center=${insight.centerDistance}km axis=${insight.axisDistance}km ` +
        `이동=(${durations}) spread=${insight.spreadDuration}분`,
    );
  }
  if (flags.length) {
    for (const flag of flags) {
      console.log(`  ⚠️ FLAG: ${flag}`);
    }
  } else {
    console.log('  ✅ 플래그 없음');
  }
}

console.log('='.repeat(78));
console.log(`총 플래그 수: ${flagTotal}`);
