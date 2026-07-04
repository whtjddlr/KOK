import {
  Candidate,
  CandidateInsight,
  CandidateScopeKey,
  Coordinates,
  DrawPlan,
  MeetCategoryKey,
  Participant,
  SelectionModeKey,
  ThrillLevel,
  TravelInfo,
} from '../types';
import { stationOptions } from '../data/mockData';

type MetroAreaLabel = '서울' | '경기' | '인천';

const EARTH_RADIUS_KM = 6371;
const TRANSIT_SPEED_KM_PER_MIN = 0.45;
const CAR_SPEED_KM_PER_MIN = 0.62;
const CAR_ROUTE_DISTANCE_FACTOR = 1.22;
const CAR_FUEL_PRICE_PER_KM = 170;
const BASE_FARE = 1500;
const FARE_PER_KM = 110;
const MIN_TRAVEL_MINUTES = 12;
const INCHEON_KEYWORDS = [
  '인천',
  '송도',
  '부평',
  '구월',
  '청라',
  '주안',
  '계양',
  '연수',
  '검암',
  '작전',
  '동인천',
  '인하',
  '월미',
];
const GYEONGGI_KEYWORDS = [
  '수원',
  '영통',
  '광교',
  '부천',
  '범계',
  '안양',
  '평촌',
  '판교',
  '서현',
  '분당',
  '정발산',
  '일산',
  '고양',
  '광명',
  '철산',
  '안산',
  '중앙',
  '용인',
  '죽전',
  '수지',
  '동탄',
  '구리',
  '남양주',
  '하남',
  '의정부',
  '김포',
  '구래',
  '시흥',
  '산본',
  '군포',
];

const ALL_MEET_CATEGORIES: MeetCategoryKey[] = [
  'dining',
  'cafe',
  'drink',
  'date',
  'culture',
  'activity',
];


function getCandidateScopeBonus(candidateScope: CandidateScopeKey = 'standard') {
  if (candidateScope === 'max') {
    return 8;
  }

  if (candidateScope === 'wide') {
    return 4;
  }

  return 0;
}

function getDrawPoolExtra(candidateScope: CandidateScopeKey = 'standard') {
  if (candidateScope === 'max') {
    return 4;
  }

  if (candidateScope === 'wide') {
    return 2;
  }

  return 0;
}

function normalizeTargetCount(total: number, requestedTargetCount?: number) {
  if (typeof requestedTargetCount !== 'number' || Number.isNaN(requestedTargetCount)) {
    return null;
  }

  return Math.max(1, Math.min(Math.round(requestedTargetCount), total));
}

