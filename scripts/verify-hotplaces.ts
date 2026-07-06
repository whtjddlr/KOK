/**
 * 근거리 핫플 프로브 검증 하네스.
 * 네이버 검색 결과를 mock으로 주입해 순수 함수와 전체 파이프라인 랭킹을 검증한다:
 *   buildCloseRangeHotplaceQueries / buildHotplaceCandidatesFromSearchItems
 *   → candidateSeeds 합류 → buildCandidateUniverse → insights → close 필터 → 랭킹
 *
 * 실행: npx tsx scripts/verify-hotplaces.ts
 */
import {
  buildCloseRangeHotplaceQueries,
  buildHotplaceCandidatesFromSearchItems,
} from '../src/app/lib/close-range-hotplaces';
import {
  buildCandidateUniverse,
  getCandidateInsights,
  getCloseBalancedCandidateInsights,
  getCloseParticipantContext,
  getDistanceKm,
} from '../src/app/lib/meeting';
import { mockCandidates } from '../src/app/data/mockData';
import { NearbySearchItem } from '../src/app/lib/naver-local-search';
import { Coordinates, Participant } from '../src/app/types';

function participant(
  id: string,
  name: string,
  location: string,
  coordinates: Coordinates,
): Participant {
  return { id, name, location, coordinates, maxTravelTime: 45 };
}

function shop(
  name: string,
  categoryPath: string,
  roadAddress: string,
  lat: number,
  lng: number,
): NearbySearchItem {
  return {
    name,
    link: '',
    categoryPath,
    description: '',
    address: roadAddress,
    roadAddress,
    coordinates: { lat, lng },
  };
}

let failures = 0;

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('■ 시나리오 1: 은평 불광·연신내 — 연신내 상권이 실제 후보로 승격되는가');

const eunpyeong = [
  participant('a', '가영', '불광동', { lat: 37.6103, lng: 126.929 }),
  participant('b', '나윤', '연신내', { lat: 37.6191, lng: 126.9209 }),
];

const queries = buildCloseRangeHotplaceQueries(eunpyeong, 'dining');
console.log(`  쿼리: ${JSON.stringify(queries)}`);
check('쿼리가 1개 이상 생성됨', queries.length >= 1);
check(
  '쿼리에 참여자 지역명이 포함됨',
  queries.some((query) => query.includes('연신내') || query.includes('불광')),
);

// 연신내역(37.619, 126.921) 주변 300m 내 매장 6곳 + 노이즈
const yeonsinnae: Record<string, NearbySearchItem[]> = {
  '연신내 맛집': [
    shop('연신내 갈매기살 본점', '음식점>육류,고기요리', '서울 은평구 연서로29길 8', 37.6195, 126.9215),
    shop('토속촌 감자탕', '음식점>한식', '서울 은평구 연서로28길 12', 37.6188, 126.9204),
    shop('스타벅스 연신내역점', '카페>커피전문점', '서울 은평구 연서로 214', 37.6193, 126.9211), // 프랜차이즈 → 걸러져야 함
    shop('연서시장 곱창', '음식점>곱창,막창', '서울 은평구 연서로29길 22', 37.6199, 126.9219),
    shop('평양면옥 연신내', '음식점>냉면', '서울 은평구 통일로 855', 37.6185, 126.9198),
  ],
  '불광동 맛집': [
    shop('불광 순대국', '음식점>한식', '서울 은평구 통일로 723', 37.6109, 126.9295),
    shop('연신내 파스타집', '음식점>이탈리아음식', '서울 은평구 연서로26길 5', 37.6181, 126.9207),
    // 반경 밖 노이즈 (일산, ~15km) → 걸러져야 함
    shop('일산 라페스타 맛집', '음식점>한식', '경기 고양시 일산동구 중앙로 1305', 37.6584, 126.7698),
  ],
};

const eunpyeongCandidates = buildHotplaceCandidatesFromSearchItems({
  participants: eunpyeong,
  selectedCategory: 'dining',
  itemsByQuery: yeonsinnae,
});

console.log(
  `  승격 후보: ${eunpyeongCandidates.map((c) => `${c.name}(${c.id})`).join(', ') || '(없음)'}`,
);
check('상권 후보가 1개 이상 승격됨', eunpyeongCandidates.length >= 1);

const center = {
  lat: (37.6103 + 37.6191) / 2,
  lng: (126.929 + 126.9209) / 2,
};
const closeCtx = getCloseParticipantContext(eunpyeong);
check(
  '승격 후보가 모두 반경 한도 안에 있음',
  eunpyeongCandidates.every(
    (c) => getDistanceKm(center, c.coordinates) <= closeCtx.candidateLimitKm + 3.2,
  ),
);
check(
  '일산(반경 밖) 좌표가 후보에 없음',
  eunpyeongCandidates.every((c) => getDistanceKm(c.coordinates, { lat: 37.6584, lng: 126.7698 }) > 3),
);

// ── 전체 파이프라인: seeds에 합류시켜 랭킹 확인 (PlannerScreen 흐름 재현)
const universe = buildCandidateUniverse(
  eunpyeong,
  [...mockCandidates, ...eunpyeongCandidates],
  'dining',
  1,
);
const insights = getCandidateInsights(eunpyeong, universe, 'dining', 'balance');
const scoped = getCloseBalancedCandidateInsights(insights, eunpyeong);

