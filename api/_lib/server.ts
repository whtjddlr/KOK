type EnvMap = Record<string, string | undefined>;
export type AiProviderName = 'gms' | 'upstage' | 'openai';

export type ServerAiProvider =
  | {
      provider: 'gms' | 'upstage';
      apiKey: string;
      model: string;
      baseUrl: string;
    }
  | {
      provider: 'openai';
      apiKey: string;
      model: string;
    };

export async function readJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
}

export function json(res: any, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function pickFirstEnv(env: EnvMap, keys: string[]) {
  for (const key of keys) {
    const value = env[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

export function getServerGmsAiConfig(env: EnvMap): ServerAiProvider | null {
  const apiKey = pickFirstEnv(env, ['GMS_AI_API_KEY', 'GMS_API_KEY', 'VITE_GMS_AI_API_KEY']);
  const model = pickFirstEnv(env, ['GMS_AI_MODEL', 'GMS_MODEL', 'VITE_GMS_AI_MODEL']);
  const baseUrl = pickFirstEnv(env, [
    'GMS_AI_API_BASE_URL',
    'GMS_API_BASE_URL',
    'VITE_GMS_AI_API_BASE_URL',
  ]);

  if (!apiKey || !model || !baseUrl) {
    return null;
  }

  return {
    provider: 'gms',
    apiKey,
    model,
    baseUrl,
  };
}

export function getServerAiProviders(env: EnvMap, runtimeAiConfig: any): ServerAiProvider[] {
  const providers: ServerAiProvider[] = [];
  const seenProviders = new Set<AiProviderName>();
  const addProvider = (provider: ServerAiProvider | null) => {
    if (!provider || seenProviders.has(provider.provider)) {
      return;
    }

    seenProviders.add(provider.provider);
    providers.push(provider);
  };

  if (runtimeAiConfig?.provider === 'gms' && runtimeAiConfig.baseUrl) {
    addProvider({
      provider: 'gms',
      apiKey: runtimeAiConfig.apiKey,
      model: runtimeAiConfig.model,
      baseUrl: runtimeAiConfig.baseUrl,
    });
  }

  if (runtimeAiConfig?.provider === 'upstage') {
    addProvider({
      provider: 'upstage',
      apiKey: runtimeAiConfig.apiKey,
      model: runtimeAiConfig.model,
      baseUrl:
        runtimeAiConfig.baseUrl ||
        pickFirstEnv(env, [
          'UPSTAGE_API_BASE_URL',
          'SOLAR_API_BASE_URL',
          'VITE_UPSTAGE_API_BASE_URL',
        ]) ||
        'https://api.upstage.ai/v1',
    });
  }

  if (runtimeAiConfig?.provider === 'openai') {
    addProvider({
      provider: 'openai',
      apiKey: runtimeAiConfig.apiKey,
      model: runtimeAiConfig.model,
    });
  }

  addProvider(getServerGmsAiConfig(env));

  const rawOpenAiKey = pickFirstEnv(env, ['OPENAI_API_KEY', 'AI_API_KEY', 'VITE_OPENAI_API_KEY']);
  const rawUpstageKey = pickFirstEnv(env, [
    'UPSTAGE_API_KEY',
    'SOLAR_API_KEY',
    'VITE_UPSTAGE_API_KEY',
  ]);
  const detectedUpstageKey =
    rawUpstageKey || (rawOpenAiKey.startsWith('up_') ? rawOpenAiKey : '');
  const detectedOpenAiKey =
    detectedUpstageKey && rawOpenAiKey === detectedUpstageKey ? '' : rawOpenAiKey;

  if (detectedOpenAiKey) {
    addProvider({
      provider: 'openai',
      apiKey: detectedOpenAiKey,
      model: pickFirstEnv(env, ['OPENAI_MODEL', 'VITE_OPENAI_MODEL']) || 'gpt-4o',
    });
  }

  if (detectedUpstageKey) {
    addProvider({
      provider: 'upstage',
      apiKey: detectedUpstageKey,
      model: pickFirstEnv(env, ['UPSTAGE_MODEL', 'SOLAR_MODEL', 'VITE_UPSTAGE_MODEL']) || 'solar-pro3',
      baseUrl:
        pickFirstEnv(env, [
          'UPSTAGE_API_BASE_URL',
          'SOLAR_API_BASE_URL',
          'VITE_UPSTAGE_API_BASE_URL',
        ]) || 'https://api.upstage.ai/v1',
    });
  }

  return providers;
}

function getCandidateScopeBonus(candidateScope: string) {
  if (candidateScope === 'max') {
    return 4;
  }

  if (candidateScope === 'wide') {
    return 2;
  }

  return 0;
}

const FAIRNESS_SPREAD_LIMIT_BY_LEVEL: Record<number, number> = {
  1: 10,
  2: 15,
  3: 20,
  4: 25,
  5: 35,
};

const FAIRNESS_LEVEL_DISTANCE_SCALE: Record<number, number> = {
  1: 0.55,
  2: 0.72,
  3: 0.88,
  4: 1,
  5: 1.15,
};
const FAIRNESS_DYNAMIC_CAP_BY_LEVEL: Record<number, number> = {
  1: 42,
  2: 50,
  3: 58,
  4: 66,
  5: 76,
};

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getParticipantCoordinates(participant: any) {
  const lat = Number(participant?.coordinates?.lat);
  const lng = Number(participant?.coordinates?.lng);

  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function getDistanceKm(left: { lat: number; lng: number }, right: { lat: number; lng: number }) {
  const earthRadiusKm = 6371;
  const latDiff = toRadians(right.lat - left.lat);
  const lngDiff = toRadians(right.lng - left.lng);
  const startLat = toRadians(left.lat);
  const endLat = toRadians(right.lat);
  const haversine =
    Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
    Math.cos(startLat) *
      Math.cos(endLat) *
      Math.sin(lngDiff / 2) *
      Math.sin(lngDiff / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getAdaptiveFairnessSpreadBonus(participants: any[] = []) {
  const coordinates = participants
    .map(getParticipantCoordinates)
    .filter((coordinate): coordinate is { lat: number; lng: number } => Boolean(coordinate));

  if (coordinates.length < 2) {
    return 0;
  }

  const center = {
    lat: coordinates.reduce((sum, coordinate) => sum + coordinate.lat, 0) / coordinates.length,
    lng: coordinates.reduce((sum, coordinate) => sum + coordinate.lng, 0) / coordinates.length,
  };
  const pairDistanceKm = Math.max(
    ...coordinates.flatMap((coordinate, firstIndex) =>
      coordinates.slice(firstIndex + 1).map((otherCoordinate) =>
        getDistanceKm(coordinate, otherCoordinate),
      ),
    ),
  );
  const spreadKm = Math.max(...coordinates.map((coordinate) => getDistanceKm(coordinate, center)));
  const pairBaseKm = coordinates.length >= 3 ? 18 : 16;
  const pairBonus = Math.max(0, pairDistanceKm - pairBaseKm) * (coordinates.length >= 3 ? 0.42 : 0.32);
  const spreadBonus = Math.max(0, spreadKm - 8) * (coordinates.length >= 3 ? 0.55 : 0.35);
  const complexityBonus = Math.max(0, coordinates.length - 2) * 3;

  return Math.min(30, Math.round(pairBonus + spreadBonus + complexityBonus));
}

function getFairnessSpreadLimit(thrillLevel: number, participants: any[] = []) {
  const level = Math.max(1, Math.min(5, Math.round(thrillLevel)));
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

function getInsightSpreadDuration(insight: any) {
  return typeof insight?.spreadDuration === 'number'
    ? insight.spreadDuration
    : Number.MAX_SAFE_INTEGER;
}

function getInsightFarthestDuration(insight: any) {
  return typeof insight?.farthestDuration === 'number'
    ? insight.farthestDuration
    : Number.MAX_SAFE_INTEGER;
}

function getInsightAverageDuration(insight: any) {
  return typeof insight?.averageDuration === 'number'
    ? insight.averageDuration
    : Number.MAX_SAFE_INTEGER;
}

function getInsightNumber(insight: any, key: string, fallback = 0) {
  return typeof insight?.[key] === 'number' ? insight[key] : fallback;
}

function getInsightFairEfficiencyScore(insight: any, thrillLevel: number, participants: any[] = []) {
  const spread = getInsightSpreadDuration(insight);
  const average = getInsightAverageDuration(insight);
  const farthest = getInsightFarthestDuration(insight);
  const overage = Math.max(0, spread - getFairnessSpreadLimit(thrillLevel, participants));
  const longTripPenalty =
    Math.max(0, average - 48) * 0.85 + Math.max(0, farthest - 58) * 0.55;
  const corridorDriftPenalty = getInsightCorridorDriftPenalty(insight);

  return (
    spread * 1.6 +
    average * 0.85 +
    farthest * 0.62 +
    getInsightNumber(insight, 'centerDistance') * 0.8 +
    getInsightNumber(insight, 'axisDistance') * 1.05 +
    longTripPenalty +
    corridorDriftPenalty +
    overage * 10 +
    overage * overage * 0.75 +
    (insight?.allReachable === false ? 24 : 0) +
    (insight?.categoryMatched === false ? 6 : 0)
  );
}

function getInsightCorridorDriftPenalty(insight: any) {
  const spread = getInsightSpreadDuration(insight);
  const average = getInsightAverageDuration(insight);
  const axisDrift = Math.max(0, getInsightNumber(insight, 'axisDistance') - 4.2);
  const centerDrift = Math.max(0, getInsightNumber(insight, 'centerDistance') - 8);
  const equalLongTripPenalty = spread <= 10 && average >= 34 ? (average - 33) * 2.2 : 0;

  return axisDrift * 8.5 + centerDrift * 5.4 + equalLongTripPenalty;
}

function isDetachedFairnessTrap(insight: any) {
  return (
    getInsightNumber(insight, 'axisDistance') >= 6 &&
    getInsightNumber(insight, 'centerDistance') >= 7.5 &&
    getInsightAverageDuration(insight) >= 34 &&
    getInsightSpreadDuration(insight) <= 15
  );
}

function getFairnessBand(insight: any, thrillLevel: number, participants: any[] = []) {
  const spread = getInsightSpreadDuration(insight);
  const limit = getFairnessSpreadLimit(thrillLevel, participants);
  const softLimit = Math.min(getFairnessSpreadLimit(5, participants), limit + 5);
  const isDetached = isDetachedFairnessTrap(insight);

  if (spread <= limit && !isDetached) {
    return 0;
  }

  if (spread <= softLimit && !isDetached) {
    return 1;
  }

  if (spread <= limit) {
    return 2;
  }

  if (spread <= softLimit) {
    return 3;
  }

  return 4;
}

function compareInsightsByFairness(
  left: any,
  right: any,
  thrillLevel: number,
  participants: any[] = [],
) {
  const leftSpread = getInsightSpreadDuration(left);
  const rightSpread = getInsightSpreadDuration(right);
  const leftBand = getFairnessBand(left, thrillLevel, participants);
  const rightBand = getFairnessBand(right, thrillLevel, participants);

  if (leftBand !== rightBand) {
    return leftBand - rightBand;
  }

  const scoreDiff =
    getInsightFairEfficiencyScore(left, thrillLevel, participants) -
    getInsightFairEfficiencyScore(right, thrillLevel, participants);

  if (Math.abs(scoreDiff) > 1) {
    return scoreDiff;
  }

  if (leftSpread !== rightSpread) {
    return leftSpread - rightSpread;
  }

  const leftFarthest = getInsightFarthestDuration(left);
  const rightFarthest = getInsightFarthestDuration(right);

  if (leftFarthest !== rightFarthest) {
    return leftFarthest - rightFarthest;
  }

  return getInsightAverageDuration(left) - getInsightAverageDuration(right);
}

export function reorderCandidateIdsByFairness(
  candidateIds: string[],
  insights: any[],
  thrillLevel: number,
  participants: any[] = [],
) {
  const orderIndex = new Map(candidateIds.map((candidateId, index) => [candidateId, index]));

  return candidateIds
    .map((candidateId) => insights.find((insight) => getInsightCandidateId(insight) === candidateId))
    .filter(Boolean)
    .sort((left, right) => {
      const fairnessDiff = compareInsightsByFairness(left, right, thrillLevel, participants);

      if (fairnessDiff !== 0) {
        return fairnessDiff;
      }

      return (
        (orderIndex.get(getInsightCandidateId(left)) ?? Number.MAX_SAFE_INTEGER) -
        (orderIndex.get(getInsightCandidateId(right)) ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .map((insight) => getInsightCandidateId(insight));
}

export function pickTargetCount(
  total: number,
  selectionMode: string,
  thrillLevel: number,
  candidateScope: string,
  requestedTargetCount?: number,
) {
  if (typeof requestedTargetCount === 'number' && Number.isFinite(requestedTargetCount)) {
    return Math.max(1, Math.min(Math.round(requestedTargetCount), total));
  }

  const baseCount = selectionMode === 'neighborhood' ? 7 : selectionMode === 'hotplace' ? 8 : 6;
  const thrillBonus = thrillLevel >= 5 ? 3 : thrillLevel >= 4 ? 2 : thrillLevel >= 3 ? 1 : 0;
  const scopeBonus = getCandidateScopeBonus(candidateScope);
  return Math.max(1, Math.min(baseCount + thrillBonus + scopeBonus, total));
}

export function buildFallbackCandidateIds(
  insights: Array<{ candidate?: { id?: string } }>,
  fallbackCandidateIds: string[],
  selectionMode: string,
  thrillLevel: number,
  candidateScope: string,
  requestedTargetCount?: number,
) {
  const seen = new Set<string>();
  const allowedIds = new Set(
    insights
      .map((insight) => insight?.candidate?.id)
      .filter((candidateId): candidateId is string => typeof candidateId === 'string' && candidateId.length > 0),
  );
  const orderedIds = [
    ...fallbackCandidateIds.filter((candidateId) => allowedIds.has(candidateId)),
    ...insights.map((insight) => insight?.candidate?.id),
  ]
    .filter((candidateId): candidateId is string => typeof candidateId === 'string' && candidateId.length > 0)
    .filter((candidateId) => {
      if (seen.has(candidateId)) {
        return false;
      }

      seen.add(candidateId);
      return true;
    });

  const targetCount = pickTargetCount(
    orderedIds.length,
    selectionMode,
    thrillLevel,
    candidateScope,
    requestedTargetCount,
  );

  const orderedForMode =
    selectionMode === 'balance'
      ? reorderCandidateIdsByFairness(orderedIds, insights, thrillLevel)
      : orderedIds;

  return orderedForMode.slice(0, targetCount);
}

function getInsightCandidateId(insight: any) {
  return typeof insight?.candidate?.id === 'string' ? insight.candidate.id : '';
}

function getParticipantDuration(insight: any, participant: any) {
  const participantId = typeof participant?.id === 'string' ? participant.id : '';
  const participantName = typeof participant?.name === 'string' ? participant.name : '';
  const travelInfo = Array.isArray(insight?.travelInfo) ? insight.travelInfo : [];
  const match = travelInfo.find(
    (info: any) =>
      (participantId && info?.participantId === participantId) ||
      (participantName && info?.participantName === participantName),
  );

  return typeof match?.duration === 'number' ? match.duration : Number.MAX_SAFE_INTEGER;
}

function isParticipantLocalInsight(insight: any, participant: any) {
  const participantId = typeof participant?.id === 'string' ? participant.id : '';
  const participantName = typeof participant?.name === 'string' ? participant.name : '';
  const candidateId = getInsightCandidateId(insight);
  const district = typeof insight?.candidate?.district === 'string' ? insight.candidate.district : '';
  const tags = Array.isArray(insight?.candidate?.tags) ? insight.candidate.tags : [];

  return Boolean(
    participantName &&
      (insight?.nearestParticipantName === participantName ||
        tags.includes(participantName) ||
        district.includes(`${participantName} 근처`) ||
        (participantId &&
          (candidateId.includes(`-${participantId}-`) ||
            candidateId.endsWith(`-${participantId}`)))),
  );
}

function isHouseFrontCandidateId(candidateId: string) {
  return candidateId.startsWith('thrill-hyper-');
}

function isLocalWildcardCandidateId(candidateId: string) {
  return (
    isHouseFrontCandidateId(candidateId) ||
    candidateId.startsWith('thrill-local-') ||
    candidateId.startsWith('participant-near-')
  );
}

function getParticipantLocalScore(insight: any, participant: any) {
  const duration = getParticipantDuration(insight, participant);
  const explicitLocalBonus = isParticipantLocalInsight(insight, participant) ? -28 : 0;
  const candidateId = getInsightCandidateId(insight);
  const houseFrontBonus = isHouseFrontCandidateId(candidateId) ? -18 : 0;
  const wildcardBonus = isLocalWildcardCandidateId(candidateId) ? -8 : 0;
  const nearestBonus =
    typeof participant?.name === 'string' && insight?.nearestParticipantName === participant.name
      ? -10
      : 0;

  return (
    duration * 0.78 +
    (Number(insight?.spreadDuration) || 0) * 0.72 +
    (Number(insight?.farthestDuration) || 0) * 0.24 +
    (Number(insight?.centerDistance) || 0) * 0.18 +
    explicitLocalBonus +
    houseFrontBonus +
    wildcardBonus +
    nearestBonus
  );
}

function isExplicitParticipantLocalInsight(
  insight: any,
  participant: any,
  requireHouseFront = false,
) {
  if (!isParticipantLocalInsight(insight, participant)) {
    return false;
  }

  const candidateId = getInsightCandidateId(insight);
  return requireHouseFront
    ? isHouseFrontCandidateId(candidateId)
    : isLocalWildcardCandidateId(candidateId);
}

function getParticipantLocalAnchor(
  insights: any[],
  participant: any,
  usedIds: Set<string>,
  requireHouseFront = false,
) {
  const unusedInsights = insights.filter((insight) => {
    const candidateId = getInsightCandidateId(insight);
    return candidateId && !usedIds.has(candidateId);
  });
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
        insight?.nearestParticipantName === participant?.name ||
        getParticipantDuration(insight, participant) <= 16,
    )
    .sort(
      (left, right) =>
        getParticipantLocalScore(left, participant) -
        getParticipantLocalScore(right, participant),
    )[0];
}

export function ensureParticipantLocalCoverageIds(
  candidateIds: string[],
  insights: any[],
  participants: any[],
  limit: number,
  selectionMode = 'balance',
  thrillLevel = 1,
) {
  if (!Array.isArray(participants) || participants.length < 2 || !Array.isArray(insights) || !insights.length) {
    return candidateIds.slice(0, limit);
  }

  const insightById = new Map(
    insights
      .map((insight) => [getInsightCandidateId(insight), insight] as const)
      .filter(([candidateId]) => candidateId),
  );
  const targetLimit = Math.min(Math.max(1, limit), insightById.size);
  const nextIds: string[] = [];
  const usedIds = new Set<string>();

  for (const candidateId of candidateIds) {
    if (!insightById.has(candidateId) || usedIds.has(candidateId)) {
      continue;
    }

    nextIds.push(candidateId);
    usedIds.add(candidateId);

    if (nextIds.length >= targetLimit) {
      break;
    }
  }

  const isLocalHeavyMode = selectionMode === 'neighborhood' && thrillLevel >= 4;
  const isHouseFrontMode = selectionMode === 'neighborhood' && thrillLevel >= 5;

  if (!isLocalHeavyMode) {
    return nextIds.slice(0, targetLimit);
  }

  if (isHouseFrontMode) {
    const requiredIds: string[] = [];
    const usedRequiredIds = new Set<string>();

    for (const participant of participants.slice(0, targetLimit)) {
      const localAnchor = getParticipantLocalAnchor(
        insights,
        participant,
        usedRequiredIds,
        true,
      );
      const localAnchorId = getInsightCandidateId(localAnchor);

      if (!localAnchorId) {
        continue;
      }

      requiredIds.push(localAnchorId);
      usedRequiredIds.add(localAnchorId);
    }

    if (requiredIds.length) {
      const mergedIds = [...requiredIds];
      const seenIds = new Set(requiredIds);

      for (const candidateId of nextIds) {
        if (seenIds.has(candidateId)) {
          continue;
        }

        mergedIds.push(candidateId);
        seenIds.add(candidateId);

        if (mergedIds.length >= targetLimit) {
          break;
        }
      }

      return mergedIds.slice(0, targetLimit);
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

    const alreadyCovered = nextIds.some((candidateId) => {
      const insight = insightById.get(candidateId);
      return insight
        ? isLocalHeavyMode
          ? isExplicitParticipantLocalInsight(insight, participant, isHouseFrontMode)
          : isParticipantLocalInsight(insight, participant)
        : false;
    });

    if (alreadyCovered) {
      continue;
    }

    const localAnchor = getParticipantLocalAnchor(
      insights,
      participant,
      usedIds,
      isHouseFrontMode,
    );
    const localAnchorId = getInsightCandidateId(localAnchor);

    if (!localAnchorId) {
      continue;
    }

    if (nextIds.length >= targetLimit) {
      const replaceIndex = Math.max(
        0,
        nextIds
          .map((candidateId, index) => ({ candidateId, index }))
          .reverse()
          .find(({ candidateId }) => {
            const insight = insightById.get(candidateId);
            return insight
              ? participants.every((item) =>
                  isLocalHeavyMode
                    ? !isExplicitParticipantLocalInsight(insight, item, false)
                    : !isParticipantLocalInsight(insight, item),
                )
              : true;
          })?.index ?? nextIds.length - 1,
      );

      usedIds.delete(nextIds[replaceIndex]);
      nextIds.splice(replaceIndex, 1);
    }

    nextIds.push(localAnchorId);
    usedIds.add(localAnchorId);
    insertedLocalCount += 1;
  }

  return nextIds.slice(0, targetLimit);
}

function extractResponseText(data: any) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const collected: string[] = [];

  for (const item of data?.output ?? []) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const content of item.content) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        collected.push(content.text.trim());
      }
    }
  }

  return collected.join('\n').trim();
}

function getThrillHint(thrillLevel: number) {
  if (thrillLevel >= 5) {
    return 'Keep a fair midpoint core, but include one explicit local extreme anchor per participant. Prefer one thrill-hyper id for each participant first; use thrill-local or participant-near only as fallback.';
  }

  if (thrillLevel === 4) {
    return 'Keep a fair midpoint core, then add participant-near or thrill-local candidates around one person, but avoid exact house-front picks.';
  }

  if (thrillLevel === 3) {
    return 'Keep the fair midpoint core, then mix in a few nearby neighborhood wildcard picks.';
  }

  if (thrillLevel === 2) {
    return 'Stay centered and fair for everyone, but allow a little more surprise than the safest midpoint.';
  }

  return 'Focus on realistic, fair midpoint areas for the whole group.';
}

function inferMetroArea(candidate: any) {
  const text = `${candidate?.name ?? ''} ${candidate?.district ?? ''} ${Array.isArray(candidate?.tags) ? candidate.tags.join(' ') : ''}`;

  if (
    ['인천', '송도', '부평', '구월', '청라', '주안', '계양', '연수', '검암', '작전'].some(
      (keyword) => text.includes(keyword),
    )
  ) {
    return '인천';
  }

  if (
    [
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
      '시흥',
    ].some((keyword) => text.includes(keyword))
  ) {
    return '경기';
  }

  return '서울';
}

function buildSelectionPayload(
  participants: any[],
  insights: any[],
  selectedCategory: string,
  selectionMode: string,
  thrillLevel: number,
  candidateScope: string,
  targetCount: number,
) {
  const isNearOnePersonMode = selectionMode === 'neighborhood' && thrillLevel >= 4;
  const isHouseFrontMode = selectionMode === 'neighborhood' && thrillLevel >= 5;
  const isHotplaceMode = selectionMode === 'hotplace';
  const isBalanceMode = selectionMode === 'balance';
  const fairnessSpreadLimit = getFairnessSpreadLimit(thrillLevel, participants);
  const categoryLabels: Record<string, string> = {
    dining: '식사',
    cafe: '카페',
    drink: '술자리',
    date: '데이트',
    culture: '문화/산책',
    activity: '액티비티',
  };
  const categoryLabel = categoryLabels[selectedCategory] ?? selectedCategory;

  return {
    selectionGoal:
      isHotplaceMode
        ? 'Select attractive hotplace/commercial-area candidates across the Seoul Capital Area. Category fit and venue density are the main criteria.'
        : isHouseFrontMode
          ? 'Select explicit participant-local or house-front neighborhood candidates. The mix should be fair by participant bucket, not by travel-time spread.'
          : 'Select meetup area candidates across the Seoul Capital Area (Seoul, Gyeonggi, Incheon) near the middle of the group so everyone can reach them as fairly as possible.',
    granularityRule:
      '수도권 약속 장소 후보를 고를 때는 시/구 단위가 아니라 실제 사람들이 약속을 잡는 동네/상권 단위로만 반환해라. 예: 수원 -> 수원역, 행궁동, 인계동. 예: 인천 -> 부평 문화의거리, 구월 로데오, 송도 센트럴파크. 예: 부천 -> 부천역, 상동, 중동. 너무 넓은 지역명(예: 부천, 수원, 인천, 성남)만 단독으로 반환하지 마라. 모든 후보는 네이버 지역 검색으로 바로 검색 가능한 이름이어야 한다.',
    rangeRule:
      '참여자 위치가 서로 가까우면 검색 범위를 넓히지 말고, 가까운 생활권 안의 구체적인 동네/상권 후보만 고른다. 후보가 부족하면 억지로 먼 유명 상권을 섞지 말고 제공된 가까운 후보 안에서만 선택한다.',
    fairnessRule:
      isBalanceMode
        ? `Lv${thrillLevel} 공정도는 참여자별 이동시간 편차(spreadDuration) ${fairnessSpreadLimit}분 이하가 기준이다. 이 기준 안의 후보를 우선하되, 모든 참여자가 똑같이 오래 이동해서 편차만 작아진 후보는 공평해 보이는 함정으로 낮게 평가해라. 중간에서 만나 모드에서는 spreadDuration뿐 아니라 averageDuration, farthestDuration, centerDistance, axisDistance를 함께 보고 실제 이동 부담이 낮은 후보를 우선해라. 공정 모드에서는 서울/경기/인천 지역 안배보다 이동 편차와 효율이 먼저이며, 지역 대표 후보를 억지로 넣어 편차나 총 이동 부담을 키우지 마라.`
        : isHotplaceMode
          ? '핫플에서 만나 모드에는 Lv 공정도를 적용하지 않는다. selectedCategory와 가장 어울리는 상권/동네 매력, 코스 밀도, 분위기를 우선하고 이동시간 편차는 탈락 기준으로 쓰지 마라. 다만 한 사람 집앞 후보나 단순 로컬 후보는 핫플이 아니므로 피하고, averageDuration/farthestDuration이 지나치게 비현실적인 후보만 뒤로 둬라.'
          : '집앞 모드에는 Lv 공정도를 적용하지 않는다. 시간 편차보다 참여자별 로컬 후보 비율의 공정성이 중요하다. 한 참여자의 집앞 후보만 몰아주지 말고 각 참여자에게 적어도 하나씩 로컬/집앞 후보가 돌아가도록 고른다.',
    twoPersonRule:
      participants.length === 2 && isBalanceMode
        ? '2명 모임에서는 후보가 애매하게 퍼지기 쉬우니 두 출발지를 잇는 이동축 근처, 그중에서도 한쪽 끝이 아니라 가운데 35~65% 구간에 가까운 후보를 우선해라. 편차가 낮아도 둘 다 오래 이동하거나 이동축에서 크게 벗어난 후보는 공평해 보이는 함정으로 보고 낮게 평가해라. 축에 가까운 후보가 편차 기준을 1~5분 정도 넘더라도 averageDuration/farthestDuration이 낮으면 그쪽을 더 현실적인 중간 후보로 봐라.'
        : isBalanceMode
          ? '3명 이상 모임에서는 전체 중심과 참여자별 편차를 함께 본다.'
          : '비중간 모드에서는 2명이어도 이동축 중앙을 강제하지 말고, 모드의 후보 성격과 참여자별 후보 비율을 먼저 본다.',
    categoryRule:
      isHotplaceMode
        ? `${categoryLabel} 카테고리에 잘 맞는 상권을 우선해라. 단순 프랜차이즈가 있는 곳이 아니라, 그 동네에서 실제로 ${categoryLabel} 코스를 짤 만한 식당/카페/바/전시/액티비티 밀도가 있는 후보를 고른다. 유명한 곳만 반복하지 말고 덜 유명해도 카테고리와 분위기가 강한 상권을 살려라.`
        : isBalanceMode
          ? `${categoryLabel} 카테고리에 잘 맞는 상권을 고르되, 카테고리 적합성은 공정성 다음 기준이다. 먼저 fairnessSpreadLimit 안에 있거나 spreadDuration이 작은 후보를 고르고, 그 안에서 selectedCategory와 tags/categories/bestFor가 잘 맞는 후보를 우선해라. 유명한 상권 하나로 몰지 말고, 덜 유명한 동네라도 ${categoryLabel}에 맞는 식당/카페/바/전시/액티비티 포인트가 있으면 공정한 후보로 살려라. 카테고리 때문에 한 참여자 근처로 과하게 쏠리는 선택은 피하라.`
          : `${categoryLabel} 카테고리에 맞는 로컬 후보를 참여자별로 고르게 배분해라. 집앞 후보라도 카테고리와 전혀 맞지 않으면 뒤로 두고, 각 참여자 주변에서 실제 코스를 만들 수 있는 후보를 우선해라.`,
    localModeRule:
      isHotplaceMode
        ? 'Hotplace mode: prefer lively, category-fitting commercial areas even if they are not the mathematically perfect midpoint. Do not include house-front, thrill-hyper, or participant-near wildcard picks unless the candidate is also a recognizable commercial area.'
        : isHouseFrontMode
        ? 'House-front mode is intentionally local: every participant must have at least one explicit local wildcard candidate in the final ids when possible. Prefer exactly one thrill-hyper id per participant first, then use thrill-local or participant-near as fallback. Do not give two house-front picks to one participant while another participant has none.'
        : isNearOnePersonMode
          ? 'Near-one-person mode: include participant-near or thrill-local commercial areas across participants as evenly as possible. Do not use thrill-hyper unless it is level 5.'
        : isBalanceMode && thrillLevel >= 3
          ? 'Do not replace the balanced core with only local picks. Add local wildcard areas on top of the fair midpoint core.'
        : isBalanceMode
          ? 'Return only balanced midpoint recommendations.'
          : 'Return mode-specific candidates without applying travel-time fairness levels.',
    candidateMixRule:
      isHotplaceMode
        ? 'Classify the final set mentally as hotplace appeal / category fit / route practicality. Hotplace appeal may beat perfect fairness.'
        : isHouseFrontMode
        ? 'Classify the final set mentally by participant-local buckets. The house-front wildcard bucket must be participant-fair: one local extreme anchor for each participant before adding extra picks.'
        : isNearOnePersonMode
          ? 'Classify the final set mentally as fair midpoint / participant-near neighborhood. Include a few one-person-near picks, but keep exact house-front picks out.'
        : 'Keep candidate selection centered on fair and realistic meetup areas.',
    selectedCategory,
    categoryLabel,
    selectionMode,
    thrillLevel,
    fairnessSpreadLimit: isBalanceMode ? fairnessSpreadLimit : null,
    candidateScope,
    thrillHint: isBalanceMode
      ? getThrillHint(thrillLevel)
      : isHotplaceMode
        ? 'Do not use fairness level in hotplace mode. Choose distinct commercial-area candidates by category fit and appeal.'
        : 'Do not use fairness level in house-front mode. Keep participant-local candidate counts balanced across members.',
    targetCount,
    participants: participants.map((participant) => ({
      name: participant?.name,
      gender: participant?.gender,
      location: participant?.location,
      maxTravelTime: participant?.maxTravelTime,
    })),
    candidates: insights.map((insight) => ({
      id: insight?.candidate?.id,
      name: insight?.candidate?.name,
      district: insight?.candidate?.district,
      metroArea: inferMetroArea(insight?.candidate),
      vibe: insight?.candidate?.vibe,
      bestFor: insight?.candidate?.bestFor,
      routeHint: insight?.candidate?.routeHint,
      tags: insight?.candidate?.tags,
      categories: insight?.candidate?.categories,
      categoryMatched: Boolean(insight?.categoryMatched),
      averageDuration: insight?.averageDuration,
      maxDuration: insight?.maxDuration,
      spreadDuration: insight?.spreadDuration,
      allReachable: insight?.allReachable,
      centerDistance: insight?.centerDistance,
      axisDistance: insight?.axisDistance,
      corridorDriftPenalty: Math.round(getInsightCorridorDriftPenalty(insight) * 10) / 10,
      fairnessTrap: isDetachedFairnessTrap(insight),
      nearestParticipantName: insight?.nearestParticipantName,
      nearestDuration: insight?.nearestDuration,
      farthestParticipantName: insight?.farthestParticipantName,
      farthestDuration: insight?.farthestDuration,
    })),
  };
}

export function getRuntimeAiConfig(body: any) {
  const runtimeAiConfig = body?.runtimeAiConfig;

  if (!runtimeAiConfig || typeof runtimeAiConfig !== 'object') {
    return null;
  }

  const provider =
    runtimeAiConfig.provider === 'gms' ||
    runtimeAiConfig.provider === 'upstage' ||
    runtimeAiConfig.provider === 'openai'
      ? runtimeAiConfig.provider
      : null;
  const apiKey =
    typeof runtimeAiConfig.apiKey === 'string' ? runtimeAiConfig.apiKey.trim() : '';
  const model =
    typeof runtimeAiConfig.model === 'string' ? runtimeAiConfig.model.trim() : '';
  const baseUrl =
    typeof runtimeAiConfig.baseUrl === 'string' ? runtimeAiConfig.baseUrl.trim() : '';

  if (!provider || !apiKey || !model || (provider === 'gms' && !baseUrl)) {
    return null;
  }

  return {
    provider,
    apiKey,
    model,
    baseUrl,
  };
}

export async function fetchOpenAiCandidateSelection({
  apiKey,
  model,
  participants,
  insights,
  selectedCategory,
  selectionMode,
  thrillLevel,
  candidateScope,
  requestedTargetCount,
}: {
  apiKey: string;
  model: string;
  participants: any[];
  insights: any[];
  selectedCategory: string;
  selectionMode: string;
  thrillLevel: number;
  candidateScope: string;
  requestedTargetCount?: number;
}) {
  const allowedIds = insights
    .map((insight) => insight?.candidate?.id)
    .filter((candidateId): candidateId is string => typeof candidateId === 'string' && candidateId.length > 0);
  const targetCount = pickTargetCount(
    allowedIds.length,
    selectionMode,
    thrillLevel,
    candidateScope,
    requestedTargetCount,
  );

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      input: [
        {
          role: 'system',
          content:
            'You are selecting meeting area candidates for a Seoul Capital Area meetup app covering Seoul, Gyeonggi, and Incheon. Return JSON only. Choose only from the allowed candidate ids and follow the selectionMode rules in the user payload. In balance mode only, the primary fairness metric is spreadDuration, the difference between the slowest and fastest participant travel times. Respect fairnessSpreadLimit in balance mode, but do not treat spreadDuration alone as fairness; avoid low-spread candidates where everyone travels far. In hotplace mode, do not apply fairness levels as a hard constraint. Prefer category fit, recognizable commercial-area appeal, venue density, and route practicality. In house-front/neighborhood mode, do not preserve a fair midpoint core by default. Build participant-local buckets evenly so one member does not receive all local picks. Every candidate must be an actual neighborhood/commercial-area name, not a broad city or district name.',
        },
        {
          role: 'user',
          content: JSON.stringify(
            buildSelectionPayload(
              participants,
              insights,
              selectedCategory,
              selectionMode,
              thrillLevel,
              candidateScope,
              targetCount,
            ),
          ),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'meeting_candidate_selection',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              candidate_ids: {
                type: 'array',
                minItems: targetCount,
                maxItems: targetCount,
                uniqueItems: true,
                items: {
                  type: 'string',
                  enum: allowedIds,
                },
              },
              summary: {
                type: 'string',
              },
            },
            required: ['candidate_ids', 'summary'],
          },
        },
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI candidate selection failed with status ${response.status}.`);
  }

  const outputText = extractResponseText(data);

  if (!outputText) {
    throw new Error('OpenAI candidate selection returned no structured output.');
  }

  const parsed = JSON.parse(outputText);

  return {
    candidateIds: Array.isArray(parsed?.candidate_ids)
      ? parsed.candidate_ids.filter((candidateId: unknown): candidateId is string => typeof candidateId === 'string')
      : [],
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
  };
}

export async function fetchUpstageCandidateSelection({
  apiKey,
  model,
  baseUrl,
  participants,
  insights,
  selectedCategory,
  selectionMode,
  thrillLevel,
  candidateScope,
  requestedTargetCount,
  providerLabel = 'Upstage',
}: {
  apiKey: string;
  model: string;
  baseUrl: string;
  participants: any[];
  insights: any[];
  selectedCategory: string;
  selectionMode: string;
  thrillLevel: number;
  candidateScope: string;
  requestedTargetCount?: number;
  providerLabel?: string;
}) {
  const allowedIds = insights
    .map((insight) => insight?.candidate?.id)
    .filter((candidateId): candidateId is string => typeof candidateId === 'string' && candidateId.length > 0);
  const targetCount = pickTargetCount(
    allowedIds.length,
    selectionMode,
    thrillLevel,
    candidateScope,
    requestedTargetCount,
  );
  const apiBase = baseUrl.replace(/\/$/, '');

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      response_format: {
        type: 'json_object',
      },
      messages: [
        {
          role: 'system',
          content:
            'Return a JSON object with keys candidate_ids and summary. candidate_ids must contain only allowed ids and match the requested targetCount. Follow the selectionMode rules in the user payload. In balance mode only, respect fairnessSpreadLimit and rank by spreadDuration together with averageDuration, farthestDuration, centerDistance, and axisDistance. Do not treat a low spreadDuration as fair if everyone is sent far away. In hotplace mode, do not apply fairness levels as a hard constraint; category fit, commercial-area appeal, venue density, and route practicality are primary. In house-front/neighborhood mode, do not preserve a fair midpoint core by default; balance the number of local picks across participants. Every candidate must be an actual neighborhood/commercial-area name, not a broad city or district name.',
        },
        {
          role: 'user',
          content: JSON.stringify(
            buildSelectionPayload(
              participants,
              insights,
              selectedCategory,
              selectionMode,
              thrillLevel,
              candidateScope,
              targetCount,
            ),
          ),
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `${providerLabel} candidate selection failed with status ${response.status}.`);
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  const content =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((item) => item?.text ?? '').join('\n')
        : '';

  if (!content.trim()) {
    throw new Error(`${providerLabel} candidate selection returned no content.`);
  }

  const parsed = JSON.parse(content);

  return {
    candidateIds: Array.isArray(parsed?.candidate_ids)
      ? parsed.candidate_ids.filter((candidateId: unknown): candidateId is string => typeof candidateId === 'string')
      : [],
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
  };
}