function toThrillLevel(value: number): ThrillLevel {
  return clamp(Math.round(value), 1, 5) as ThrillLevel;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const FAIRNESS_SPREAD_LIMIT_BY_LEVEL: Record<ThrillLevel, number> = {
  1: 10,
  2: 15,
  3: 20,
  4: 25,
  5: 35,
};

const MIN_BALANCE_DRAW_POOL_SIZE = 3;
const PREFERRED_BALANCE_DRAW_POOL_SIZE = 4;
const FAIRNESS_LEVEL_DISTANCE_SCALE: Record<ThrillLevel, number> = {
  1: 0.55,
  2: 0.72,
  3: 0.88,
  4: 1,
  5: 1.15,
};
const FAIRNESS_DYNAMIC_CAP_BY_LEVEL: Record<ThrillLevel, number> = {
  1: 18,
  2: 24,
  3: 32,
  4: 44,
  5: 58,
};

function getAdaptiveFairnessSpreadBonus(participants: Participant[] = []) {
  if (participants.length < 2) {
    return 0;
  }

  const center = getBalancedParticipantCenter(participants, 'balance');
  const pairDistanceKm = getMaxParticipantPairDistanceKm(participants);
  const spreadKm = getParticipantSpreadKm(participants, center);
  const pairBaseKm = participants.length >= 3 ? 18 : 16;
  const pairBonus = Math.max(0, pairDistanceKm - pairBaseKm) * (participants.length >= 3 ? 0.42 : 0.32);
  const spreadBonus = Math.max(0, spreadKm - 8) * (participants.length >= 3 ? 0.55 : 0.35);
  const complexityBonus = Math.max(0, participants.length - 2) * 3;

  return Math.min(30, Math.round(pairBonus + spreadBonus + complexityBonus));
}

export function getFairnessSpreadLimit(
  level: ThrillLevel = 1,
  participants: Participant[] = [],
) {
  const baseLimit = FAIRNESS_SPREAD_LIMIT_BY_LEVEL[level] ?? FAIRNESS_SPREAD_LIMIT_BY_LEVEL[1];
  const adaptiveBonus = getAdaptiveFairnessSpreadBonus(participants);

  if (!adaptiveBonus) {
    return baseLimit;
  }

  return Math.round(
    Math.min(
      FAIRNESS_DYNAMIC_CAP_BY_LEVEL[level],
      baseLimit + adaptiveBonus * FAIRNESS_LEVEL_DISTANCE_SCALE[level],
    ),
  );
}

function getFairnessOverage(
  insight: CandidateInsight,
  level: ThrillLevel = 1,
  participants: Participant[] = [],
) {
  return Math.max(0, getEffectiveFairnessSpread(insight, participants) - getFairnessSpreadLimit(level, participants));
}

export interface MinorityBenefitProfile {
  beneficiaryCount: number;
  majorityCount: number;
  majoritySpread: number;
  effectiveSpread: number;
  beneficiaryGap: number;
}

export function getMinorityBenefitProfile(
  insight: Pick<CandidateInsight, 'travelInfo' | 'spreadDuration'>,
  participants: Participant[] = [],
): MinorityBenefitProfile | null {
  const sortedDurations = [...insight.travelInfo]
    .map((info) => info.duration)
    .filter((duration) => Number.isFinite(duration))
    .sort((left, right) => left - right);
  const participantCount = sortedDurations.length;

  if (participantCount < 3) {
    return null;
  }

  const maxBeneficiaryCount = Math.max(
    1,
    Math.min(2, Math.floor(participantCount * (participantCount >= 6 ? 0.28 : 0.25))),
  );
  let bestProfile: MinorityBenefitProfile | null = null;

  for (let beneficiaryCount = 1; beneficiaryCount <= maxBeneficiaryCount; beneficiaryCount += 1) {
    const majorityDurations = sortedDurations.slice(beneficiaryCount);
    const majorityCount = majorityDurations.length;

    if (majorityCount < Math.max(2, Math.ceil(participantCount * 0.65))) {
      continue;
    }

    const beneficiaryMax = sortedDurations[beneficiaryCount - 1];
    const majorityMin = majorityDurations[0];
    const majorityMax = majorityDurations[majorityDurations.length - 1];
    const majorityMedian = majorityDurations[Math.floor((majorityDurations.length - 1) / 2)];
    const beneficiaryGap = majorityMin - beneficiaryMax;
    const requiredGap = Math.max(10, Math.round(majorityMedian * (participantCount >= 5 ? 0.2 : 0.24)));
    const majoritySpread = majorityMax - majorityMin;
    const majoritySpreadLimit = Math.max(
      12,
      Math.min(24, Math.round(majorityMedian * (participantCount >= 5 ? 0.38 : 0.34))),
    );

    if (beneficiaryGap < requiredGap || majoritySpread > majoritySpreadLimit) {
      continue;
    }

    const beneficiaryPenalty = Math.min(12, Math.round(beneficiaryGap * (participantCount >= 5 ? 0.22 : 0.28)));
    const crowdBonus = participantCount >= 5 ? Math.min(4, participantCount - 4) : 0;
    const effectiveSpread = Math.max(
      majoritySpread,
      Math.round(majoritySpread + beneficiaryPenalty - crowdBonus),
    );
    const nextProfile = {
      beneficiaryCount,
      majorityCount,
      majoritySpread,
      effectiveSpread,
      beneficiaryGap,
    };

    if (!bestProfile || nextProfile.effectiveSpread < bestProfile.effectiveSpread) {
      bestProfile = nextProfile;
    }
  }

  return bestProfile;
}

function getEffectiveFairnessSpread(
  insight: CandidateInsight,
  participants: Participant[] = [],
) {
  return getMinorityBenefitProfile(insight, participants)?.effectiveSpread ?? insight.spreadDuration;
}

function getLongTripPenalty(insight: CandidateInsight) {
  return (
    Math.max(0, insight.averageDuration - 48) * 0.85 +
    Math.max(0, insight.farthestDuration - 58) * 0.55
  );
}

function getCorridorDriftPenalty(insight: CandidateInsight) {
  const axisDrift = Math.max(0, insight.axisDistance - 4.2);
  const centerDrift = Math.max(0, insight.centerDistance - 8);
  const equalLongTripPenalty =
    insight.spreadDuration <= 10 && insight.averageDuration >= 34
      ? (insight.averageDuration - 33) * 2.2
      : 0;

  return axisDrift * 8.5 + centerDrift * 5.4 + equalLongTripPenalty;
}

function isDetachedFairnessTrap(insight: CandidateInsight) {
  return (
    insight.axisDistance >= 6 &&
    insight.centerDistance >= 7.5 &&
    insight.averageDuration >= 34 &&
    insight.spreadDuration <= 15
  );
}

export function getPracticalRouteGuardedInsights(
  insights: CandidateInsight[],
  minCount = 4,
) {
  if (insights.length <= 3) {
    return insights;
  }

  const reachableInsights = insights.filter((insight) => insight.allReachable);
  const baselineSource =
    reachableInsights.length >= Math.min(3, insights.length) ? reachableInsights : insights;
  const bestAverageDuration = Math.min(
    ...baselineSource.map((insight) => insight.averageDuration),
  );
  const bestFarthestDuration = Math.min(
    ...baselineSource.map((insight) => insight.farthestDuration),
  );
  const bestAxisDistance = Math.min(...baselineSource.map((insight) => insight.axisDistance));

  const guardedInsights = insights.filter((insight) => {
    const detachedLowSpreadOutlier = isDetachedFairnessTrap(insight);
    const lowSpreadButLonger =
      insight.spreadDuration <= 12 &&
      insight.averageDuration >= bestAverageDuration + 6 &&
      insight.axisDistance >= Math.max(5.5, bestAxisDistance + 2.8);
    const inefficientAgainstBest =
      insight.averageDuration >= bestAverageDuration + 7 ||
      insight.farthestDuration >= bestFarthestDuration + 5;

    return !(lowSpreadButLonger || (detachedLowSpreadOutlier && inefficientAgainstBest));
  });

  if (guardedInsights.length >= Math.min(minCount, insights.length)) {
    return guardedInsights;
  }

  const softlyGuardedInsights = insights.filter((insight) => {
    const clearlyDetached =
      insight.spreadDuration <= 8 &&
      insight.averageDuration >= bestAverageDuration + 8 &&
      insight.axisDistance >= Math.max(7, bestAxisDistance + 4);

    return !clearlyDetached;
  });

  return softlyGuardedInsights.length >= Math.min(minCount, insights.length)
    ? softlyGuardedInsights
    : insights;
}

function getFairnessBand(
  insight: CandidateInsight,
  level: ThrillLevel = 1,
  participants: Participant[] = [],
) {
  const limit = getFairnessSpreadLimit(level, participants);
  const softLimit = Math.min(getFairnessSpreadLimit(5, participants), limit + 5);
  const isDetached = isDetachedFairnessTrap(insight);
  const effectiveSpread = getEffectiveFairnessSpread(insight, participants);

  if (effectiveSpread <= limit && !isDetached) {
    return 0;
  }

  if (effectiveSpread <= softLimit && !isDetached) {
    return 1;
  }

  if (effectiveSpread <= limit) {
    return 2;
  }

  if (effectiveSpread <= softLimit) {
    return 3;
  }

  return 4;
}

function getFairnessRankingScore(
  insight: CandidateInsight,
  level: ThrillLevel = 1,
  participants: Participant[] = [],
) {
  const overage = getFairnessOverage(insight, level, participants);
  const overagePenalty = overage > 0 ? 80 + overage * 9 + overage * overage * 0.9 : 0;
  const effectiveSpread = getEffectiveFairnessSpread(insight, participants);

  return (
    getBalanceRankingScore(insight, participants) +
    effectiveSpread * 0.6 +
    getLongTripPenalty(insight) +
    overagePenalty +
    (insight.allReachable ? 0 : 20)
  );
}

function compareByFairnessLevel(
  left: CandidateInsight,
  right: CandidateInsight,
  level: ThrillLevel = 1,
  participants: Participant[] = [],
) {
  const leftBand = getFairnessBand(left, level, participants);
  const rightBand = getFairnessBand(right, level, participants);

  if (leftBand !== rightBand) {
    return leftBand - rightBand;
  }

  const scoreDiff =
    getFairnessRankingScore(left, level, participants) -
    getFairnessRankingScore(right, level, participants);

  if (Math.abs(scoreDiff) > 1) {
    return scoreDiff;
  }

  const leftEffectiveSpread = getEffectiveFairnessSpread(left, participants);
  const rightEffectiveSpread = getEffectiveFairnessSpread(right, participants);

  if (leftEffectiveSpread !== rightEffectiveSpread) {
    return leftEffectiveSpread - rightEffectiveSpread;
  }

  if (left.farthestDuration !== right.farthestDuration) {
    return left.farthestDuration - right.farthestDuration;
  }

  return left.averageDuration - right.averageDuration;
}

function isFullyRouteVerifiedInsight(insight: CandidateInsight) {
  return insight.routeVerification?.status === 'verified';
}

function mergeUniqueInsights(
  primary: CandidateInsight[],
  secondary: CandidateInsight[],
  limit: number,
) {
  const merged = [...primary];
  const seen = new Set(primary.map((insight) => insight.candidate.id));

  for (const insight of secondary) {
    if (seen.has(insight.candidate.id)) {
      continue;
    }

    merged.push(insight);
    seen.add(insight.candidate.id);

    if (merged.length >= limit) {
      break;
    }
  }

  return merged.slice(0, limit);
}

function getBalanceRelaxLimits(level: ThrillLevel) {
  return {
    axisLimit: level <= 2 ? 3.25 : level <= 4 ? 4.15 : 4.8,
    centerLimit: level <= 2 ? 7.4 : level <= 4 ? 8.8 : 10,
    averageSlack: level <= 2 ? 10 : level <= 4 ? 14 : 18,
    farthestSlack: level <= 2 ? 10 : level <= 4 ? 15 : 19,
  };
}

function getAutoRelaxedBalancePool(
  insights: CandidateInsight[],
  startLevel: ThrillLevel,
  targetSize: number,
  participants: Participant[] = [],
) {
  const reachableInsights = insights.filter((insight) => insight.allReachable);
  const baselineSource = reachableInsights.length ? reachableInsights : insights;
  const bestAverageDuration = Math.min(
    ...baselineSource.map((insight) => insight.averageDuration),
  );
  const bestFarthestDuration = Math.min(
    ...baselineSource.map((insight) => insight.farthestDuration),
  );
  const bestCenterDistance = Math.min(
    ...baselineSource.map((insight) => insight.centerDistance),
  );
  const bestAxisDistance = Math.min(...baselineSource.map((insight) => insight.axisDistance));
  const minPoolSize = Math.min(targetSize, insights.length, MIN_BALANCE_DRAW_POOL_SIZE);
  const preferredPoolSize = Math.min(
    targetSize,
    insights.length,
    PREFERRED_BALANCE_DRAW_POOL_SIZE,
  );
  let relaxedToLevel: ThrillLevel = startLevel;
  let pool: CandidateInsight[] = [];

  for (let level = startLevel; level <= 5; level += 1) {
    const relaxedLevel = toThrillLevel(level);
    const spreadLimit = getFairnessSpreadLimit(relaxedLevel, participants);
    const { axisLimit, centerLimit, averageSlack, farthestSlack } =
      getBalanceRelaxLimits(relaxedLevel);
    const rankedSource = [...insights].sort((left, right) =>
      compareByFairnessLevel(left, right, relaxedLevel, participants),
    );
    const levelPool = rankedSource.filter((insight) => {
      const routeVerifiedBonus = isFullyRouteVerifiedInsight(insight) ? 1.3 : 0;
      const effectiveSpread = getEffectiveFairnessSpread(insight, participants);

      return (
        insight.allReachable &&
        !isDetachedFairnessTrap(insight) &&
        effectiveSpread <= spreadLimit &&
        insight.axisDistance <= axisLimit + routeVerifiedBonus &&
        insight.centerDistance <= centerLimit + routeVerifiedBonus &&
        insight.averageDuration <= bestAverageDuration + averageSlack &&
        insight.farthestDuration <= bestFarthestDuration + farthestSlack
      );
    });

    pool = mergeUniqueInsights(pool, levelPool, targetSize);
    relaxedToLevel = relaxedLevel;

    if (pool.length >= preferredPoolSize) {
      return {
        pool,
        relaxedToLevel,
      };
    }
  }

  const safeFallback = getPracticalRouteGuardedInsights(
    [...insights].sort((left, right) => compareByFairnessLevel(left, right, 5, participants)),
    minPoolSize,
  ).filter((insight) => {
    const { axisLimit, centerLimit, averageSlack, farthestSlack } = getBalanceRelaxLimits(5);
    const effectiveSpread = getEffectiveFairnessSpread(insight, participants);

    return (
      insight.allReachable &&
      !isDetachedFairnessTrap(insight) &&
      effectiveSpread <= getFairnessSpreadLimit(5, participants) &&
      insight.axisDistance <= axisLimit + 0.8 &&
      insight.centerDistance <= centerLimit + 1.2 &&
      insight.averageDuration <= bestAverageDuration + averageSlack + 4 &&
      insight.farthestDuration <= bestFarthestDuration + farthestSlack + 5
    );
  });

  const safeMergedPool = mergeUniqueInsights(pool, safeFallback, targetSize);

  if (safeMergedPool.length >= minPoolSize) {
    return {
      pool: safeMergedPool,
      relaxedToLevel,
    };
  }

  const nearReachableFallback = getPracticalRouteGuardedInsights(
    [...insights].sort((left, right) => compareByFairnessLevel(left, right, 5, participants)),
    minPoolSize,
  );
  const centralFallbackCandidates = nearReachableFallback.filter((insight) => {
    const fallbackAxisLimit = Math.max(8.5, bestAxisDistance + 5.2);
    const fallbackCenterLimit = Math.max(11.5, bestCenterDistance + 5.8);

    return (
      !isDetachedFairnessTrap(insight) &&
      insight.axisDistance <= fallbackAxisLimit &&
      insight.centerDistance <= fallbackCenterLimit &&
      insight.averageDuration <= bestAverageDuration + 10 &&
      insight.farthestDuration <= bestFarthestDuration + 12
    );
  });
  const bestCentralSpread = centralFallbackCandidates.length
    ? Math.min(
        ...centralFallbackCandidates.map((insight) =>
          getEffectiveFairnessSpread(insight, participants),
        ),
      )
    : getFairnessSpreadLimit(5, participants);
  const impossibleFairnessSpreadLimit = Math.max(
    getFairnessSpreadLimit(5, participants),
    Math.min(72, bestCentralSpread + 14),
  );
  const impossibleFairnessFallback = centralFallbackCandidates.filter((insight) => {
    return (
      !isDetachedFairnessTrap(insight) &&
      getEffectiveFairnessSpread(insight, participants) <= impossibleFairnessSpreadLimit
    );
  });

  return {
    pool: mergeUniqueInsights(safeMergedPool, impossibleFairnessFallback, targetSize),
    relaxedToLevel,
  };
}

function mergeUniqueRankedInsights<T extends { insight: CandidateInsight }>(
  primary: T[],
  secondary: T[],
  limit: number,
) {
  const merged = [...primary];
  const seen = new Set(primary.map((item) => item.insight.candidate.id));

  for (const item of secondary) {
    if (seen.has(item.insight.candidate.id)) {
      continue;
    }

    merged.push(item);
    seen.add(item.insight.candidate.id);

    if (merged.length >= limit) {
      break;
    }
  }

  return merged.slice(0, limit);
}

function getParticipantDuration(insight: CandidateInsight, participant: Participant) {
  return (
    insight.travelInfo.find((info) => info.participantId === participant.id)?.duration ??
    Number.MAX_SAFE_INTEGER
  );
}

function isParticipantLocalInsight(insight: CandidateInsight, participant: Participant) {
  return (
    insight.nearestParticipantName === participant.name ||
    insight.candidate.tags.includes(participant.name) ||
    insight.candidate.id.includes(`-${participant.id}-`) ||
    insight.candidate.id.endsWith(`-${participant.id}`) ||
    insight.candidate.district.includes(`${participant.name} 근처`)
  );
}

function isHouseFrontCandidate(candidate: Candidate) {
  return candidate.id.startsWith('thrill-hyper-');
}

function isLocalWildcardCandidate(candidate: Candidate) {
  return (
    isHouseFrontCandidate(candidate) ||
    candidate.id.startsWith('thrill-local-') ||
    candidate.id.startsWith('participant-near-')
  );
}

const HOTPLACE_KEYWORDS = [
  '핫',
  '힙',
  '트렌디',
  '번화가',
  '메인 상권',
  '맛집',
  '카페',
  '브런치',
  '데이트',
  '펍',
  '와인',
  '칵테일',
  '복합몰',
  '전시',
  '문화',
  '산책',
  '한강',
  '호수',
  '레트로',
  '도심',
];

function getHotplaceAppealBonus(insight: CandidateInsight) {
  const candidate = insight.candidate;
  const haystack = [
    candidate.name,
    candidate.district,
    candidate.description,
    candidate.vibe,
    candidate.bestFor,
    candidate.tags.join(' '),
  ].join(' ');
  const keywordHitCount = HOTPLACE_KEYWORDS.reduce(
    (count, keyword) => count + (haystack.includes(keyword) ? 1 : 0),
    0,
  );
  const moodBonus =
    candidate.drawMood === '무드 픽'
      ? -8
      : candidate.drawMood === '반전 픽'
        ? -5
        : 0;
  const categoryBonus = insight.categoryMatched ? -12 : 4;
  const generatedPenalty =
    candidate.id.startsWith('participant-near-') || candidate.id.startsWith('thrill-')
      ? 22
      : candidate.id.startsWith('close-range-')
        ? 8
        : candidate.id.startsWith('midpoint-')
          ? 5
          : 0;

  return categoryBonus + moodBonus - Math.min(18, keywordHitCount * 3) + generatedPenalty;
}

export function getHotplaceRankingScore(insight: CandidateInsight, level: ThrillLevel = 1) {
  void level;
  const reachPenalty = insight.allReachable ? 0 : 28;
  const routeVerifiedBonus = isFullyRouteVerifiedInsight(insight) ? -4 : 0;

  return (
    getHotplaceAppealBonus(insight) +
    insight.averageDuration * 0.3 +
    insight.farthestDuration * 0.18 +
    insight.centerDistance * 0.18 +
    insight.axisDistance * 0.12 +
    getLongTripPenalty(insight) * 0.26 +
    reachPenalty +
    routeVerifiedBonus
  );
}

function getParticipantLocalScore(insight: CandidateInsight, participant: Participant) {
  const duration = getParticipantDuration(insight, participant);
  const explicitLocalBonus = isParticipantLocalInsight(insight, participant) ? -28 : 0;
  const houseFrontBonus = isHouseFrontCandidate(insight.candidate) ? -18 : 0;
  const wildcardBonus = isLocalWildcardCandidate(insight.candidate) ? -8 : 0;
  const nearestBonus = insight.nearestParticipantName === participant.name ? -10 : 0;

  return (
    duration * 0.78 +
    insight.spreadDuration * 0.72 +
    insight.farthestDuration * 0.24 +
    insight.centerDistance * 0.18 +
    explicitLocalBonus +
    houseFrontBonus +
    wildcardBonus +
    nearestBonus
  );
}

function isExplicitParticipantLocalInsight(
  insight: CandidateInsight,
  participant: Participant,
  requireHouseFront = false,
) {
  if (!isParticipantLocalInsight(insight, participant)) {
    return false;
  }

  return requireHouseFront
    ? isHouseFrontCandidate(insight.candidate)
    : isLocalWildcardCandidate(insight.candidate);
}

function getParticipantLocalAnchor(
  rankedInsights: CandidateInsight[],
  participant: Participant,
  usedCandidateIds: Set<string>,
  requireHouseFront = false,
) {
  const unusedInsights = rankedInsights.filter(
    (insight) => !usedCandidateIds.has(insight.candidate.id),
  );
  const preferredHouseFront = requireHouseFront
    ? unusedInsights
        .filter((insight) => isExplicitParticipantLocalInsight(insight, participant, true))
        .sort(
          (left, right) =>
            getParticipantLocalScore(left, participant) -
            getParticipantLocalScore(right, participant),
        )[0]
    : null;

  if (preferredHouseFront) {
    return preferredHouseFront;
  }

  const preferredLocalWildcard = unusedInsights
    .filter((insight) => isExplicitParticipantLocalInsight(insight, participant, false))
    .sort(
      (left, right) =>
        getParticipantLocalScore(left, participant) -
        getParticipantLocalScore(right, participant),
    )[0];

  if (preferredLocalWildcard) {
    return preferredLocalWildcard;
  }

  return unusedInsights
    .filter(
      (insight) =>
        isParticipantLocalInsight(insight, participant) ||
        insight.nearestParticipantName === participant.name ||
        getParticipantDuration(insight, participant) <= 16,
    )
    .sort(
      (left, right) =>
        getParticipantLocalScore(left, participant) -
        getParticipantLocalScore(right, participant),
    )[0];
}

function getRequiredParticipantLocalAnchors(
  rankedInsights: CandidateInsight[],
  participants: Participant[],
  limit: number,
  requireHouseFront = false,
) {
  const anchors: CandidateInsight[] = [];
  const usedCandidateIds = new Set<string>();
  const requiredCount = Math.min(participants.length, Math.max(0, limit));

  for (const participant of participants.slice(0, requiredCount)) {
    const localAnchor = getParticipantLocalAnchor(
      rankedInsights,
      participant,
      usedCandidateIds,
      requireHouseFront,
    );

    if (!localAnchor) {
      continue;
    }

    anchors.push(localAnchor);
    usedCandidateIds.add(localAnchor.candidate.id);
  }

  return anchors;
}

function getParticipantLocalAnchors(
  rankedInsights: CandidateInsight[],
  participants: Participant[],
  perParticipantLimit: number,
) {
  const anchors: CandidateInsight[] = [];
  const usedCandidateIds = new Set<string>();

  for (const participant of participants) {
    const participantAnchors = rankedInsights
      .filter(
        (insight) =>
          !usedCandidateIds.has(insight.candidate.id) &&
          (isParticipantLocalInsight(insight, participant) ||
            insight.nearestParticipantName === participant.name ||
            getParticipantDuration(insight, participant) <= 16),
      )
      .sort(
        (left, right) =>
          getParticipantLocalScore(left, participant) -
          getParticipantLocalScore(right, participant),
      )
      .slice(0, perParticipantLimit);

    for (const insight of participantAnchors) {
      anchors.push(insight);
      usedCandidateIds.add(insight.candidate.id);
    }
  }

  return anchors;
}

export function ensureParticipantLocalCoverage(
  rankedInsights: CandidateInsight[],
  selectedInsights: CandidateInsight[],
  participants: Participant[],
  limit = selectedInsights.length,
  options?: {
    selectionMode?: SelectionModeKey;
    thrillLevel?: ThrillLevel;
  },
) {
  if (participants.length < 2 || !rankedInsights.length || limit <= 0) {
    return selectedInsights.slice(0, limit);
  }

  const targetLimit = Math.min(Math.max(1, limit), rankedInsights.length);
  const nextInsights: CandidateInsight[] = [];
  const usedCandidateIds = new Set<string>();

  for (const insight of selectedInsights) {
    if (usedCandidateIds.has(insight.candidate.id)) {
      continue;
    }

    nextInsights.push(insight);
    usedCandidateIds.add(insight.candidate.id);

    if (nextInsights.length >= targetLimit) {
      break;
    }
  }

  const isLocalHeavyMode =
    options?.selectionMode === 'neighborhood' && (options.thrillLevel ?? 1) >= 4;
  const isHouseFrontMode =
    options?.selectionMode === 'neighborhood' && (options.thrillLevel ?? 1) >= 5;

  if (!isLocalHeavyMode) {
    return nextInsights.slice(0, targetLimit);
  }

  if (isHouseFrontMode) {
    const requiredLocalAnchors = getRequiredParticipantLocalAnchors(
      rankedInsights,
      participants,
      targetLimit,
      true,
    );

    if (requiredLocalAnchors.length) {
      return mergeUniqueInsights(requiredLocalAnchors, nextInsights, targetLimit);
    }
  }

  const localReserveLimit = isHouseFrontMode
    ? Math.min(participants.length, targetLimit)
    : isLocalHeavyMode
      ? Math.min(
          participants.length,
          Math.max(2, targetLimit - Math.max(2, Math.ceil(targetLimit * 0.65))),
        )
      : Math.min(
          participants.length,
          Math.max(2, targetLimit - Math.max(2, Math.ceil(targetLimit * 0.6))),
        );
  let insertedLocalCount = 0;

  for (const participant of participants) {
    if (insertedLocalCount >= localReserveLimit) {
      break;
    }

    const alreadyCovered = nextInsights.some((insight) =>
      isLocalHeavyMode
        ? isExplicitParticipantLocalInsight(insight, participant, isHouseFrontMode)
        : isParticipantLocalInsight(insight, participant),
    );

    if (alreadyCovered) {
      continue;
    }

    const localAnchor = getParticipantLocalAnchor(
      rankedInsights,
      participant,
      usedCandidateIds,
      isHouseFrontMode,
    );

    if (!localAnchor) {
      continue;
    }

    if (nextInsights.length >= targetLimit) {
      const replaceIndex = Math.max(
        0,
        nextInsights
          .map((insight, index) => ({ insight, index }))
          .reverse()
          .find(({ insight }) =>
            participants.every((item) =>
              isLocalHeavyMode
                ? !isExplicitParticipantLocalInsight(insight, item, false)
                : !isParticipantLocalInsight(insight, item),
            ),
          )?.index ?? nextInsights.length - 1,
      );

      usedCandidateIds.delete(nextInsights[replaceIndex].candidate.id);
      nextInsights.splice(replaceIndex, 1);
    }

    nextInsights.push(localAnchor);
    usedCandidateIds.add(localAnchor.candidate.id);
    insertedLocalCount += 1;
  }

  return nextInsights.slice(0, targetLimit);
}

function inferMetroAreaFromText(text: string) {
  const normalized = text.trim();

  if (!normalized) {
    return null;
  }

  if (INCHEON_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return '인천' as MetroAreaLabel;
  }

  if (GYEONGGI_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return '경기' as MetroAreaLabel;
  }

  return null;
}

function inferMetroAreaFromCoordinates(coordinates: Coordinates): MetroAreaLabel {
  if (coordinates.lng < 126.72 && coordinates.lat >= 37.28 && coordinates.lat <= 37.68) {
    return '인천';
  }

  if (
    coordinates.lat >= 37.42 &&
    coordinates.lat <= 37.70 &&
    coordinates.lng >= 126.77 &&
    coordinates.lng <= 127.18
  ) {
    return '서울';
  }

  return '경기';
}

export function inferMetroAreaLabel(candidate: Candidate) {
  return (
    inferMetroAreaFromText(`${candidate.name} ${candidate.district} ${candidate.tags.join(' ')}`) ??
    inferMetroAreaFromCoordinates(candidate.coordinates)
  );
}

function inferParticipantMetroArea(participant: Participant) {
  return (
    inferMetroAreaFromText(participant.location) ??
    inferMetroAreaFromCoordinates(participant.coordinates)
  );
}

function getParticipantMetroAreas(participants: Participant[]) {
  return [...new Set(participants.map((participant) => inferParticipantMetroArea(participant)))];
}

function ensureMetroAreaCoverage(
  rankedInsights: CandidateInsight[],
  baseInsights: CandidateInsight[],
  requiredAreas: MetroAreaLabel[],
  limit: number,
  fairnessLevel: ThrillLevel = 1,
  participants: Participant[] = [],
) {
  if (!requiredAreas.length) {
    return baseInsights.slice(0, limit);
  }

  const nextInsights: CandidateInsight[] = [];
  const usedCandidateIds = new Set<string>();
  const fairnessRankedInsights = [...rankedInsights].sort((left, right) =>
    compareByFairnessLevel(left, right, fairnessLevel, participants),
  );
  const fairAreaSource = fairnessRankedInsights.filter(
    (insight) => insight.spreadDuration <= getFairnessSpreadLimit(fairnessLevel, participants),
  );
  const areaSource = fairAreaSource.length ? fairAreaSource : fairnessRankedInsights;

  for (const area of requiredAreas) {
    const areaInsight = areaSource.find(
      (insight) =>
        inferMetroAreaLabel(insight.candidate) === area &&
        !usedCandidateIds.has(insight.candidate.id),
    );

    if (!areaInsight) {
      continue;
    }

    nextInsights.push(areaInsight);
    usedCandidateIds.add(areaInsight.candidate.id);
  }

  for (const insight of [...baseInsights, ...fairnessRankedInsights]) {
    if (usedCandidateIds.has(insight.candidate.id)) {
      continue;
    }

    nextInsights.push(insight);
    usedCandidateIds.add(insight.candidate.id);

    if (nextInsights.length >= limit) {
      break;
    }
  }

  const rankedIndex = new Map(
    fairnessRankedInsights.map((insight, index) => [insight.candidate.id, index]),
  );

  return nextInsights
    .sort(
      (left, right) =>
        (rankedIndex.get(left.candidate.id) ?? Number.MAX_SAFE_INTEGER) -
        (rankedIndex.get(right.candidate.id) ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, limit);
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function getDistanceKm(from: Coordinates, to: Coordinates) {
  const latDiff = toRadians(to.lat - from.lat);
  const lngDiff = toRadians(to.lng - from.lng);
  const startLat = toRadians(from.lat);
  const endLat = toRadians(to.lat);

  const haversine =
    Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
    Math.cos(startLat) *
      Math.cos(endLat) *
      Math.sin(lngDiff / 2) *
      Math.sin(lngDiff / 2);

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toLocalKm(coordinates: Coordinates, origin: Coordinates) {
  return {
    x: (coordinates.lng - origin.lng) * 111.32 * Math.cos(toRadians(origin.lat)),
    y: (coordinates.lat - origin.lat) * 111.32,
  };
}

function getDistanceToSegmentKm(point: Coordinates, start: Coordinates, end: Coordinates) {
  const origin = {
    lat: (point.lat + start.lat + end.lat) / 3,
    lng: (point.lng + start.lng + end.lng) / 3,
  };
  const p = toLocalKm(point, origin);
  const a = toLocalKm(start, origin);
  const b = toLocalKm(end, origin);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function getSegmentProjectionRatio(point: Coordinates, start: Coordinates, end: Coordinates) {
  const origin = {
    lat: (point.lat + start.lat + end.lat) / 3,
    lng: (point.lng + start.lng + end.lng) / 3,
  };
  const p = toLocalKm(point, origin);
  const a = toLocalKm(start, origin);
  const b = toLocalKm(end, origin);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 0) {
    return 0.5;
  }

  return clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0, 1);
}

export function getTravelDistanceFromMinutes(minutes: number) {
  return minutes * TRANSIT_SPEED_KM_PER_MIN;
}

function getParticipantCenter(participants: Participant[]) {
  if (!participants.length) {
    return null;
  }

  return {
    lat: participants.reduce((sum, participant) => sum + participant.coordinates.lat, 0) / participants.length,
    lng: participants.reduce((sum, participant) => sum + participant.coordinates.lng, 0) / participants.length,
  };
}

function getCoordinatesCenter(coordinates: Coordinates[]) {
  if (!coordinates.length) {
    return null;
  }

  return {
    lat: coordinates.reduce((sum, coordinate) => sum + coordinate.lat, 0) / coordinates.length,
    lng: coordinates.reduce((sum, coordinate) => sum + coordinate.lng, 0) / coordinates.length,
  };
}

interface ClusteredBalanceContext {
  center: Coordinates;
  axisStart: Coordinates;
  axisEnd: Coordinates;
  clusters: Array<{
    center: Coordinates;
    participantIds: string[];
    radiusKm: number;
    size: number;
  }>;
  separationKm: number;
}

function getClusteredBalanceContext(participants: Participant[]): ClusteredBalanceContext | null {
  if (participants.length < 3) {
    return null;
  }

  const pairDistances = participants.flatMap((participant, firstIndex) =>
    participants.slice(firstIndex + 1).map((otherParticipant, offsetIndex) => ({
      firstIndex,
      secondIndex: firstIndex + offsetIndex + 1,
      distance: getDistanceKm(participant.coordinates, otherParticipant.coordinates),
    })),
  );
  const closestPairDistance = Math.min(...pairDistances.map((pair) => pair.distance));

  if (!Number.isFinite(closestPairDistance) || closestPairDistance > 6.5) {
    return null;
  }

  const closeLinkLimit = Math.min(6.5, Math.max(4.2, closestPairDistance + 1.8));
  const parent = participants.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) {
      parent[index] = find(parent[index]);
    }

    return parent[index];
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);

    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  pairDistances.forEach((pair) => {
    if (pair.distance <= closeLinkLimit) {
      union(pair.firstIndex, pair.secondIndex);
    }
  });

  const clusterMap = new Map<number, Participant[]>();

  participants.forEach((participant, index) => {
    const root = find(index);
    clusterMap.set(root, [...(clusterMap.get(root) ?? []), participant]);
  });

  const clusters = [...clusterMap.values()].sort((left, right) => right.length - left.length);
  const hasDenseCluster = clusters.some((cluster) => cluster.length >= 2);

  if (!hasDenseCluster || clusters.length < 2) {
    return null;
  }

  const clusterDetails = clusters
    .map((cluster) => {
      const center = getParticipantCenter(cluster);

      if (!center) {
        return null;
      }

      return {
        center,
        participantIds: cluster.map((participant) => participant.id),
        radiusKm: getParticipantSpreadKm(cluster, center),
        size: cluster.length,
      };
    })
    .filter((cluster): cluster is NonNullable<typeof cluster> => Boolean(cluster));

  if (clusterDetails.length < 2) {
    return null;
  }

  const farthestClusterPair = clusterDetails
    .flatMap((cluster, firstIndex) =>
      clusterDetails.slice(firstIndex + 1).map((otherCluster, offsetIndex) => ({
        firstIndex,
        secondIndex: firstIndex + offsetIndex + 1,
        distance: getDistanceKm(cluster.center, otherCluster.center),
      })),
    )
    .sort((left, right) => right.distance - left.distance)[0];

  if (!farthestClusterPair) {
    return null;
  }

  const separationKm = farthestClusterPair.distance;
  const largestClusterRadius = Math.max(...clusterDetails.map((cluster) => cluster.radiusKm));
  const enoughSeparation = separationKm >= Math.max(7, largestClusterRadius + 4);

  if (!enoughSeparation) {
    return null;
  }

  const center = getCoordinatesCenter(clusterDetails.map((cluster) => cluster.center));
  const axisStart = clusterDetails[farthestClusterPair.firstIndex].center;
  const axisEnd = clusterDetails[farthestClusterPair.secondIndex].center;

  if (!center) {
    return null;
  }

  return {
    center,
    axisStart,
    axisEnd,
    clusters: clusterDetails,
    separationKm,
  };
}

function getBalancedParticipantCenter(
  participants: Participant[],
  selectionMode: SelectionModeKey = 'balance',
) {
  if (selectionMode !== 'balance') {
    return getParticipantCenter(participants);
  }

  return getClusteredBalanceContext(participants)?.center ?? getParticipantCenter(participants);
}

function getBalancedParticipantAxisDistanceKm(
  participants: Participant[],
  coordinates: Coordinates,
  center: Coordinates | null,
  selectionMode: SelectionModeKey = 'balance',
  clusteredContext = selectionMode === 'balance' ? getClusteredBalanceContext(participants) : null,
) {
  if (clusteredContext) {
    if (clusteredContext.clusters.length > 2 && center) {
      return Math.min(
        ...clusteredContext.clusters.map((cluster) =>
          getDistanceToSegmentKm(coordinates, center, cluster.center),
        ),
      );
    }

    return getDistanceToSegmentKm(
      coordinates,
      clusteredContext.axisStart,
      clusteredContext.axisEnd,
    );
  }

  return getParticipantAxisDistanceKm(participants, coordinates, center);
}

function getParticipantSpreadKm(participants: Participant[], center: Coordinates | null) {
  if (!participants.length || !center) {
    return 0;
  }

  return Math.max(
    ...participants.map((participant) => getDistanceKm(participant.coordinates, center)),
  );
}

function getMaxParticipantPairDistanceKm(participants: Participant[]) {
  if (participants.length < 2) {
    return 0;
  }

  return Math.max(
    ...participants.flatMap((participant, firstIndex) =>
      participants.slice(firstIndex + 1).map((otherParticipant) =>
        getDistanceKm(participant.coordinates, otherParticipant.coordinates),
      ),
    ),
  );
}

function getAdaptiveMaxTravelTime(
  participants: Participant[],
  participant: Participant | undefined,
  selectionMode: SelectionModeKey = 'balance',
) {
  const baseLimit = participant?.maxTravelTime ?? 45;

  if (!participant || participants.length < 2) {
    return baseLimit;
  }

  const pairDistanceKm = getMaxParticipantPairDistanceKm(participants);

  if (pairDistanceKm < 14) {
    return baseLimit;
  }

  const center = getBalancedParticipantCenter(participants, selectionMode);
  const speed =
    participant.travelMode === 'car' ? CAR_SPEED_KM_PER_MIN : TRANSIT_SPEED_KM_PER_MIN;
  const directPairMinutes =
    pairDistanceKm / speed + (participant.travelMode === 'car' ? 8 : 14);
  const centerMinutes = center
    ? getDistanceKm(participant.coordinates, center) /
        speed *
        (participant.travelMode === 'car' ? CAR_ROUTE_DISTANCE_FACTOR : 1.35) +
      10
    : baseLimit;
  const modeFactor =
    selectionMode === 'hotplace' ? 0.82 : selectionMode === 'neighborhood' ? 0.86 : 0.72;
  const distanceBuffer = pairDistanceKm >= 30 ? 8 : pairDistanceKm >= 22 ? 5 : 3;
  const adaptiveLimit = Math.round(
    Math.max(directPairMinutes * modeFactor, centerMinutes) + distanceBuffer,
  );
  const cap = participant.travelMode === 'car' ? 85 : 95;

  return Math.max(baseLimit, Math.min(cap, adaptiveLimit));
}

function getParticipantAxisDistanceKm(
  participants: Participant[],
  coordinates: Coordinates,
  center: Coordinates | null,
) {
  if (participants.length < 2) {
    return 0;
  }

  if (participants.length === 2) {
    return getDistanceToSegmentKm(
      coordinates,
      participants[0].coordinates,
      participants[1].coordinates,
    );
  }

  if (!center) {
    return 0;
  }

  return Math.min(
    ...participants.map((participant) =>
      getDistanceToSegmentKm(coordinates, center, participant.coordinates),
    ),
  );
}

function getDynamicAxisRadiusKm(participants: Participant[], center: Coordinates | null) {
  if (!participants.length || !center) {
    return 0;
  }

  const spreadKm = getParticipantSpreadKm(participants, center);
  const averageTravelRadiusKm =
    participants.reduce((sum, participant) => sum + getTravelDistanceFromMinutes(participant.maxTravelTime), 0) /
    participants.length;

  if (participants.length <= 2 && spreadKm <= 2.5) {
    return Math.max(2.2, spreadKm + 1.1);
  }

  if (participants.length <= 2 && spreadKm <= 5.5) {
    return Math.max(3.2, spreadKm + 1.5);
  }

  if (spreadKm <= 4) {
    return Math.max(3.4, spreadKm + 1.8);
  }

  return Math.max(5.5, Math.min(averageTravelRadiusKm * 0.95, spreadKm + 6));
}

function getBalancedCenterLimitKm(participants: Participant[], center: Coordinates | null) {
  if (!participants.length || !center) {
    return 0;
  }

  const spreadKm = getParticipantSpreadKm(participants, center);

  if (participants.length <= 2 && spreadKm <= 2.5) {
    return Math.max(2.1, spreadKm + 1);
  }

  if (participants.length <= 2 && spreadKm <= 5.5) {
    return Math.max(3, spreadKm + 1.4);
  }

  if (spreadKm <= 4) {
    return Math.max(3.3, spreadKm + 1.7);
  }

  return Math.max(2.8, spreadKm + (participants.length <= 2 ? 2.4 : 4.2));
}

function getTwoPersonBalanceLimits(participants: Participant[], center: Coordinates | null) {
  const spreadKm = getParticipantSpreadKm(participants, center);

  if (participants.length !== 2 || !center) {
    return null;
  }

  return {
    centerLimit: Math.max(3.4, Math.min(9.5, spreadKm * 0.42 + 2.2)),
    relaxedCenterLimit: Math.max(4.2, Math.min(11.5, spreadKm * 0.55 + 2.8)),
    axisLimit: Math.max(1.35, Math.min(3.4, spreadKm * 0.22 + 0.55)),
    strictAxisLimit: Math.max(1.15, Math.min(2.5, spreadKm * 0.16 + 0.4)),
  };
}

function getGroupBalanceLimits(
  participants: Participant[],
  center: Coordinates | null,
  clusteredContext: ClusteredBalanceContext | null,
) {
  if (participants.length < 3 || !center) {
    return null;
  }

  const spreadKm = getParticipantSpreadKm(participants, center);
  const centerLimit = clusteredContext
    ? Math.max(4.6, Math.min(12.5, clusteredContext.separationKm * 0.28 + 3))
    : participants.length >= 5
      ? Math.max(4.8, Math.min(10.5, spreadKm * 0.3 + 3.2))
      : Math.max(5.2, Math.min(12, spreadKm * 0.36 + 3.4));
  const relaxedCenterLimit =
    centerLimit + (participants.length >= 5 ? 2 : clusteredContext ? 2.4 : 2.8);
  const axisLimit = clusteredContext
    ? Math.max(1.8, Math.min(5.2, clusteredContext.separationKm * 0.1 + 1))
    : Math.max(2.1, Math.min(5.4, centerLimit * 0.46));
  const strictAxisLimit = Math.max(1.35, axisLimit * (participants.length >= 5 ? 0.68 : 0.74));

  return {
    centerLimit,
    relaxedCenterLimit,
    axisLimit,
    strictAxisLimit,
  };
}

function getTwoPersonCorridorPenalty(
  participants: Participant[],
  coordinates: Coordinates,
  center: Coordinates | null,
) {
  if (participants.length !== 2 || !center) {
    return 0;
  }

  const [first, second] = participants;
  const participantDistance = getDistanceKm(first.coordinates, second.coordinates);

  if (participantDistance <= 0.4) {
    return 0;
  }

  const projectionRatio = getSegmentProjectionRatio(
    coordinates,
    first.coordinates,
    second.coordinates,
  );
  const middleOffset = Math.abs(projectionRatio - 0.5);
  const endpointPenalty = Math.max(0, middleOffset - 0.22) * participantDistance * 1.15;
  const centerFlexKm = Math.max(1.2, Math.min(5.5, participantDistance * 0.16));
  const centerPenalty = Math.max(0, getDistanceKm(center, coordinates) - centerFlexKm) * 0.55;
  const axisPenalty =
    getDistanceToSegmentKm(coordinates, first.coordinates, second.coordinates) * 1.35;

  return endpointPenalty + centerPenalty + axisPenalty;
}

function getCloseCandidateLimitKm(spreadKm: number) {
  if (spreadKm <= 1.2) {
    return Math.max(1.8, spreadKm + 0.9);
  }

  if (spreadKm <= 2.5) {
    return Math.max(2.6, spreadKm + 1.1);
  }

  return Math.max(3.6, spreadKm + 1.3);
}

export function getCloseParticipantContext(participants: Participant[]) {
  const center = getParticipantCenter(participants);
  const spreadKm = getParticipantSpreadKm(participants, center);
  const candidateLimitKm = getCloseCandidateLimitKm(spreadKm);
  const axisLimitKm = Math.max(1.1, candidateLimitKm * (spreadKm <= 2.5 ? 0.5 : 0.55));
  const spreadLimitMinutes = spreadKm <= 2.5 ? 12 : 16;

  return {
    isCloseGroup: participants.length >= 2 && spreadKm <= 5.5,
    spreadKm,
    candidateLimitKm,
    axisLimitKm,
    spreadLimitMinutes,
  };
}

export function getCloseBalancedCandidateInsights(
  insights: CandidateInsight[],
  participants: Participant[],
) {
  const closeContext = getCloseParticipantContext(participants);

  if (!closeContext.isCloseGroup || !insights.length) {
    return insights;
  }

  const minimumUsefulCount = Math.min(4, insights.length);
  const strictInsights = insights.filter(
    (insight) =>
      insight.centerDistance <= closeContext.candidateLimitKm &&
      insight.axisDistance <= closeContext.axisLimitKm &&
      insight.spreadDuration <= closeContext.spreadLimitMinutes,
  );

  if (strictInsights.length >= minimumUsefulCount || strictInsights.length === insights.length) {
    return strictInsights;
  }

  const relaxedCenterLimit =
    closeContext.candidateLimitKm + (closeContext.spreadKm <= 1.2 ? 1.1 : 1.6);
  const relaxedAxisLimit = Math.max(
    closeContext.axisLimitKm + 0.9,
    closeContext.candidateLimitKm * 0.75,
  );
  const relaxedSpreadLimit =
    closeContext.spreadLimitMinutes + (closeContext.spreadKm <= 1.2 ? 6 : 8);
  const relaxedInsights = insights.filter(
    (insight) =>
      insight.centerDistance <= relaxedCenterLimit &&
      insight.axisDistance <= relaxedAxisLimit &&
      insight.spreadDuration <= relaxedSpreadLimit,
  );
  const relaxedLimit = Math.min(8, Math.max(minimumUsefulCount, relaxedInsights.length));
  const mergedRelaxedInsights = mergeUniqueInsights(
    strictInsights,
    relaxedInsights,
    relaxedLimit,
  );

  if (mergedRelaxedInsights.length) {
    return mergedRelaxedInsights;
  }

  const nearestReasonableInsights = insights.filter(
    (insight) =>
      insight.centerDistance <= closeContext.candidateLimitKm + 3.2 &&
      insight.spreadDuration <= closeContext.spreadLimitMinutes + 12,
  );

  if (nearestReasonableInsights.length) {
    return nearestReasonableInsights.slice(
      0,
      Math.min(8, Math.max(minimumUsefulCount, nearestReasonableInsights.length)),
    );
  }

  return insights.slice(0, Math.min(Math.max(minimumUsefulCount, participants.length + 1), insights.length));
}

function getTravelSpread(travelInfo: TravelInfo[]) {
  const durations = travelInfo.map((info) => info.duration);

  return Math.max(...durations) - Math.min(...durations);
}

function getLocalityStrength(nearestDuration: number) {
  return Math.max(0, 30 - nearestDuration);
}

function offsetCoordinates(coordinates: Coordinates, index: number, distanceFactor: number) {
  const latOffset = 0.0035 * distanceFactor * ((index % 2 === 0 ? 1 : -1) * 0.8);
  const lngOffset = 0.0045 * distanceFactor * (index % 3 === 0 ? 1 : -1);

  return {
    lat: coordinates.lat + latOffset,
    lng: coordinates.lng + lngOffset,
  };
}

function buildThrillCandidates(
  participants: Participant[],
  selectedCategory: MeetCategoryKey = 'dining',
  thrillLevel: ThrillLevel = 1,
): Candidate[] {
  if (thrillLevel < 3 || !participants.length) {
    return [];
  }

  const allowNearOnePerson = thrillLevel >= 4;
  const allowHyperLocal = thrillLevel >= 5;

  return participants.flatMap((participant, index) => {
    const baseCandidate: Candidate = {
      id: `thrill-local-${participant.id}`,
      name: `${participant.location} 근처`,
      district: `${participant.name} 생활권`,
      description:
        thrillLevel === 3
          ? '중간 지점 대신 누군가의 동네 쪽으로 확 당겨본 로컬 후보예요.'
          : '중간 지점보다 훨씬 로컬 쪽으로 치우친 후보예요.',
      vibe:
        thrillLevel === 3
          ? '동네에서 바로 만나듯 가볍게 붙는 로컬 무드'
          : '거의 집앞에서 툭 만나자는 느낌의 극단 로컬 무드',
      coordinates: offsetCoordinates(participant.coordinates, index, allowHyperLocal ? 0.45 : allowNearOnePerson ? 0.65 : 0.9),
      tags: allowHyperLocal
        ? ['로컬', '극단', participant.name]
        : ['로컬', '동네', participant.name],
      bestFor:
        thrillLevel === 3
          ? '생활권 안에서 빨리 붙고 바로 코스를 짜고 싶을 때'
          : '오늘은 진짜 누군가의 동네로 들어가도 괜찮을 때',
      whyItWorks:
        thrillLevel === 3
          ? `${participant.name} 생활권을 기준으로 스릴을 조금 더 올린 후보예요.`
          : `${participant.name} 집앞 감도까지 허용하는 극단 모드 후보예요.`,
      routeHint:
        thrillLevel === 3
          ? `${participant.location} 쪽 로컬 코스로 이어가기 쉬워요.`
          : `${participant.location} 바로 근처에서 시작하는 느낌으로 보면 돼요.`,
      drawMood: (allowHyperLocal ? '반전 픽' : '무드 픽') as Candidate['drawMood'],
      categories: [selectedCategory],
    };

    if (!allowHyperLocal) {
      return [baseCandidate];
    }

    const hyperLocalCandidate: Candidate = {
      id: `thrill-hyper-${participant.id}`,
      name: `${participant.location} 바로 앞`,
      district: `${participant.name} 집앞 느낌`,
      description: '집앞 벤치까지 떠올릴 정도로 로컬 쪽으로 끝까지 밀어본 후보예요.',
      vibe: '오늘은 멀리 가지 않고 한 사람 생활권으로 깊게 들어가는 무드',
      coordinates: participant.coordinates,
      tags: ['집앞', '극단', participant.name],
      bestFor: '멀리 움직이는 것보다 오늘의 반전 자체가 재미일 때',
      whyItWorks: `${participant.name} 출발지 바로 근처까지 허용하는 최고 스릴 단계예요.`,
      routeHint: `${participant.location} 근처에서 바로 시작한다고 생각하면 돼요.`,
      drawMood: '반전 픽' as Candidate['drawMood'],
      categories: [selectedCategory],
    };

    return [baseCandidate, hyperLocalCandidate];
  });
}

function createLocalCandidateCategories(selectedCategory?: MeetCategoryKey) {
  if (!selectedCategory) {
    return ALL_MEET_CATEGORIES;
  }

  return [...new Set<MeetCategoryKey>([selectedCategory, 'dining', 'cafe', 'drink'])];
}

function normalizeAnchorName(name: string) {
  return name.replace(/\s+/g, '-').replace(/[^0-9a-zA-Z가-힣-]/g, '').toLowerCase();
}

function buildMidpointCandidates(
  participants: Participant[],
  selectedCategory?: MeetCategoryKey,
): Candidate[] {
  const clusteredContext = getClusteredBalanceContext(participants);
  const center = clusteredContext?.center ?? getParticipantCenter(participants);

  if (!center || participants.length < 2) {
    return [];
  }

  const spreadKm = clusteredContext
    ? Math.max(clusteredContext.separationKm / 2, getParticipantSpreadKm(participants, center))
    : getParticipantSpreadKm(participants, center);
  const closeContext = getCloseParticipantContext(participants);
  const isTwoPersonGroup = participants.length === 2;
  const useBridgeCorridor = isTwoPersonGroup || clusteredContext?.clusters.length === 2;
  const axisStart = clusteredContext?.axisStart ?? participants[0].coordinates;
  const axisEnd =
    clusteredContext?.axisEnd ?? participants[participants.length - 1].coordinates;
  const searchRadiusKm = closeContext.isCloseGroup
    ? closeContext.candidateLimitKm
    : clusteredContext
      ? Math.max(5.5, Math.min(14, clusteredContext.separationKm * 0.34 + 3))
      : Math.max(3, Math.min(11, spreadKm * 0.95 + 2.6));

  return stationOptions
    .map((station) => {
      const centerDistance = getDistanceKm(center, station.coordinates);
      const axisDistance = getBalancedParticipantAxisDistanceKm(
        participants,
        station.coordinates,
        center,
        'balance',
        clusteredContext,
      );
      const projectionRatio = useBridgeCorridor
        ? getSegmentProjectionRatio(
            station.coordinates,
            axisStart,
            axisEnd,
          )
        : 0.5;
      const twoPersonCorridorPenalty = getTwoPersonCorridorPenalty(
        participants,
        station.coordinates,
        center,
      );
      const bridgeCorridorPenalty = clusteredContext
        ? Math.abs(projectionRatio - 0.5) * clusteredContext.separationKm * 1.4 +
          axisDistance * 1.9
        : 0;
      const travelInfo = participants.map((participant) =>
        getParticipantEstimatedTravelInfo(participant, {
          id: station.name,
          name: station.name,
          district: '',
          description: '',
          vibe: '',
          coordinates: station.coordinates,
          tags: [],
          bestFor: '',
          whyItWorks: '',
          routeHint: '',
          drawMood: '안정 픽',
          categories: createLocalCandidateCategories(selectedCategory),
        }),
      );
      const spreadDuration = getTravelSpread(travelInfo);
      const averageDuration =
        travelInfo.reduce((sum, info) => sum + info.duration, 0) / travelInfo.length;
      const farthestDuration = Math.max(...travelInfo.map((info) => info.duration));

      return {
        station,
        centerDistance,
        axisDistance,
        score:
          centerDistance * 1.45 +
          axisDistance * 2.05 +
          averageDuration * 0.5 +
          farthestDuration * 0.34 +
          spreadDuration * 0.65 +
          twoPersonCorridorPenalty * 1.15 +
          bridgeCorridorPenalty,
        projectionRatio,
      };
    })
    .filter(
      ({ centerDistance, axisDistance, projectionRatio }) => {
        if (!useBridgeCorridor) {
          return (
            centerDistance <= searchRadiusKm ||
            (!closeContext.isCloseGroup && axisDistance <= Math.max(1.2, searchRadiusKm * 0.28))
          );
        }

        const middleBandLimit = closeContext.isCloseGroup
          ? 0.42
          : clusteredContext
            ? 0.36
            : 0.28;
        const nearMiddleOfSegment = Math.abs(projectionRatio - 0.5) <= middleBandLimit;
        const axisLimit = closeContext.isCloseGroup
          ? closeContext.axisLimitKm + 0.4
          : clusteredContext
            ? Math.max(1.8, Math.min(4.6, clusteredContext.separationKm * 0.12 + 0.8))
            : Math.max(1.4, Math.min(3.6, spreadKm * 0.22 + 0.8));

        return (
          (centerDistance <= searchRadiusKm && axisDistance <= axisLimit + 1.2) ||
          (nearMiddleOfSegment && axisDistance <= axisLimit)
        );
      },
    )
    .sort((left, right) => left.score - right.score)
    .slice(0, participants.length <= 2 ? 10 : 12)
    .map(({ station }) => ({
      id: `midpoint-${normalizeAnchorName(station.name)}`,
      name: station.name,
      district: '공정 중간 후보',
      description: '참여자 위치들의 중간축에서 먼저 찾은 실제 역세권 후보예요.',
      vibe: '한쪽으로 크게 치우치지 않는 중간 만남 무드',
      coordinates: station.coordinates,
      tags: ['중간지점', '공정', '역세권'],
      bestFor: '모두가 비슷하게 움직이는 식사, 카페, 가벼운 약속',
      whyItWorks: '참여자들의 중심점과 이동 격차를 같이 보고 고른 중간 후보예요.',
      routeHint: `${station.name} 주변에서 만나면 한쪽만 과하게 이동하는 느낌을 줄일 수 있어요.`,
      drawMood: '안정 픽' as Candidate['drawMood'],
      categories: createLocalCandidateCategories(selectedCategory),
    }));
}

function buildParticipantNeighborhoodCandidates(
  participants: Participant[],
  selectedCategory?: MeetCategoryKey,
  thrillLevel: ThrillLevel = 1,
): Candidate[] {
  if (participants.length < 2) {
    return [];
  }

  const perParticipantLimit = thrillLevel >= 5 ? 4 : thrillLevel >= 4 ? 3 : 2;

  return participants.flatMap((participant) =>
    stationOptions
      .map((station) => ({
        station,
        distance: getDistanceKm(participant.coordinates, station.coordinates),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, perParticipantLimit)
      .map(({ station }) => ({
        id: `participant-near-${participant.id}-${normalizeAnchorName(station.name)}`,
        name: station.name,
        district: `${participant.name} 근처 후보`,
        description: '각 참여자 근처 생활권도 비교하기 위해 함께 올려둔 후보예요.',
        vibe: '누군가에게 가까운 로컬 후보',
        coordinates: station.coordinates,
        tags: ['참여자 근처', participant.name, '로컬'],
        bestFor: '동네 포함 모드나 스릴을 줄 때 섞어볼 수 있는 후보',
        whyItWorks: `${participant.name} 근처 후보라 로컬 선택지가 필요할 때 비교할 수 있어요.`,
        routeHint: `${station.name} 주변에서 ${participant.name} 생활권 코스로 이어가기 쉬워요.`,
        drawMood: '무드 픽' as Candidate['drawMood'],
        categories: createLocalCandidateCategories(selectedCategory),
      })),
  );
}

function buildCloseRangeCandidates(
  participants: Participant[],
  selectedCategory?: MeetCategoryKey,
): Candidate[] {
  const center = getParticipantCenter(participants);
  const closeContext = getCloseParticipantContext(participants);

  if (!center || !closeContext.isCloseGroup) {
    return [];
  }

  const stationCandidates = stationOptions
    .map((station) => ({
      station,
      centerDistance: getDistanceKm(center, station.coordinates),
    }))
    .filter(({ centerDistance }) => centerDistance <= closeContext.candidateLimitKm)
    .sort((left, right) => left.centerDistance - right.centerDistance)
    .slice(0, 6)
    .map(({ station }) => ({
      id: `close-range-${normalizeAnchorName(station.name)}`,
      name: station.name,
      district: '근거리 생활권 후보',
      description:
        '참여자 위치가 가까워서 넓은 수도권 후보 대신 실제 주변 역세권으로 좁힌 후보예요.',
      vibe: '멀리 이동하지 않고 바로 만나는 생활권 무드',
      coordinates: station.coordinates,
      tags: ['근거리', '역세권', '생활권'],
      bestFor: '가까운 사람끼리 빠르게 모이는 식사나 카페',
      whyItWorks:
        '위치가 가까운 모임에서는 유명 상권을 억지로 끼우는 것보다 현재 생활권 안에서 고르는 게 더 자연스러워요.',
      routeHint: `${station.name} 주변에서 식사, 카페, 2차 동선을 짧게 잡기 좋아요.`,
      drawMood: '안정 픽' as Candidate['drawMood'],
      categories: createLocalCandidateCategories(selectedCategory),
    }));

  if (stationCandidates.length) {
    return stationCandidates;
  }

  const anchorLabel = participants
    .map((participant) => participant.location.split(/\s+/).slice(-1)[0] || participant.name)
    .slice(0, 2)
    .join('·');

  return [
    {
      id: `close-center-${participants.map((participant) => participant.id).join('-')}`,
      name: anchorLabel ? `${anchorLabel} 사이` : '근처 중간지점',
      district: '근거리 중간 후보',
      description: '가까운 참여자 사이에서 너무 멀리 보내지 않기 위한 임시 중간 후보예요.',
      vibe: '멀리 이동하지 않고 바로 붙는 근거리 만남 무드',
      coordinates: center,
      tags: ['근거리', '중간', '생활권'],
      bestFor: '가까운 사람끼리 빠르게 만날 때',
      whyItWorks: '가까운 그룹에서는 먼 유명 상권보다 실제 사이 지점이 더 자연스러워요.',
      routeHint: '주변 장소 검색으로 실제 만날 가게를 바로 좁히기 좋아요.',
      drawMood: '안정 픽' as Candidate['drawMood'],
      categories: createLocalCandidateCategories(selectedCategory),
    },
  ];
}

export function buildCandidateUniverse(
  participants: Participant[],
  candidates: Candidate[],
  selectedCategory?: MeetCategoryKey,
  thrillLevel: ThrillLevel = 1,
) {
  const midpointCandidates = buildMidpointCandidates(participants, selectedCategory);
  const participantNeighborhoodCandidates = buildParticipantNeighborhoodCandidates(
    participants,
    selectedCategory,
    thrillLevel,
  );
  const closeRangeCandidates = buildCloseRangeCandidates(participants, selectedCategory);
  const extraCandidates = buildThrillCandidates(participants, selectedCategory, thrillLevel);
  const candidateMap = new Map<string, Candidate>();

  [
    ...midpointCandidates,
    ...candidates,
    ...closeRangeCandidates,
    ...participantNeighborhoodCandidates,
    ...extraCandidates,
  ].forEach((candidate) => {
    const shouldKeepLocalWildcard = thrillLevel >= 4 && isLocalWildcardCandidate(candidate);
    const isAiGeneratedCandidate = candidate.id.startsWith('ai-generated-');
    const isGeneratedCandidate =
      candidate.id.startsWith('midpoint-') ||
      candidate.id.startsWith('close-range-') ||
      candidate.id.startsWith('participant-near-') ||
      candidate.id.startsWith('thrill-') ||
      candidate.id.startsWith('ai-generated-');
    const duplicateCandidate = [...candidateMap.values()].find(
      (existingCandidate) =>
        existingCandidate.name === candidate.name ||
        getDistanceKm(existingCandidate.coordinates, candidate.coordinates) <= 0.25,
    );

    if (duplicateCandidate && shouldKeepLocalWildcard) {
      candidateMap.set(candidate.id, candidate);
      return;
    }

    if (duplicateCandidate && isAiGeneratedCandidate) {
      candidateMap.delete(duplicateCandidate.id);
      candidateMap.set(candidate.id, candidate);
      return;
    }

    if (duplicateCandidate && !isGeneratedCandidate) {
      const duplicateIsGenerated =
        duplicateCandidate.id.startsWith('midpoint-') ||
        duplicateCandidate.id.startsWith('close-range-') ||
        duplicateCandidate.id.startsWith('participant-near-') ||
        duplicateCandidate.id.startsWith('thrill-') ||
        duplicateCandidate.id.startsWith('ai-generated-');

      if (duplicateIsGenerated) {
        candidateMap.delete(duplicateCandidate.id);
        candidateMap.set(candidate.id, candidate);
        return;
      }
    }

    if (
      duplicateCandidate &&
      (isGeneratedCandidate ||
        duplicateCandidate.id.startsWith('midpoint-') ||
        duplicateCandidate.id.startsWith('close-range-') ||
        duplicateCandidate.id.startsWith('participant-near-') ||
        duplicateCandidate.id.startsWith('ai-generated-'))
    ) {
      return;
    }

    candidateMap.set(candidate.id, candidate);
  });

  return [...candidateMap.values()];
}

export function getTravelInfo(participant: Participant, candidate: Candidate): TravelInfo {
  const distance = getDistanceKm(participant.coordinates, candidate.coordinates);
  const duration = Math.max(
    MIN_TRAVEL_MINUTES,
    Math.round(distance / TRANSIT_SPEED_KM_PER_MIN + 7),
  );
  const cost = Math.round((BASE_FARE + Math.max(0, distance - 3) * FARE_PER_KM) / 100) * 100;

  return {
    participantId: participant.id,
    participantName: participant.name,
    distance: Math.round(distance * 10) / 10,
    cost,
    duration,
    source: 'estimated',
    mode: 'transit',
  };
}

export function getCarTravelInfo(participant: Participant, candidate: Candidate): TravelInfo {
  const directDistance = getDistanceKm(participant.coordinates, candidate.coordinates);
  const routeDistance = directDistance * CAR_ROUTE_DISTANCE_FACTOR;
  const duration = Math.max(8, Math.round(routeDistance / CAR_SPEED_KM_PER_MIN + 5));
  const fuelPrice = Math.round(routeDistance * CAR_FUEL_PRICE_PER_KM);

  return {
    participantId: participant.id,
    participantName: participant.name,
    distance: Math.round(routeDistance * 10) / 10,
    cost: fuelPrice,
    duration,
    source: 'estimated',
    mode: 'car',
    tollFare: 0,
    taxiFare: 0,
    fuelPrice,
  };
}

export function getParticipantEstimatedTravelInfo(
  participant: Participant,
  candidate: Candidate,
): TravelInfo {
  return participant.travelMode === 'car'
    ? getCarTravelInfo(participant, candidate)
    : getTravelInfo(participant, candidate);
}

function formatAccessSummary(
  participants: Participant[],
  travelInfo: TravelInfo[],
  selectionMode: SelectionModeKey = 'balance',
) {
  if (!participants.length || !travelInfo.length) {
    return '출발지를 먼저 입력해 주세요.';
  }

  const limitById = participants.reduce<Record<string, number>>(
    (acc, participant) => {
      acc[participant.id] = getAdaptiveMaxTravelTime(participants, participant, selectionMode);
      return acc;
    },
    {},
  );
  const baseLimitById = participants.reduce<Record<string, number>>((acc, participant) => {
    acc[participant.id] = participant.maxTravelTime;
    return acc;
  }, {});

  const delayed = travelInfo.filter((info) => info.duration > limitById[info.participantId]);
  const baseDelayed = travelInfo.filter(
    (info) => info.duration > baseLimitById[info.participantId],
  );
  const maxDuration = Math.max(...travelInfo.map((info) => info.duration));
  const minorityBenefitProfile =
    selectionMode === 'balance'
      ? getMinorityBenefitProfile({
          travelInfo,
          spreadDuration: getTravelSpread(travelInfo),
        })
      : null;

  if (minorityBenefitProfile) {
    return `소수는 가까운 편이고, 나머지 ${minorityBenefitProfile.majorityCount}명은 ${minorityBenefitProfile.majoritySpread}분 차이로 비슷하게 도착해요.`;
  }

  if (!delayed.length) {
    if (baseDelayed.length) {
      return `거리가 멀어 이동시간 기준을 유동적으로 넓히면 모두 ${maxDuration}분 안에 합류할 수 있어요.`;
    }

    return `모든 참여자가 ${maxDuration}분 안에 도착 가능한 교집합 안입니다.`;
  }

  if (delayed.length === 1) {
    const late = delayed[0];
    return `${late.participantName}는 조금 빠듯하지만, 나머지는 무리 없이 합류할 수 있어요.`;
  }

  return '완벽한 교집합은 아니지만, 가장 부담이 덜한 후보로 압축한 결과예요.';
}

export function applyTravelInfoToCandidateInsight(
  insight: CandidateInsight,
  participants: Participant[],
  travelInfoOverride: TravelInfo[],
  selectionMode: SelectionModeKey = 'balance',
): CandidateInsight {
  const travelInfo = participants.map((participant) => {
    return (
      travelInfoOverride.find((info) => info.participantId === participant.id) ??
      insight.travelInfo.find((info) => info.participantId === participant.id) ??
      getParticipantEstimatedTravelInfo(participant, insight.candidate)
    );
  });
  const averageDistance =
    travelInfo.reduce((sum, info) => sum + info.distance, 0) / Math.max(travelInfo.length, 1);
  const averageDuration =
    travelInfo.reduce((sum, info) => sum + info.duration, 0) / Math.max(travelInfo.length, 1);
  const maxDuration = travelInfo.length
    ? Math.max(...travelInfo.map((info) => info.duration))
    : 0;
  const spreadDuration = travelInfo.length ? getTravelSpread(travelInfo) : 0;
  const allReachable = travelInfo.every((info) => {
    const participant = participants.find((item) => item.id === info.participantId);
    return info.duration <= getAdaptiveMaxTravelTime(participants, participant, selectionMode);
  });
  const sortedTravelInfo = [...travelInfo].sort((left, right) => left.duration - right.duration);
  const nearest = sortedTravelInfo[0];
  const farthest = sortedTravelInfo[sortedTravelInfo.length - 1];

  return {
    ...insight,
    travelInfo,
    averageDistance: Math.round(averageDistance * 10) / 10,
    averageDuration: Math.round(averageDuration),
    maxDuration,
    spreadDuration,
    allReachable,
    accessSummary: formatAccessSummary(participants, travelInfo, selectionMode),
    nearestParticipantName: nearest?.participantName ?? insight.nearestParticipantName,
    nearestDuration: nearest?.duration ?? insight.nearestDuration,
    farthestParticipantName: farthest?.participantName ?? insight.farthestParticipantName,
    farthestDuration: farthest?.duration ?? insight.farthestDuration,
  };
}

function getBalanceRankingScore(
  insight: CandidateInsight,
  participants: Participant[] = [],
) {
  const minorityBenefitProfile = getMinorityBenefitProfile(insight, participants);
  const effectiveSpread = minorityBenefitProfile?.effectiveSpread ?? insight.spreadDuration;
  const oneSidedPenalty =
    !minorityBenefitProfile && insight.spreadDuration > 10 && insight.nearestDuration <= 16
      ? (insight.spreadDuration - 10) * 1.6 + (16 - insight.nearestDuration) * 0.7
      : 0;
  const minorityEfficiencyBonus = minorityBenefitProfile
    ? Math.min(
        16,
        minorityBenefitProfile.majorityCount * 1.6 +
          Math.max(0, insight.spreadDuration - minorityBenefitProfile.effectiveSpread) * 0.16,
      )
    : 0;

  return (
    effectiveSpread * 1.2 +
    insight.centerDistance * 2 +
    insight.axisDistance * 2.7 +
    insight.averageDuration * 0.85 +
    insight.farthestDuration * 0.65 +
    getLongTripPenalty(insight) +
    getCorridorDriftPenalty(insight) +
    oneSidedPenalty +
    (insight.allReachable ? 0 : 36) +
    (insight.categoryMatched ? 0 : 8) -
    minorityEfficiencyBonus
  );
}

export function getCandidateInsights(
  participants: Participant[],
  candidates: Candidate[],
  selectedCategory?: MeetCategoryKey,
  selectionMode: SelectionModeKey = 'balance',
): CandidateInsight[] {
  if (!participants.length) {
    return [];
  }

  const clusteredContext = selectionMode === 'balance' ? getClusteredBalanceContext(participants) : null;
  const center =
    selectionMode === 'balance'
      ? clusteredContext?.center ?? getParticipantCenter(participants)
      : getParticipantCenter(participants);

  return candidates
    .map((candidate) => {
      const travelInfo = participants.map((participant) =>
        getParticipantEstimatedTravelInfo(participant, candidate),
      );
      const averageDistance =
        travelInfo.reduce((sum, info) => sum + info.distance, 0) / travelInfo.length;
      const averageDuration =
        travelInfo.reduce((sum, info) => sum + info.duration, 0) / travelInfo.length;
      const maxDuration = Math.max(...travelInfo.map((info) => info.duration));
      const spreadDuration = getTravelSpread(travelInfo);
      const allReachable = travelInfo.every((info) => {
        const participant = participants.find((item) => item.id === info.participantId);
        return info.duration <= getAdaptiveMaxTravelTime(participants, participant, selectionMode);
      });
      const categoryMatched = selectedCategory
        ? candidate.categories.includes(selectedCategory)
        : true;
      const sortedTravelInfo = [...travelInfo].sort((left, right) => left.duration - right.duration);
      const nearest = sortedTravelInfo[0];
      const farthest = sortedTravelInfo[sortedTravelInfo.length - 1];
      const centerDistance = center ? getDistanceKm(center, candidate.coordinates) : 0;
      const axisDistance = getBalancedParticipantAxisDistanceKm(
        participants,
        candidate.coordinates,
        center,
        selectionMode,
        clusteredContext,
      );

      return {
        candidate,
        travelInfo,
        averageDistance: Math.round(averageDistance * 10) / 10,
        averageDuration: Math.round(averageDuration),
        maxDuration,
        spreadDuration,
        allReachable,
        accessSummary: formatAccessSummary(participants, travelInfo, selectionMode),
        categoryMatched,
        centerDistance: Math.round(centerDistance * 10) / 10,
        axisDistance: Math.round(axisDistance * 10) / 10,
        nearestParticipantName: nearest.participantName,
        nearestDuration: nearest.duration,
        farthestParticipantName: farthest.participantName,
        farthestDuration: farthest.duration,
      };
    })
    .sort((left, right) => {
      if (left.allReachable !== right.allReachable) {
        return left.allReachable ? -1 : 1;
      }

      const leftTwoPersonPenalty = getTwoPersonCorridorPenalty(
        participants,
        left.candidate.coordinates,
        center,
      );
      const rightTwoPersonPenalty = getTwoPersonCorridorPenalty(
        participants,
        right.candidate.coordinates,
        center,
      );
      const balanceDiff =
        getBalanceRankingScore(left, participants) +
        leftTwoPersonPenalty * 1.15 -
        (getBalanceRankingScore(right, participants) + rightTwoPersonPenalty * 1.15);

      if (Math.abs(balanceDiff) > 3) {
        return balanceDiff;
      }

      if (left.categoryMatched !== right.categoryMatched) {
        return left.categoryMatched ? -1 : 1;
      }

      if (left.maxDuration !== right.maxDuration) {
        return left.maxDuration - right.maxDuration;
      }

      return left.averageDuration - right.averageDuration;
    });
}

export function getDynamicCandidateInsights(
  participants: Participant[],
  candidates: Candidate[],
  selectedCategory?: MeetCategoryKey,
  selectionMode: SelectionModeKey = 'balance',
  thrillLevel: ThrillLevel = 1,
  candidateScope: CandidateScopeKey = 'standard',
  requestedTargetCount?: number,
) {
  const insights = getCandidateInsights(participants, candidates, selectedCategory, selectionMode);
  const clusteredBalanceContext =
    selectionMode === 'balance' ? getClusteredBalanceContext(participants) : null;
  const center =
    selectionMode === 'balance'
      ? clusteredBalanceContext?.center ?? getParticipantCenter(participants)
      : getParticipantCenter(participants);
  const dynamicAxisRadius = getDynamicAxisRadiusKm(participants, center);
  const balancedCenterLimit = getBalancedCenterLimitKm(participants, center);
  const participantSpreadKm = getParticipantSpreadKm(participants, center);
  const twoPersonBalanceLimits = getTwoPersonBalanceLimits(participants, center);
  const groupBalanceLimits =
    selectionMode === 'balance'
      ? getGroupBalanceLimits(participants, center, clusteredBalanceContext)
      : null;
  const balanceShapeLimits = twoPersonBalanceLimits ?? groupBalanceLimits;
  const balancedCoreCenterLimit = balanceShapeLimits?.centerLimit ?? balancedCenterLimit;
  const balancedRelaxedCenterLimit =
    balanceShapeLimits?.relaxedCenterLimit ?? balancedCenterLimit;
  const balancedAxisLimit =
    balanceShapeLimits?.axisLimit ?? Math.max(1.8, balancedCenterLimit * 0.45);
  const strictBalancedAxisLimit =
    balanceShapeLimits?.strictAxisLimit ?? Math.max(1.5, balancedCenterLimit * 0.4);
  const isCloseBalancedGroup =
    selectionMode === 'balance' && participants.length >= 2 && participantSpreadKm <= 5.5;

  if (insights.length <= 8) {
    if (!isCloseBalancedGroup) {
      return ensureParticipantLocalCoverage(insights, insights, participants, insights.length, {
        selectionMode,
        thrillLevel,
      });
    }

    const compactInsights = getCloseBalancedCandidateInsights(insights, participants);

    return ensureParticipantLocalCoverage(
      insights,
      compactInsights,
      participants,
      Math.min(Math.max(compactInsights.length, participants.length + 2), insights.length),
      {
        selectionMode,
        thrillLevel,
      },
    );
  }

  const participantMetroAreas = getParticipantMetroAreas(participants);
  const thrillBias = thrillLevel - 1;
  const scopeBonus = getCandidateScopeBonus(candidateScope);
  const targetCount =
    normalizeTargetCount(insights.length, requestedTargetCount) ??
    ((selectionMode === 'neighborhood'
      ? participants.length >= 5
        ? 14
        : participants.length >= 3
          ? 12
          : 10
      : selectionMode === 'hotplace'
        ? participants.length >= 5
          ? 14
          : participants.length >= 3
            ? 12
            : 10
      : participants.length >= 5
        ? 12
        : participants.length >= 3
          ? 10
          : 8) +
      thrillBias +
      scopeBonus);

  const ranked = insights
    .map((insight, index) => {
      const fairnessOverage = getFairnessOverage(insight, thrillLevel, participants);
      const minorityBenefitProfile = getMinorityBenefitProfile(insight, participants);
      const effectiveFairnessSpread =
        minorityBenefitProfile?.effectiveSpread ?? insight.spreadDuration;
      const overflowMinutes = insight.travelInfo.reduce((sum, info) => {
        const participant = participants.find((item) => item.id === info.participantId);
        const travelLimit = getAdaptiveMaxTravelTime(participants, participant, selectionMode);

        return sum + Math.max(0, info.duration - travelLimit);
      }, 0);
      const radiusOverflow = Math.max(0, insight.centerDistance - dynamicAxisRadius);
      const localityStrength = getLocalityStrength(insight.nearestDuration);
      const extremeBias = Math.max(0, insight.centerDistance - dynamicAxisRadius * 0.58);
      const oneSidedPenalty =
        !minorityBenefitProfile && insight.spreadDuration > 10 && insight.nearestDuration <= 16
          ? (insight.spreadDuration - 10) * 1.8 + (16 - insight.nearestDuration) * 0.8
          : 0;
      const minorityEfficiencyBonus = minorityBenefitProfile
        ? Math.min(
            18,
            minorityBenefitProfile.majorityCount * 1.8 +
              Math.max(0, insight.spreadDuration - effectiveFairnessSpread) * 0.18,
          )
        : 0;
      const longTripPenalty = getLongTripPenalty(insight);
      const twoPersonCorridorPenalty = getTwoPersonCorridorPenalty(
        participants,
        insight.candidate.coordinates,
        center,
      );
      const balanceScore =
        (insight.categoryMatched ? -8 : 0) +
        (insight.allReachable ? -14 : 20) +
        insight.centerDistance * (twoPersonBalanceLimits ? 1.55 : 2.1) +
        insight.axisDistance * (twoPersonBalanceLimits ? 3.35 : 2.8) +
        insight.averageDuration * 0.88 +
        insight.farthestDuration * 0.62 +
        effectiveFairnessSpread * 2.05 +
        fairnessOverage * 8 +
        fairnessOverage * fairnessOverage * 0.75 +
        longTripPenalty +
        twoPersonCorridorPenalty * 1.25 +
        oneSidedPenalty +
        overflowMinutes * 1.2 +
        radiusOverflow * 4.4 +
        - minorityEfficiencyBonus +
        index * 0.1;
      const neighborhoodScore =
        (insight.categoryMatched ? -16 : 0) +
        (insight.allReachable ? -6 : 0) +
        insight.nearestDuration * 0.62 +
        insight.farthestDuration * 0.46 +
        insight.spreadDuration * 0.86 +
        fairnessOverage * 2.4 +
        overflowMinutes * 0.92 +
        radiusOverflow * 1.15 -
        localityStrength * 1.45 -
        thrillBias * localityStrength * 0.62 -
        Math.min(12, extremeBias) * 0.9 +
        (thrillLevel >= 5 ? Math.max(0, insight.farthestDuration - 32) * 0.08 : 0) +
        index * 0.12;

      return {
        insight,
        centerDistance: insight.centerDistance,
        dynamicScore: selectionMode === 'neighborhood' ? neighborhoodScore : balanceScore,
        localityStrength,
      };
    })
    .sort((left, right) => left.dynamicScore - right.dynamicScore);

  if (selectionMode === 'neighborhood') {
    const isNearOnePersonMode = thrillLevel >= 4;
    const isHouseFrontMode = thrillLevel >= 5;
    const rankedInsights = ranked.map(({ insight }) => insight);
    const localAnchors = ranked.filter(
      ({ insight, centerDistance, localityStrength }) =>
        isLocalWildcardCandidate(insight.candidate) ||
        localityStrength >= (isHouseFrontMode ? 10 : isNearOnePersonMode ? 7 : 4) ||
        centerDistance >= dynamicAxisRadius * (isHouseFrontMode ? 0.34 : isNearOnePersonMode ? 0.5 : 0.68) ||
        (!isNearOnePersonMode && insight.allReachable),
    );
    const targetLimit = Math.min(
      Math.max(targetCount, isHouseFrontMode ? participants.length : 1),
      insights.length,
    );
    const localReserve = isHouseFrontMode
      ? Math.min(Math.max(participants.length * 2, Math.ceil(targetLimit * 0.45)), Math.max(2, targetLimit - 2))
      : isNearOnePersonMode
        ? Math.min(Math.max(participants.length, Math.ceil(targetLimit * 0.32)), Math.max(2, targetLimit - 3))
      : thrillLevel >= 3
        ? 3
        : 2;
    const requiredParticipantLocalAnchors = isNearOnePersonMode
      ? getRequiredParticipantLocalAnchors(
          rankedInsights,
          participants,
          targetLimit,
          isHouseFrontMode,
        )
      : [];
    const requiredIds = new Set(
      requiredParticipantLocalAnchors.map((insight) => insight.candidate.id),
    );
    const baseCoreCount = Math.max(4, targetLimit - localReserve);
    const baseRecommendations = insights
      .filter((insight) => !requiredIds.has(insight.candidate.id))
      .slice(0, Math.min(baseCoreCount, insights.length));
    const localRecommendations = localAnchors.map(({ insight }) => insight);
    const participantLocalAnchors = isNearOnePersonMode
      ? getParticipantLocalAnchors(rankedInsights, participants, isHouseFrontMode ? 2 : 1)
      : [];

    const seededNeighborhoodInsights = isNearOnePersonMode
      ? mergeUniqueInsights(
          requiredParticipantLocalAnchors,
          mergeUniqueInsights(baseRecommendations, participantLocalAnchors, targetLimit),
          targetLimit,
        )
      : baseRecommendations;
    const neighborhoodInsights = mergeUniqueInsights(
      seededNeighborhoodInsights,
      localRecommendations,
      targetLimit,
    );
    const participantCoveredNeighborhoodInsights = ensureParticipantLocalCoverage(
      rankedInsights,
      neighborhoodInsights,
      participants,
      targetLimit,
      {
        selectionMode,
        thrillLevel,
      },
    );

    if (participantMetroAreas.some((area) => area !== '서울')) {
      const metroCoveredInsights = ensureMetroAreaCoverage(
        insights,
        participantCoveredNeighborhoodInsights,
        participantMetroAreas,
        targetLimit,
        thrillLevel,
        participants,
      );

      return ensureParticipantLocalCoverage(
        rankedInsights,
        metroCoveredInsights,
        participants,
        targetLimit,
        {
          selectionMode,
          thrillLevel,
        },
      );
    }

    return participantCoveredNeighborhoodInsights;
  }

  if (selectionMode === 'hotplace') {
    const hotplaceRankedInsights = [...insights].sort(
      (left, right) =>
        getHotplaceRankingScore(left, thrillLevel) - getHotplaceRankingScore(right, thrillLevel),
    );
    const categoryHotplaces = hotplaceRankedInsights.filter(
      (insight) => insight.allReachable && insight.categoryMatched,
    );
    const reachableHotplaces = hotplaceRankedInsights.filter((insight) => insight.allReachable);
    const source =
      categoryHotplaces.length >= Math.min(4, targetCount)
        ? categoryHotplaces
        : reachableHotplaces.length
          ? reachableHotplaces
          : hotplaceRankedInsights;

    return source.slice(0, Math.min(targetCount, source.length));
  }

  const rankedSource = ranked;
  const fairnessRankedSource = [...rankedSource].sort((left, right) =>
    compareByFairnessLevel(left.insight, right.insight, thrillLevel, participants),
  );
  const fairnessSpreadLimit = getFairnessSpreadLimit(thrillLevel, participants);
  const softFairnessSpreadLimit = Math.min(
    getFairnessSpreadLimit(5, participants),
    fairnessSpreadLimit + 5,
  );
  const fairBalancedBand =
    selectionMode === 'balance'
      ? fairnessRankedSource.filter(
          ({ insight }) =>
            insight.allReachable &&
            insight.spreadDuration <= fairnessSpreadLimit &&
            (!twoPersonBalanceLimits ||
              (insight.centerDistance <= balancedRelaxedCenterLimit &&
                insight.axisDistance <= balancedAxisLimit)),
        )
      : [];
  const dynamicMiddleBand = fairnessRankedSource.filter(
    ({ insight, centerDistance }) => {
      const effectiveSpread = getEffectiveFairnessSpread(insight, participants);

      return (
        (selectionMode === 'balance' &&
          centerDistance <= balancedCoreCenterLimit &&
          insight.axisDistance <= balancedAxisLimit &&
          effectiveSpread <= softFairnessSpreadLimit) ||
        (selectionMode !== 'balance' && insight.allReachable) ||
        (centerDistance <=
          (twoPersonBalanceLimits
            ? balancedRelaxedCenterLimit
            : dynamicAxisRadius + (thrillLevel >= 3 ? 7.5 : 4.5)) &&
          effectiveSpread <= softFairnessSpreadLimit) ||
        (thrillLevel >= 4 && insight.nearestDuration <= 18)
      );
    },
  );
  const strictBalancedBand =
    selectionMode === 'balance'
      ? fairnessRankedSource.filter(
          ({ insight, centerDistance }) =>
            centerDistance <= balancedCoreCenterLimit &&
            insight.axisDistance <= strictBalancedAxisLimit &&
            insight.spreadDuration <= fairnessSpreadLimit,
        )
      : [];
  const closeBalancedInsightIds = new Set(
    isCloseBalancedGroup
      ? getCloseBalancedCandidateInsights(
          fairnessRankedSource.map((rankedInsight) => rankedInsight.insight),
          participants,
        ).map((insight) => insight.candidate.id)
      : [],
  );
  const closeBalancedBand = isCloseBalancedGroup
    ? fairnessRankedSource.filter(({ insight }) => closeBalancedInsightIds.has(insight.candidate.id))
    : [];
  const closeFinalBand =
    strictBalancedBand.length >= Math.min(targetCount, 3)
      ? strictBalancedBand
      : closeBalancedBand.length
        ? closeBalancedBand
        : dynamicMiddleBand.length
          ? dynamicMiddleBand
          : rankedSource;
  const twoPersonCorridorBand =
    selectionMode === 'balance' && twoPersonBalanceLimits
      ? fairnessRankedSource.filter(
          ({ insight, centerDistance }) =>
            !isDetachedFairnessTrap(insight) &&
            centerDistance <= balancedRelaxedCenterLimit + 2.2 &&
            insight.axisDistance <= balancedAxisLimit + 1.8 &&
            insight.spreadDuration <= softFairnessSpreadLimit + 8,
        )
      : [];
  let finalSource = fairnessRankedSource;

  if (isCloseBalancedGroup) {
    finalSource = closeFinalBand;
  } else if (twoPersonCorridorBand.length >= Math.min(targetCount, 2)) {
    const nonDetachedSource = fairnessRankedSource.filter(
      ({ insight }) => !isDetachedFairnessTrap(insight),
    );

    finalSource = mergeUniqueRankedInsights(
      twoPersonCorridorBand,
      nonDetachedSource.length ? nonDetachedSource : fairnessRankedSource,
      targetCount,
    );
  } else if (fairBalancedBand.length >= Math.min(targetCount, 3)) {
    finalSource = fairBalancedBand;
  } else if (strictBalancedBand.length >= Math.min(targetCount, 4)) {
    finalSource = strictBalancedBand;
  } else if (dynamicMiddleBand.length >= Math.min(targetCount, 6)) {
    finalSource = dynamicMiddleBand;
  }

  const dynamicInsights = finalSource
    .slice(0, Math.min(targetCount, finalSource.length))
    .map(({ insight }) => insight);
  const rankedInsights = ranked.map(({ insight }) => insight);
  const participantCoveredInsights = ensureParticipantLocalCoverage(
    rankedInsights,
    dynamicInsights,
    participants,
    Math.min(targetCount, insights.length),
    {
      selectionMode,
      thrillLevel,
    },
  );

  if (
    selectionMode !== 'balance' &&
    !isCloseBalancedGroup &&
    participantMetroAreas.some((area) => area !== '서울')
  ) {
    const metroCoveredInsights = ensureMetroAreaCoverage(
      insights,
      participantCoveredInsights,
      participantMetroAreas,
      Math.min(targetCount, insights.length),
      thrillLevel,
      participants,
    );

    return ensureParticipantLocalCoverage(
      rankedInsights,
      metroCoveredInsights,
      participants,
      Math.min(targetCount, insights.length),
      {
        selectionMode,
        thrillLevel,
      },
    );
  }

  return participantCoveredInsights;
}

export function getDrawPool(
  insights: CandidateInsight[],
  selectionMode: SelectionModeKey = 'balance',
  thrillLevel: ThrillLevel = 1,
  candidateScope: CandidateScopeKey = 'standard',
  requestedTargetCount?: number,
  participants: Participant[] = [],
) {
  if (insights.length <= 4) {
    return {
      pool:
        selectionMode === 'balance'
          ? [...insights].sort(
              (left, right) => compareByFairnessLevel(left, right, thrillLevel, participants),
            )
          : selectionMode === 'hotplace'
            ? [...insights].sort(
                (left, right) =>
                  getHotplaceRankingScore(left, thrillLevel) -
                  getHotplaceRankingScore(right, thrillLevel),
              )
          : insights,
      fallbackNotice: null,
    };
  }

  const drawPoolExtra = getDrawPoolExtra(candidateScope);
  const explicitTargetCount = normalizeTargetCount(insights.length, requestedTargetCount);

  if (selectionMode === 'neighborhood') {
    const isNearOnePersonMode = thrillLevel >= 4;
    const isHouseFrontMode = thrillLevel >= 5;
    const localAnchors = insights.filter(
      (insight) =>
        isLocalWildcardCandidate(insight.candidate) ||
        insight.nearestDuration <= (isHouseFrontMode ? 12 : isNearOnePersonMode ? 14 : thrillLevel >= 3 ? 18 : 24) ||
        insight.centerDistance >= (isHouseFrontMode ? 1.8 : isNearOnePersonMode ? 2.5 : 4.5),
    );
    const requiredExtremeCount = isHouseFrontMode
      ? insights.filter((insight) => isHouseFrontCandidate(insight.candidate)).length
      : 0;
    const targetSize = Math.min(
      Math.max(
        explicitTargetCount ??
          Math.min((isHouseFrontMode ? 11 : isNearOnePersonMode ? 9 : 7) + drawPoolExtra, insights.length),
        Math.min(requiredExtremeCount, insights.length),
      ),
      insights.length,
    );
    const baseCoreSize = isHouseFrontMode
      ? Math.max(2, Math.ceil(targetSize * 0.35))
      : isNearOnePersonMode
        ? Math.max(3, Math.ceil(targetSize * 0.48))
      : Math.max(4, targetSize - 2);
    const reachableBase = insights.filter((insight) => insight.allReachable);
    const fairBaseSource = isNearOnePersonMode
      ? (reachableBase.length >= 3 ? reachableBase : insights).filter(
          (insight) => !isHouseFrontCandidate(insight.candidate),
        )
      : reachableBase.length >= 3
        ? reachableBase
        : insights;
    const basePool = (reachableBase.length >= 3 ? reachableBase : insights).slice(
      0,
      Math.min(baseCoreSize, insights.length),
    );
    const houseFrontBasePool = fairBaseSource.slice(0, Math.min(baseCoreSize, fairBaseSource.length));
    const seededPool = isNearOnePersonMode
      ? houseFrontBasePool
      : basePool;
    const mergedPool = mergeUniqueInsights(seededPool, localAnchors, targetSize);

    if (mergedPool.length > seededPool.length) {
      return {
        pool: mergedPool,
        fallbackNotice: isHouseFrontMode
          ? '집앞 모드라 중간 후보에 동네/집앞 상권을 같이 섞었어요.'
          : isNearOnePersonMode
            ? '누군가 근처 상권을 중간 후보와 같이 섞었어요.'
          : '기본 추천에 로컬 후보를 몇 개만 추가해서 같이 섞었어요.',
      };
    }

    return {
      pool: seededPool,
      fallbackNotice: '로컬 후보가 충분하지 않아서 기본 추천 위주로 추첨 풀을 만들었어요.',
    };
  }

  if (selectionMode === 'hotplace') {
    const targetSize = explicitTargetCount ?? Math.min(8 + drawPoolExtra, insights.length);
    const hotplaceSorted = [...insights].sort(
      (left, right) =>
        getHotplaceRankingScore(left, thrillLevel) - getHotplaceRankingScore(right, thrillLevel),
    );
    const categoryHotplaces = hotplaceSorted.filter(
      (insight) => insight.allReachable && insight.categoryMatched,
    );
    const reachableHotplaces = hotplaceSorted.filter((insight) => insight.allReachable);
    const source =
      categoryHotplaces.length >= Math.min(4, targetSize)
        ? categoryHotplaces
        : reachableHotplaces.length
          ? reachableHotplaces
          : hotplaceSorted;

    return {
      pool: source.slice(0, Math.min(targetSize, source.length)),
      fallbackNotice:
        categoryHotplaces.length >= Math.min(4, targetSize)
          ? null
          : '카테고리에 맞는 핫플 후보를 우선해서 추첨 풀을 만들었어요.',
    };
  }

  const fairnessSorted = [...insights].sort((left, right) =>
    compareByFairnessLevel(left, right, thrillLevel, participants),
  );
  const reachable = fairnessSorted.filter((insight) => insight.allReachable);
  const fairnessSpreadLimit = getFairnessSpreadLimit(thrillLevel, participants);
  const softFairnessSpreadLimit = Math.min(
    getFairnessSpreadLimit(5, participants),
    fairnessSpreadLimit + 5,
  );
  const verifiedFairPool =
    selectionMode === 'balance'
      ? fairnessSorted.filter(
          (insight) =>
            isFullyRouteVerifiedInsight(insight) &&
            insight.allReachable &&
            insight.spreadDuration <= fairnessSpreadLimit,
        )
      : [];
  const balancedPool =
    selectionMode === 'balance'
      ? fairnessSorted.filter(
          (insight) =>
            insight.allReachable &&
            insight.centerDistance <= 6.5 &&
            insight.axisDistance <= 2.8 &&
            insight.spreadDuration <= fairnessSpreadLimit,
        )
      : [];
  const softBalancedPool =
    selectionMode === 'balance'
      ? fairnessSorted.filter(
          (insight) =>
            insight.allReachable &&
            insight.centerDistance <= 8.5 &&
            insight.axisDistance <= 4 &&
            getEffectiveFairnessSpread(insight, participants) <= softFairnessSpreadLimit,
        )
      : [];

  if (selectionMode === 'balance') {
    const targetSize = explicitTargetCount ?? Math.min(6 + drawPoolExtra, insights.length);
    const minPoolSize = Math.min(targetSize, insights.length, MIN_BALANCE_DRAW_POOL_SIZE);
    const preferredPoolSize = Math.min(
      targetSize,
      insights.length,
      PREFERRED_BALANCE_DRAW_POOL_SIZE,
    );
    const strictSource = verifiedFairPool.length ? verifiedFairPool : balancedPool;

    if (strictSource.length > 0) {
      return {
        pool: strictSource.slice(0, Math.min(targetSize, strictSource.length)),
        fallbackNotice:
          strictSource.length < Math.min(3, targetSize)
            ? '공평 기준을 통과한 후보만 남겼어요.'
            : null,
      };
    }

    const autoRelaxedPool = getAutoRelaxedBalancePool(
      mergeUniqueInsights(strictSource, fairnessSorted, insights.length),
      thrillLevel,
      targetSize,
      participants,
    );

    if (autoRelaxedPool.pool.length >= minPoolSize) {
      const includesOverLimitCandidate = autoRelaxedPool.pool.some(
        (insight) => !insight.allReachable,
      );
      const includesImpossibleFairnessCandidate = autoRelaxedPool.pool.some(
        (insight) =>
          getEffectiveFairnessSpread(insight, participants) >
          getFairnessSpreadLimit(5, participants),
      );
      const relaxedNotice =
        includesImpossibleFairnessCandidate
          ? '거리가 멀어 가까운 중간 후보만 골랐어요.'
          : includesOverLimitCandidate
          ? '조금 먼 후보까지 포함했어요.'
          : autoRelaxedPool.relaxedToLevel > thrillLevel
          ? `범위를 Lv${autoRelaxedPool.relaxedToLevel}까지 넓혔어요.`
          : autoRelaxedPool.pool.length < preferredPoolSize
            ? '중간 후보를 최소 3개 기준으로 압축했어요.'
            : null;

      return {
        pool: autoRelaxedPool.pool.slice(0, Math.min(targetSize, autoRelaxedPool.pool.length)),
        fallbackNotice: relaxedNotice,
      };
    }

    return {
      pool: [],
      fallbackNotice: `중간 후보가 ${minPoolSize}개보다 적어요.`,
    };
  }

  if (verifiedFairPool.length > 0) {
    const targetSize = explicitTargetCount ?? Math.min(6 + drawPoolExtra, insights.length);

    return {
      pool: verifiedFairPool.slice(0, Math.min(targetSize, verifiedFairPool.length)),
      fallbackNotice:
        verifiedFairPool.length < Math.min(3, targetSize)
          ? '시간 차이가 적은 후보만 남겼어요.'
          : null,
    };
  }

  if (balancedPool.length >= 3) {
    const targetSize = explicitTargetCount ?? Math.min(6 + drawPoolExtra, insights.length);
    const coreSize = Math.min(balancedPool.length, Math.max(3, targetSize - 2));

    return {
      pool: mergeUniqueInsights(
        balancedPool.slice(0, coreSize),
        insights,
        Math.min(targetSize, insights.length),
      ),
      fallbackNotice: null,
    };
  }

  if (softBalancedPool.length >= 3) {
    const targetSize = explicitTargetCount ?? Math.min(6 + drawPoolExtra, insights.length);
    const coreSize = Math.min(softBalancedPool.length, Math.max(3, targetSize - 2));

    return {
      pool: mergeUniqueInsights(
        softBalancedPool.slice(0, coreSize),
        insights,
        Math.min(targetSize, insights.length),
      ),
      fallbackNotice: null,
    };
  }

  if (selectionMode === 'neighborhood' && thrillLevel >= 4) {
    const thrillPool = insights.filter(
      (insight) => insight.nearestDuration <= 18 || insight.centerDistance <= 2.5,
    );
    const targetSize = explicitTargetCount ?? Math.min(8 + drawPoolExtra, insights.length);
    const baseCore = (reachable.length >= 4 ? reachable : insights).slice(
      0,
      Math.min(Math.max(5, targetSize - 2), insights.length),
    );
    const mergedPool = mergeUniqueInsights(baseCore, thrillPool, targetSize);

    if (mergedPool.length > baseCore.length) {
      return {
        pool: mergedPool,
        fallbackNotice: '기본 추천에 집앞 느낌 후보를 조금만 추가해서 같이 섞었어요.',
      };
    }

    if (thrillPool.length >= 4) {
      return {
        pool: thrillPool.slice(0, 8 + drawPoolExtra),
        fallbackNotice: '스릴 단계를 높여서 로컬 쪽까지 확 들어간 후보들로 풀을 넓혔어요.',
      };
    }
  }

  if (reachable.length >= 4) {
    return {
      pool: reachable.slice(0, explicitTargetCount ?? (thrillLevel >= 3 ? 7 : 6) + drawPoolExtra),
      fallbackNotice: null,
    };
  }

  if (reachable.length > 0) {
    return {
      pool: fairnessSorted.slice(0, explicitTargetCount ?? (thrillLevel >= 3 ? 7 : 6) + drawPoolExtra),
      fallbackNotice: '완벽한 교집합이 좁아서 가장 덜 무리한 후보까지 같이 추첨 풀에 넣었어요.',
    };
  }

  return {
    pool: fairnessSorted.slice(0, explicitTargetCount ?? (thrillLevel >= 4 ? 6 : 5) + drawPoolExtra),
    fallbackNotice: '모두가 여유롭게 만나는 교집합이 없어, 가장 현실적인 후보들로 추첨 범위를 압축했어요.',
  };
}

function hashText(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededRandom(seed: string | undefined, key: string | number) {
  if (!seed) {
    return Math.random();
  }

  return hashText(`${seed}:${key}`) / 0x100000000;
}

function weightedPick(
  pool: CandidateInsight[],
  selectionMode: SelectionModeKey = 'balance',
  thrillLevel: ThrillLevel = 1,
  participants: Participant[] = [],
  seed?: string,
) {
  const getWeight = (insight: CandidateInsight, index: number) => {
    const categoryWeight = insight.categoryMatched ? 1.24 : 0.78;
    const accessibilityWeight = insight.allReachable ? 1.25 : 0.85;
    const speedWeight = Math.max(0.7, 1.45 - insight.averageDuration / 50);
    const fairRankWeight =
      selectionMode === 'balance'
        ? Math.max(0.18, 2.1 - getFairnessRankingScore(insight, thrillLevel, participants) / 42)
        : 1;
    const neighborhoodWeight =
      selectionMode === 'neighborhood'
        ? Math.max(0.85, 1.38 - insight.nearestDuration / 55) +
          Math.min(0.18, insight.centerDistance / 18)
        : 1;
    const hotplaceWeight =
      selectionMode === 'hotplace'
        ? Math.max(0.55, 1.85 - getHotplaceRankingScore(insight, thrillLevel) / 70)
        : 1;
    const thrillWeight =
      thrillLevel >= 5
        ? Math.max(0.9, 1.85 - insight.nearestDuration / 18)
        : thrillLevel === 4
          ? Math.max(0.92, 1.65 - insight.nearestDuration / 24)
        : thrillLevel === 3
          ? Math.max(0.94, 1.48 - insight.nearestDuration / 30)
          : thrillLevel === 2
            ? Math.max(0.96, 1.32 - insight.nearestDuration / 42)
            : 1;
    const houseFrontWeight =
      selectionMode === 'neighborhood' && thrillLevel >= 5
        ? isHouseFrontCandidate(insight.candidate)
          ? 2.25
          : isLocalWildcardCandidate(insight.candidate)
            ? 1.65
            : insight.nearestDuration <= 14
              ? 1.28
              : 0.92
        : selectionMode === 'neighborhood' && thrillLevel === 4
          ? isLocalWildcardCandidate(insight.candidate)
            ? 1.45
            : insight.nearestDuration <= 16
              ? 1.18
              : 0.96
        : 1;
    const moodWeight =
      insight.candidate.drawMood === '반전 픽'
        ? 1.12
        : insight.candidate.drawMood === '무드 픽'
          ? 1.06
          : 0.98;
    const corridorWeight =
      selectionMode === 'balance'
        ? Math.max(0.16, 1 - getCorridorDriftPenalty(insight) / 95)
        : 1;
    const rankWeight = Math.max(0.85, 1.2 - index * 0.04);

    return (
      categoryWeight *
        accessibilityWeight *
        fairRankWeight *
        speedWeight *
        neighborhoodWeight *
        hotplaceWeight *
        thrillWeight *
        houseFrontWeight *
        moodWeight *
        corridorWeight *
        rankWeight
    );
  };

  const total = pool.reduce((sum, insight, index) => sum + getWeight(insight, index), 0);

  let cursor = seededRandom(seed, 'winner') * total;

  for (const [index, insight] of pool.entries()) {
    const weight = getWeight(insight, index);

    cursor -= weight;
    if (cursor <= 0) {
      return insight;
    }
  }

  return pool[0];
}

function sampleWithoutRepeat(
  pool: CandidateInsight[],
  count: number,
  excludedIds: string[] = [],
  seed?: string,
) {
  const available = pool.filter((insight) => !excludedIds.includes(insight.candidate.id));
  const picked: CandidateInsight[] = [];

  while (available.length && picked.length < count) {
    const index = Math.floor(seededRandom(seed, `sample-${picked.length}`) * available.length);
    picked.push(available[index]);
    available.splice(index, 1);
  }

  return picked;
}

export function buildDrawPlan(
  insights: CandidateInsight[],
  selectionMode: SelectionModeKey = 'balance',
  thrillLevel: ThrillLevel = 1,
  candidateScope: CandidateScopeKey = 'standard',
  lockedWinner?: CandidateInsight | null,
  participants: Participant[] = [],
  drawSeed?: string,
): DrawPlan {
  const { pool, fallbackNotice } = getDrawPool(
    insights,
    selectionMode,
    thrillLevel,
    candidateScope,
    undefined,
    participants,
  );
  const drawPool = pool.length ? pool : insights;
  const fallbackWinner = drawPool[0];

  if (!fallbackWinner) {
    throw new Error('추첨할 후보가 없어요.');
  }

  const winner =
    lockedWinner &&
    drawPool.some((insight) => insight.candidate.id === lockedWinner.candidate.id)
      ? lockedWinner
      : selectionMode === 'balance'
        ? fallbackWinner
        : drawPool.length
          ? weightedPick(drawPool, selectionMode, thrillLevel, participants, drawSeed)
          : fallbackWinner;
  const runnerUps = sampleWithoutRepeat(drawPool, 2, [winner.candidate.id], drawSeed);
  const finalists = [winner, ...runnerUps].slice(0, Math.min(3, drawPool.length));
  const rapidShuffle = Array.from({ length: Math.max(12, drawPool.length * 3) }, (_, index) => {
    return drawPool[Math.floor(seededRandom(drawSeed, `shuffle-${index}`) * drawPool.length)];
  });
  const finalStretch =
    finalists.length >= 3
      ? [
          finalists[1],
          finalists[2],
          winner,
          finalists[1],
          winner,
          finalists[2],
          winner,
          finalists[1],
          winner,
        ]
      : finalists.length === 2
        ? [finalists[1], winner, finalists[1], winner, finalists[1], winner]
        : [winner, winner, winner];

  return {
    winner,
    finalists,
    sequence: [...rapidShuffle, ...finalStretch],
    fallbackNotice,
  };
}