console.log('  최종 랭킹 상위 5:');
scoped.slice(0, 5).forEach((insight, index) => {
  console.log(
    `    ${index + 1}. ${insight.candidate.name} [${insight.candidate.id.split('-').slice(0, 2).join('-')}] center=${insight.centerDistance}km`,
  );
});
check(
  '핫플 상권 후보가 최종 풀에 포함됨',
  scoped.some((insight) => insight.candidate.id.startsWith('naver-close-')),
);
check(
  '1위가 합성 좌표(close-center)가 아님',
  !scoped[0]?.candidate.id.startsWith('close-center-'),
  `1위: ${scoped[0]?.candidate.name}`,
);
check(
  '1위가 참여자 생활권 후보(naver-close 또는 근접 실제 장소)임',
  Boolean(scoped[0]) && scoped[0].centerDistance <= closeCtx.candidateLimitKm + 3.2,
  `1위 centerDistance=${scoped[0]?.centerDistance}km`,
);

// ───────────────────────────────────────────────────────────────────────────
console.log('■ 시나리오 2: 마곡 — 상권 후보가 원거리 꼬리(망원·신도림)를 밀어내는가');

const magok = [
  participant('a', '가영', '마곡동', { lat: 37.5636, lng: 126.8251 }),
  participant('b', '나윤', '마곡나루', { lat: 37.5566, lng: 126.8262 }),
];

const magokItems: Record<string, NearbySearchItem[]> = {
  '마곡동 맛집': [
    shop('마곡나루 수제버거', '음식점>햄버거', '서울 강서구 마곡중앙로 161', 37.5601, 126.8256),
    shop('보타닉 브런치', '음식점>브런치', '서울 강서구 마곡중앙5로 6', 37.5607, 126.8271),
    shop('마곡 한우촌', '음식점>육류,고기요리', '서울 강서구 마곡중앙로 136', 37.5594, 126.8248),
    shop('서울식물원 앞 파스타', '음식점>이탈리아음식', '서울 강서구 마곡동로 55', 37.5611, 126.8263),
  ],
  '마곡나루 카페': [
    shop('식물원 뷰 카페', '카페>카페,디저트', '서울 강서구 마곡동로 62', 37.5615, 126.8259),
    // 마곡나루역 북측 제2 상권 클러스터 (카페 쿼리 → 카페 결과)
    shop('나루 브루잉', '카페>커피전문점', '서울 강서구 마곡서로 152', 37.5668, 126.8273),
    shop('마곡나루 티하우스', '카페>찻집', '서울 강서구 마곡서로 158', 37.5672, 126.8268),
    shop('리버뷰 디저트바', '카페>디저트카페', '서울 강서구 마곡서로 133', 37.5661, 126.8279),
  ],
};

const magokCandidates = buildHotplaceCandidatesFromSearchItems({
  participants: magok,
  selectedCategory: 'dining',
  itemsByQuery: magokItems,
});
console.log(
  `  승격 후보: ${magokCandidates.map((c) => `${c.name}(${c.id})`).join(', ') || '(없음)'}`,
);
check('마곡 상권 후보가 승격됨', magokCandidates.length >= 1);

const magokUniverse = buildCandidateUniverse(
  magok,
  [...mockCandidates, ...magokCandidates],
  'dining',
  1,
);
const magokInsights = getCandidateInsights(magok, magokUniverse, 'dining', 'balance');
const magokScoped = getCloseBalancedCandidateInsights(magokInsights, magok);

console.log('  최종 랭킹 상위 5:');
magokScoped.slice(0, 5).forEach((insight, index) => {
  console.log(
    `    ${index + 1}. ${insight.candidate.name} center=${insight.centerDistance}km spread=${insight.spreadDuration}분`,
  );
});
check(
  '마곡 상권이 상위 2위 안에 있음 (김포공항역과 경쟁)',
  magokScoped
    .slice(0, 2)
    .some((insight) => insight.candidate.id.startsWith('naver-close-')),
);
check(
  '8km 밖 꼬리 후보(망원·신도림)가 상위 3위 안에 없음',
  magokScoped.slice(0, 3).every((insight) => insight.centerDistance <= 5.2),
);

// ───────────────────────────────────────────────────────────────────────────
console.log('■ 시나리오 3: 가드 — 프로브가 빈 결과/원거리일 때 안전한가');

const emptyCandidates = buildHotplaceCandidatesFromSearchItems({
  participants: eunpyeong,
  selectedCategory: 'dining',
  itemsByQuery: {},
});
check('검색 결과가 없으면 빈 배열 (역 폴백에 위임)', emptyCandidates.length === 0);

const farPair = [
  participant('a', '가영', '수원역', { lat: 37.266, lng: 126.9998 }),
  participant('b', '나윤', '노원역', { lat: 37.6558, lng: 127.0612 }),
];
const farCandidates = buildHotplaceCandidatesFromSearchItems({
  participants: farPair,
  selectedCategory: 'dining',
  itemsByQuery: yeonsinnae,
});
check('원거리 그룹이면 승격 자체를 안 함 (isCloseGroup 가드)', farCandidates.length === 0);

const sparseItems: Record<string, NearbySearchItem[]> = {
  '연신내 맛집': [
    shop('외딴 가게 하나', '음식점>한식', '서울 은평구 연서로 100', 37.6155, 126.925),
    shop('외딴 가게 둘', '음식점>한식', '서울 은평구 통일로 800', 37.6052, 126.9312),
  ],
};
const sparseCandidates = buildHotplaceCandidatesFromSearchItems({
  participants: eunpyeong,
  selectedCategory: 'dining',
  itemsByQuery: sparseItems,
});
check(
  '매장 3개 미만 클러스터는 상권으로 승격 안 함',
  sparseCandidates.length === 0,
  `승격됨: ${sparseCandidates.map((c) => c.name).join(', ')}`,
);

// ───────────────────────────────────────────────────────────────────────────
console.log('='.repeat(78));
if (failures === 0) {
  console.log('전체 통과 ✅');
} else {
  console.log(`실패 ${failures}건 ❌`);
  process.exitCode = 1;
}
