type EnvMap = Record<string, string | undefined>;

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

function getCandidateScopeBonus(candidateScope: string) {
  if (candidateScope === 'max') {
    return 4;
  }

  if (candidateScope === 'wide') {
    return 2;
  }

  return 0;
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

  const baseCount = selectionMode === 'neighborhood' ? 7 : 6;
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

  return orderedIds.slice(
    0,
    pickTargetCount(orderedIds.length, selectionMode, thrillLevel, candidateScope, requestedTargetCount),
  );
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

  return {
    selectionGoal:
      'Select meetup area candidates across the Seoul Capital Area (Seoul, Gyeonggi, Incheon) near the middle of the group so everyone can reach them as fairly as possible.',
    granularityRule:
      '수도권 약속 장소 후보를 고를 때는 시/구 단위가 아니라 실제 사람들이 약속을 잡는 동네/상권 단위로만 반환해라. 예: 수원 -> 수원역, 행궁동, 인계동. 예: 인천 -> 부평 문화의거리, 구월 로데오, 송도 센트럴파크. 예: 부천 -> 부천역, 상동, 중동. 너무 넓은 지역명(예: 부천, 수원, 인천, 성남)만 단독으로 반환하지 마라. 모든 후보는 네이버 지역 검색으로 바로 검색 가능한 이름이어야 한다.',
    rangeRule:
      '참여자 위치가 서로 가까우면 검색 범위를 넓히지 말고, 가까운 생활권 안의 구체적인 동네/상권 후보만 고른다. 후보가 부족하면 억지로 먼 유명 상권을 섞지 말고 제공된 가까운 후보 안에서만 선택한다.',
    fairnessRule:
      '공정 모드에서는 centerDistance, axisDistance, spreadDuration, farthestDuration이 낮은 중간 후보를 최우선으로 고르되, 전체 후보 목록에는 각 참여자 근처 생활권 대표 후보도 비교용으로 일부 포함해라. 즉 중간 후보 코어 + 사람별 로컬 앵커가 함께 있어야 하며, 한 사람 근처 후보만 몰아주면 안 된다.',
    localModeRule:
      isHouseFrontMode
        ? 'House-front mode is intentionally extreme: keep some fair midpoint candidates, but every participant must have at least one explicit local wildcard candidate in the final ids. Prefer exactly one thrill-hyper id per participant first, then use thrill-local or participant-near only as fallback. Do not give two house-front picks to one participant while another participant has none.'
        : isNearOnePersonMode
          ? 'Near-one-person mode: keep the fair midpoint core, but include participant-near or thrill-local commercial areas across participants as evenly as possible. Do not use thrill-hyper unless it is level 5.'
        : thrillLevel >= 3
          ? 'Do not replace the balanced core with only local picks. Add local wildcard areas on top of the fair midpoint core.'
        : 'Return only balanced midpoint recommendations.',
    candidateMixRule:
      isHouseFrontMode
        ? 'Classify the final set mentally as fair midpoint / participant-near neighborhood / house-front wildcard. The house-front wildcard bucket must be participant-fair: one local extreme anchor for each participant before adding extra picks.'
        : isNearOnePersonMode
          ? 'Classify the final set mentally as fair midpoint / participant-near neighborhood. Include a few one-person-near picks, but keep exact house-front picks out.'
        : 'Keep candidate selection centered on fair and realistic meetup areas.',
    selectedCategory,
    selectionMode,
    thrillLevel,
    candidateScope,
    thrillHint: getThrillHint(thrillLevel),
    targetCount,
    participants: participants.map((participant) => ({
      name: participant?.name,
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
      averageDuration: insight?.averageDuration,
      maxDuration: insight?.maxDuration,
      spreadDuration: insight?.spreadDuration,
      allReachable: insight?.allReachable,
      centerDistance: insight?.centerDistance,
      axisDistance: insight?.axisDistance,
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
    runtimeAiConfig.provider === 'upstage' || runtimeAiConfig.provider === 'openai'
      ? runtimeAiConfig.provider
      : null;
  const apiKey =
    typeof runtimeAiConfig.apiKey === 'string' ? runtimeAiConfig.apiKey.trim() : '';
  const model =
    typeof runtimeAiConfig.model === 'string' ? runtimeAiConfig.model.trim() : '';
  const baseUrl =
    typeof runtimeAiConfig.baseUrl === 'string' ? runtimeAiConfig.baseUrl.trim() : '';

  if (!provider || !apiKey || !model) {
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
            'You are selecting meeting area candidates for a Seoul Capital Area meetup app covering Seoul, Gyeonggi, and Incheon. Return JSON only. Choose only from the allowed candidate ids. Keep a fair midpoint core for the whole group, avoid over-favoring central Seoul by default, and include a small comparison anchor near each participant when enough candidates are requested. In balance mode, prioritize low centerDistance, low axisDistance, low spreadDuration, and low farthestDuration, but do not let every visible candidate be far from the same participant. In neighborhood thrill level 4, include participant-near or thrill-local candidates around one person. In neighborhood thrill level 5 house-front mode, every participant must get one explicit local extreme anchor: prefer one thrill-hyper id per participant, then use thrill-local or participant-near only as fallback. Do not give multiple house-front picks to one participant while another participant has none. If participants are close to each other, narrow the search to their nearby commercial areas and do not force distant famous hubs just to fill the count. Favor fairness across participants, travel plausibility, regional balance, and category fit. Candidates must be actual neighborhood/commercial-area names, not broad city/district names. Do not select broad names alone such as 부천, 수원, 인천, or 성남 when a more specific 상권/동네 candidate exists. Prefer Naver-searchable names like 수원역, 행궁동, 인계동, 부평 문화의거리, 구월 로데오, 송도 센트럴파크, 부천역, 상동, 중동.',
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
            'Return a JSON object with keys candidate_ids and summary. candidate_ids must contain only allowed ids and match the requested targetCount. This is for the Seoul Capital Area including Seoul, Gyeonggi, and Incheon. Always preserve balanced midpoint recommendations, avoid defaulting to central Seoul only, and include a small comparison anchor near each participant when enough candidates are requested. In balance mode, prioritize low centerDistance, low axisDistance, low spreadDuration, and low farthestDuration. In neighborhood thrill level 4, include participant-near or thrill-local candidates around one person. In neighborhood thrill level 5 house-front mode, every participant must get one explicit local extreme anchor: prefer one thrill-hyper id per participant, then use thrill-local or participant-near only as fallback. Do not give multiple house-front picks to one participant while another participant has none. If participants are close to each other, narrow the search to their nearby commercial areas and do not force distant famous hubs just to fill the count. Candidates must be actual neighborhood/commercial-area names, not broad city/district names. Do not select broad names alone such as 부천, 수원, 인천, or 성남 when a more specific 상권/동네 candidate exists. Prefer Naver-searchable names like 수원역, 행궁동, 인계동, 부평 문화의거리, 구월 로데오, 송도 센트럴파크, 부천역, 상동, 중동.',
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
    throw new Error(data?.error?.message ?? `Upstage candidate selection failed with status ${response.status}.`);
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  const content =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((item) => item?.text ?? '').join('\n')
        : '';

  if (!content.trim()) {
    throw new Error('Upstage candidate selection returned no content.');
  }

  const parsed = JSON.parse(content);

  return {
    candidateIds: Array.isArray(parsed?.candidate_ids)
      ? parsed.candidate_ids.filter((candidateId: unknown): candidateId is string => typeof candidateId === 'string')
      : [],
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
  };
}
