import {
  Candidate,
  CandidateInsight,
  CandidateScopeKey,
  Coordinates,
  DrawPlan,
  MeetCategoryKey,
  Participant,
  ParticipantSettlement,
  SelectionModeKey,
  Settlement,
  ThrillLevel,
  TravelInfo,
} from '../types';

const EARTH_RADIUS_KM = 6371;
const TRANSIT_SPEED_KM_PER_MIN = 0.45;
const BASE_FARE = 1500;
const FARE_PER_KM = 110;
const MIN_TRAVEL_MINUTES = 12;
const MAX_SETTLEMENT_ADJUSTMENT = 3000;

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

function getDynamicAxisRadiusKm(participants: Participant[], center: Coordinates | null) {
  if (!participants.length || !center) {
    return 0;
  }

  const spreadKm = Math.max(
    ...participants.map((participant) => getDistanceKm(participant.coordinates, center)),
  );
  const averageTravelRadiusKm =
    participants.reduce((sum, participant) => sum + getTravelDistanceFromMinutes(participant.maxTravelTime), 0) /
    participants.length;

  return Math.max(5.5, Math.min(averageTravelRadiusKm * 0.95, spreadKm + 6));
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

  const allowHyperLocal = thrillLevel >= 4;

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
      coordinates: offsetCoordinates(participant.coordinates, index, allowHyperLocal ? 0.55 : 0.9),
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

export function buildCandidateUniverse(
  participants: Participant[],
  candidates: Candidate[],
  selectedCategory?: MeetCategoryKey,
  thrillLevel: ThrillLevel = 1,
) {
  const extraCandidates = buildThrillCandidates(participants, selectedCategory, thrillLevel);
  const candidateMap = new Map<string, Candidate>();

  [...candidates, ...extraCandidates].forEach((candidate) => {
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
  };
}

function formatAccessSummary(participants: Participant[], travelInfo: TravelInfo[]) {
  if (!participants.length || !travelInfo.length) {
    return '출발지를 먼저 입력해 주세요.';
  }

  const limitById = participants.reduce<Record<string, number>>((acc, participant) => {
    acc[participant.id] = participant.maxTravelTime;
    return acc;
  }, {});

  const delayed = travelInfo.filter((info) => info.duration > limitById[info.participantId]);
  const maxDuration = Math.max(...travelInfo.map((info) => info.duration));

  if (!delayed.length) {
    return `모든 참여자가 ${maxDuration}분 안에 도착 가능한 교집합 안입니다.`;
  }

  if (delayed.length === 1) {
    const late = delayed[0];
    return `${late.participantName}는 조금 빠듯하지만, 나머지는 무리 없이 합류할 수 있어요.`;
  }

  return '완벽한 교집합은 아니지만, 가장 부담이 덜한 후보로 압축한 결과예요.';
}

export function getCandidateInsights(
  participants: Participant[],
  candidates: Candidate[],
  selectedCategory?: MeetCategoryKey,
): CandidateInsight[] {
  if (!participants.length) {
    return [];
  }

  const center = getParticipantCenter(participants);

  return candidates
    .map((candidate) => {
      const travelInfo = participants.map((participant) => getTravelInfo(participant, candidate));
      const averageDistance =
        travelInfo.reduce((sum, info) => sum + info.distance, 0) / travelInfo.length;
      const averageDuration =
        travelInfo.reduce((sum, info) => sum + info.duration, 0) / travelInfo.length;
      const maxDuration = Math.max(...travelInfo.map((info) => info.duration));
      const spreadDuration = getTravelSpread(travelInfo);
      const allReachable = travelInfo.every((info) => {
        const participant = participants.find((item) => item.id === info.participantId);
        return info.duration <= (participant?.maxTravelTime ?? 45);
      });
      const categoryMatched = selectedCategory
        ? candidate.categories.includes(selectedCategory)
        : true;
      const sortedTravelInfo = [...travelInfo].sort((left, right) => left.duration - right.duration);
      const nearest = sortedTravelInfo[0];
      const farthest = sortedTravelInfo[sortedTravelInfo.length - 1];
      const centerDistance = center ? getDistanceKm(center, candidate.coordinates) : 0;

      return {
        candidate,
        travelInfo,
        averageDistance: Math.round(averageDistance * 10) / 10,
        averageDuration: Math.round(averageDuration),
        maxDuration,
        spreadDuration,
        allReachable,
        accessSummary: formatAccessSummary(participants, travelInfo),
        categoryMatched,
        centerDistance: Math.round(centerDistance * 10) / 10,
        nearestParticipantName: nearest.participantName,
        nearestDuration: nearest.duration,
        farthestParticipantName: farthest.participantName,
        farthestDuration: farthest.duration,
      };
    })
    .sort((left, right) => {
      if (left.categoryMatched !== right.categoryMatched) {
        return left.categoryMatched ? -1 : 1;
      }

      if (left.allReachable !== right.allReachable) {
        return left.allReachable ? -1 : 1;
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
) {
  const insights = getCandidateInsights(participants, candidates, selectedCategory);

  if (insights.length <= 8) {
    return insights;
  }

  const center = getParticipantCenter(participants);
  const dynamicAxisRadius = getDynamicAxisRadiusKm(participants, center);
  const thrillBias = thrillLevel - 1;
  const scopeBonus = getCandidateScopeBonus(candidateScope);
  const targetCount =
    (selectionMode === 'neighborhood'
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
    scopeBonus;

  const ranked = insights
    .map((insight, index) => {
      const overflowMinutes = insight.travelInfo.reduce((sum, info) => {
        const participant = participants.find((item) => item.id === info.participantId);

        return sum + Math.max(0, info.duration - (participant?.maxTravelTime ?? 45));
      }, 0);
      const radiusOverflow = Math.max(0, insight.centerDistance - dynamicAxisRadius);
      const localityStrength = getLocalityStrength(insight.nearestDuration);
      const extremeBias = Math.max(0, insight.centerDistance - dynamicAxisRadius * 0.58);
      const balanceScore =
        (insight.categoryMatched ? -18 : 0) +
        (insight.allReachable ? -12 : 0) +
        (thrillLevel >= 2 ? -Math.min(6, localityStrength) * 0.38 : 0) +
        insight.centerDistance * 1.65 +
        insight.averageDuration * 0.72 +
        insight.spreadDuration * 0.55 +
        overflowMinutes * 0.7 +
        radiusOverflow * 3.4 +
        (thrillLevel >= 3 ? -Math.min(10, localityStrength) * thrillBias * 0.55 : 0) +
        (thrillLevel === 4 ? -Math.min(14, extremeBias) * 0.95 : 0) +
        index * 0.1;
      const neighborhoodScore =
        (insight.categoryMatched ? -16 : 0) +
        (insight.allReachable ? -6 : 0) +
        insight.nearestDuration * 0.62 +
        insight.farthestDuration * 0.46 +
        insight.spreadDuration * 0.42 +
        overflowMinutes * 0.92 +
        radiusOverflow * 1.15 -
        localityStrength * 1.45 -
        thrillBias * localityStrength * 0.62 -
        Math.min(12, extremeBias) * 0.9 +
        (thrillLevel === 4 ? Math.max(0, insight.farthestDuration - 32) * 0.08 : 0) +
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
    const localAnchors = ranked.filter(
      ({ insight, centerDistance, localityStrength }) =>
        localityStrength >= (thrillLevel >= 4 ? 10 : 4) ||
        centerDistance >= dynamicAxisRadius * (thrillLevel >= 4 ? 0.42 : 0.68) ||
        insight.allReachable,
    );
    const localReserve = thrillLevel >= 4 ? 4 : thrillLevel >= 3 ? 3 : 2;
    const baseCoreCount = Math.max(4, targetCount - localReserve);
    const baseRecommendations = insights.slice(0, Math.min(baseCoreCount, insights.length));
    const localRecommendations = localAnchors.map(({ insight }) => insight);

    return mergeUniqueInsights(
      baseRecommendations,
      localRecommendations,
      Math.min(targetCount, insights.length),
    );
  }

  const categoryFirst = ranked.filter(({ insight }) => insight.categoryMatched);
  const rankedSource = categoryFirst.length >= Math.min(5, targetCount) ? categoryFirst : ranked;
  const dynamicMiddleBand = rankedSource.filter(
    ({ insight, centerDistance }) =>
      insight.allReachable ||
      centerDistance <= dynamicAxisRadius + (thrillLevel >= 3 ? 7.5 : 4.5) ||
      (thrillLevel >= 4 && insight.nearestDuration <= 18),
  );
  const finalSource =
    dynamicMiddleBand.length >= Math.min(targetCount, 6) ? dynamicMiddleBand : rankedSource;

  return finalSource.slice(0, Math.min(targetCount, finalSource.length)).map(({ insight }) => insight);
}

export function getDrawPool(
  insights: CandidateInsight[],
  selectionMode: SelectionModeKey = 'balance',
  thrillLevel: ThrillLevel = 1,
  candidateScope: CandidateScopeKey = 'standard',
) {
  if (insights.length <= 4) {
    return {
      pool: insights,
      fallbackNotice: null,
    };
  }

  const drawPoolExtra = getDrawPoolExtra(candidateScope);

  if (selectionMode === 'neighborhood') {
    const localAnchors = insights.filter(
      (insight) =>
        insight.nearestDuration <= (thrillLevel >= 4 ? 12 : thrillLevel >= 3 ? 18 : 24) ||
        insight.centerDistance >= (thrillLevel >= 4 ? 2.5 : 4.5),
    );
    const targetSize = Math.min((thrillLevel >= 4 ? 8 : 7) + drawPoolExtra, insights.length);
    const baseCoreSize = Math.max(4, targetSize - (thrillLevel >= 4 ? 3 : 2));
    const reachableBase = insights.filter((insight) => insight.allReachable);
    const basePool = (reachableBase.length >= 3 ? reachableBase : insights).slice(
      0,
      Math.min(baseCoreSize, insights.length),
    );
    const mergedPool = mergeUniqueInsights(basePool, localAnchors, targetSize);

    if (mergedPool.length > basePool.length) {
      return {
        pool: mergedPool,
        fallbackNotice: '기본 추천에 로컬 후보를 몇 개만 추가해서 같이 섞었어요.',
      };
    }

    return {
      pool: basePool,
      fallbackNotice: '로컬 후보가 충분하지 않아서 기본 추천 위주로 추첨 풀을 만들었어요.',
    };

    if (localAnchors.length >= 4) {
      return {
        pool: localAnchors.slice(0, (thrillLevel >= 4 ? 8 : 7) + drawPoolExtra),
        fallbackNotice:
          '동네 포함 모드라 누군가의 생활권이나 로컬 상권까지 추첨 풀에 같이 넣었어요.',
      };
    }

    return {
      pool: insights.slice(
        0,
        Math.min((thrillLevel >= 4 ? 8 : 7) + drawPoolExtra, insights.length),
      ),
      fallbackNotice:
        '지금 멤버 기준으로 극단 카드가 많지 않아, 가장 살아 있는 로컬 후보부터 우선 추렸어요.',
    };
  }

  const reachable = insights.filter((insight) => insight.allReachable);

  if (thrillLevel >= 4) {
    const thrillPool = insights.filter(
      (insight) => insight.nearestDuration <= 18 || insight.centerDistance <= 2.5,
    );
    const targetSize = Math.min(8 + drawPoolExtra, insights.length);
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
      pool: reachable.slice(0, (thrillLevel >= 3 ? 7 : 6) + drawPoolExtra),
      fallbackNotice: null,
    };
  }

  if (reachable.length > 0) {
    return {
      pool: insights.slice(0, (thrillLevel >= 3 ? 7 : 6) + drawPoolExtra),
      fallbackNotice: '완벽한 교집합이 좁아서 가장 덜 무리한 후보까지 같이 추첨 풀에 넣었어요.',
    };
  }

  return {
    pool: insights.slice(0, (thrillLevel >= 4 ? 6 : 5) + drawPoolExtra),
    fallbackNotice: '모두가 여유롭게 만나는 교집합이 없어, 가장 현실적인 후보들로 추첨 범위를 압축했어요.',
  };
}

function weightedPick(
  pool: CandidateInsight[],
  selectionMode: SelectionModeKey = 'balance',
  thrillLevel: ThrillLevel = 1,
) {
  const total = pool.reduce((sum, insight, index) => {
    const spread =
      Math.max(...insight.travelInfo.map((info) => info.duration)) -
      Math.min(...insight.travelInfo.map((info) => info.duration));
    const categoryWeight = insight.categoryMatched ? 1.24 : 0.78;
    const accessibilityWeight = insight.allReachable ? 1.25 : 0.85;
    const balanceWeight = Math.max(0.7, 1.5 - spread / 30);
    const speedWeight = Math.max(0.7, 1.45 - insight.averageDuration / 50);
    const neighborhoodWeight =
      selectionMode === 'neighborhood'
        ? Math.max(0.85, 1.38 - insight.nearestDuration / 55) +
          Math.min(0.18, insight.centerDistance / 18)
        : 1;
    const thrillWeight =
      thrillLevel >= 4
        ? Math.max(0.92, 1.8 - insight.nearestDuration / 18)
        : thrillLevel === 3
          ? Math.max(0.94, 1.55 - insight.nearestDuration / 28)
          : thrillLevel === 2
            ? Math.max(0.96, 1.32 - insight.nearestDuration / 42)
            : 1;
    const moodWeight =
      insight.candidate.drawMood === '반전 픽'
        ? 1.12
        : insight.candidate.drawMood === '무드 픽'
          ? 1.06
          : 0.98;
    const rankWeight = Math.max(0.85, 1.2 - index * 0.04);

    return (
      sum +
      categoryWeight *
        accessibilityWeight *
        balanceWeight *
        speedWeight *
        neighborhoodWeight *
        thrillWeight *
        moodWeight *
        rankWeight
    );
  }, 0);

  let cursor = Math.random() * total;

  for (const [index, insight] of pool.entries()) {
    const spread =
      Math.max(...insight.travelInfo.map((info) => info.duration)) -
      Math.min(...insight.travelInfo.map((info) => info.duration));
    const categoryWeight = insight.categoryMatched ? 1.24 : 0.78;
    const accessibilityWeight = insight.allReachable ? 1.25 : 0.85;
    const balanceWeight = Math.max(0.7, 1.5 - spread / 30);
    const speedWeight = Math.max(0.7, 1.45 - insight.averageDuration / 50);
    const neighborhoodWeight =
      selectionMode === 'neighborhood'
        ? Math.max(0.85, 1.38 - insight.nearestDuration / 55) +
          Math.min(0.18, insight.centerDistance / 18)
        : 1;
    const thrillWeight =
      thrillLevel >= 4
        ? Math.max(0.92, 1.8 - insight.nearestDuration / 18)
        : thrillLevel === 3
          ? Math.max(0.94, 1.55 - insight.nearestDuration / 28)
          : thrillLevel === 2
            ? Math.max(0.96, 1.32 - insight.nearestDuration / 42)
            : 1;
    const moodWeight =
      insight.candidate.drawMood === '반전 픽'
        ? 1.12
        : insight.candidate.drawMood === '무드 픽'
          ? 1.06
          : 0.98;
    const rankWeight = Math.max(0.85, 1.2 - index * 0.04);
    const weight =
      categoryWeight *
      accessibilityWeight *
      balanceWeight *
      speedWeight *
      neighborhoodWeight *
      thrillWeight *
      moodWeight *
      rankWeight;

    cursor -= weight;
    if (cursor <= 0) {
      return insight;
    }
  }

  return pool[0];
}

function sampleWithoutRepeat(pool: CandidateInsight[], count: number, excludedIds: string[] = []) {
  const available = pool.filter((insight) => !excludedIds.includes(insight.candidate.id));
  const picked: CandidateInsight[] = [];

  while (available.length && picked.length < count) {
    const index = Math.floor(Math.random() * available.length);
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
): DrawPlan {
  const { pool, fallbackNotice } = getDrawPool(
    insights,
    selectionMode,
    thrillLevel,
    candidateScope,
  );
  const winner = weightedPick(pool, selectionMode, thrillLevel);
  const runnerUps = sampleWithoutRepeat(pool, 2, [winner.candidate.id]);
  const finalists = [winner, ...runnerUps].slice(0, Math.min(3, pool.length));
  const rapidShuffle = Array.from({ length: Math.max(12, pool.length * 3) }, () => {
    return pool[Math.floor(Math.random() * pool.length)];
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

export function buildSettlementPreview(
  winner: Candidate,
  participants: Participant[],
  payments: Record<string, number>,
  totalCost: number,
  travelInfoOverride?: TravelInfo[],
) {
  const travelInfo =
    travelInfoOverride && travelInfoOverride.length
      ? participants.map((participant) => {
          return (
            travelInfoOverride.find((info) => info.participantId === participant.id) ??
            getTravelInfo(participant, winner)
          );
        })
      : participants.map((participant) => getTravelInfo(participant, winner));
  const perPersonBase = participants.length ? totalCost / participants.length : 0;
  const averageTravelCost =
    travelInfo.reduce((sum, info) => sum + info.cost, 0) / Math.max(travelInfo.length, 1);

  const rows: ParticipantSettlement[] = participants.map((participant) => {
    const travelCost =
      travelInfo.find((info) => info.participantId === participant.id)?.cost ?? averageTravelCost;
    const rawAdjustment = travelCost - averageTravelCost;
    const adjustment = Math.max(
      -MAX_SETTLEMENT_ADJUSTMENT,
      Math.min(MAX_SETTLEMENT_ADJUSTMENT, Math.round(rawAdjustment * 0.6)),
    );
    const shouldPay = Math.max(0, Math.round(perPersonBase - adjustment));
    const paid = payments[participant.id] ?? 0;

    return {
      participant,
      travelCost,
      shouldPay,
      paid,
      balance: paid - shouldPay,
    };
  });

  const debtors = rows
    .filter((row) => row.balance < 0)
    .map((row) => ({ name: row.participant.name, remaining: Math.abs(row.balance) }));
  const creditors = rows
    .filter((row) => row.balance > 0)
    .map((row) => ({ name: row.participant.name, remaining: row.balance }));

  const settlements: Settlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);

    if (amount > 0) {
      settlements.push({
        from: debtor.name,
        to: creditor.name,
        amount,
      });
    }

    debtor.remaining -= amount;
    creditor.remaining -= amount;

    if (debtor.remaining <= 0) {
      debtorIndex += 1;
    }

    if (creditor.remaining <= 0) {
      creditorIndex += 1;
    }
  }

  return {
    travelInfo,
    rows,
    settlements,
    averageTravelCost: Math.round(averageTravelCost),
    totalPaid: Object.values(payments).reduce((sum, amount) => sum + amount, 0),
    totalExpected: Math.round(rows.reduce((sum, row) => sum + row.shouldPay, 0)),
  };
}
