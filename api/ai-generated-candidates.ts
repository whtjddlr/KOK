import {
  getRuntimeAiConfig,
  getServerAiProviders,
  json,
  readJsonBody,
} from './_lib/server.js';

type MeetCategoryKey = 'dining' | 'cafe' | 'drink' | 'date' | 'culture' | 'activity';
type SelectionModeKey = 'balance' | 'hotplace' | 'neighborhood';
type DrawMood = '안정 픽' | '반전 픽' | '무드 픽';

interface Coordinates {
  lat: number;
  lng: number;
}

interface Participant {
  name?: string;
  location?: string;
  coordinates?: Coordinates;
  maxTravelTime?: number;
  travelMode?: string;
  gender?: string;
}

interface GeneratedArea {
  name: string;
  searchQuery: string;
  tags: string[];
}

interface NaverLocalItem {
  title?: string;
  category?: string;
  description?: string;
  address?: string;
  roadAddress?: string;
  mapx?: string;
  mapy?: string;
}

interface VerifiedArea {
  proposal: GeneratedArea;
  item: NaverLocalItem;
  name: string;
  coordinates: Coordinates;
  score: number;
}

const CATEGORY_LABELS: Record<MeetCategoryKey, string> = {
  dining: '식사',
  cafe: '카페',
  drink: '술자리',
  date: '데이트',
  culture: '전시/문화',
  activity: '놀거리',
};

const MODE_LABELS: Record<SelectionModeKey, string> = {
  balance: '중간에서 만나',
  hotplace: '핫플에서 만나',
  neighborhood: '우리 집 앞까지 올래?',
};

const BROAD_AREA_NAMES = new Set([
  '서울',
  '서울시',
  '서울특별시',
  '경기',
  '경기도',
  '인천',
  '인천광역시',
  '수도권',
  '강남',
  '분당',
  '용인',
  '수원',
  '성남',
  '안양',
  '고양',
  '부천',
]);

const UNRELATED_AREA_KEYWORDS = [
  '아파트',
  '오피스텔',
  '빌라',
  '부동산',
  '주차장',
  '병원',
  '약국',
  '학교',
  '은행',
  'ATM',
  '공장',
  '회사',
  '센터',
];

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanHtmlText(value: unknown) {
  return normalizeText(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value: string) {
  return cleanHtmlText(value).replace(/\s+/g, '').toLowerCase();
}

function parseNaverLocalCoordinate(value?: string) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue / 10000000;
}

function isCapitalAreaCoordinate(coordinates: Coordinates) {
  return (
    coordinates.lat >= 36.6 &&
    coordinates.lat <= 38.4 &&
    coordinates.lng >= 126.1 &&
    coordinates.lng <= 128.0
  );
}

function normalizeAnchorName(name: string) {
  return cleanHtmlText(name)
    .replace(/\s+/g, '-')
    .replace(/[^0-9a-zA-Z가-힣-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function isBroadAreaName(name: string) {
  const compactName = compactText(name).replace(/역$/, '');

  if (BROAD_AREA_NAMES.has(compactName)) {
    return true;
  }

  return /[시군구]$/.test(compactName) && compactName.length <= 4;
}

function getAreaText(item: NaverLocalItem) {
  return [
    cleanHtmlText(item.title),
    cleanHtmlText(item.category),
    cleanHtmlText(item.description),
    cleanHtmlText(item.address),
    cleanHtmlText(item.roadAddress),
  ]
    .filter(Boolean)
    .join(' ');
}

function includesAny(text: string, keywords: string[]) {
  const lowerText = text.toLowerCase();

  return keywords.some((keyword) => {
    const lowerKeyword = keyword.toLowerCase();
    return text.includes(keyword) || lowerText.includes(lowerKeyword);
  });
}

function getVerifiedAreaScore(proposal: GeneratedArea, item: NaverLocalItem) {
  const name = cleanHtmlText(proposal.name);
  const query = cleanHtmlText(proposal.searchQuery);
  const title = cleanHtmlText(item.title);
  const category = cleanHtmlText(item.category);
  const address = cleanHtmlText(item.address);
  const roadAddress = cleanHtmlText(item.roadAddress);
  const compactName = compactText(name);
  const compactQuery = compactText(query);
  const compactTitle = compactText(title);
  const compactAddress = compactText(`${address} ${roadAddress}`);
  const text = getAreaText(item);
  let score = 0;

  if (!name || isBroadAreaName(name)) {
    return -1000;
  }

  if (compactTitle === compactName || compactTitle === compactQuery) {
    score += 90;
  }

  if (compactTitle.includes(compactName) || compactName.includes(compactTitle)) {
    score += 56;
  }

  if (compactAddress.includes(compactName.replace(/역$/, ''))) {
    score += 24;
  }

  if (name.endsWith('역') || title.endsWith('역')) {
    score += 14;
  }

  if (category.includes('지하철') || category.includes('철도') || category.includes('역')) {
    score += 18;
  }

  if (category.includes('관광') || category.includes('지역') || category.includes('거리')) {
    score += 8;
  }

  if (includesAny(text, UNRELATED_AREA_KEYWORDS)) {
    score -= 70;
  }

  return score;
}

async function fetchNaverLocalItems(input: {
  query: string;
  clientId: string;
  clientSecret: string;
}) {
  const upstreamUrl = new URL('https://openapi.naver.com/v1/search/local.json');
  upstreamUrl.searchParams.set('query', input.query);
  upstreamUrl.searchParams.set('display', '5');
  upstreamUrl.searchParams.set('start', '1');
  upstreamUrl.searchParams.set('sort', 'comment');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2800);

  try {
    const response = await fetch(upstreamUrl.toString(), {
      headers: {
        'X-Naver-Client-Id': input.clientId,
        'X-Naver-Client-Secret': input.clientSecret,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyGeneratedArea(input: {
  proposal: GeneratedArea;
  clientId: string;
  clientSecret: string;
}) {
  const queries = [
    input.proposal.searchQuery,
    input.proposal.name,
    `${input.proposal.name}역`,
  ]
    .map(cleanHtmlText)
    .filter(Boolean);
  const uniqueQueries = [...new Set(queries)].slice(0, 2);
  const results = (
    await Promise.all(
      uniqueQueries.map((query) =>
        fetchNaverLocalItems({
          query,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
        }),
      ),
    )
  ).flat();

  const verified = results
    .map((item): VerifiedArea | null => {
      const lng = parseNaverLocalCoordinate(item?.mapx);
      const lat = parseNaverLocalCoordinate(item?.mapy);

      if (lat === null || lng === null) {
        return null;
      }

      const coordinates = { lat, lng };

      if (!isCapitalAreaCoordinate(coordinates)) {
        return null;
      }

      const score = getVerifiedAreaScore(input.proposal, item);

      if (score < 20) {
        return null;
      }

      return {
        proposal: input.proposal,
        item,
        name: cleanHtmlText(input.proposal.name) || cleanHtmlText(item.title),
        coordinates,
        score,
      };
    })
    .filter((item): item is VerifiedArea => Boolean(item))
    .sort((left, right) => right.score - left.score);

  return verified[0] ?? null;
}

function getOpenAiResponseText(data: any) {
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

function getNormalizedGeneratedAreas(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();

  return value
    .map((item: any) => {
      const name = cleanHtmlText(item?.name);
      const searchQuery = cleanHtmlText(item?.search_query ?? item?.searchQuery ?? name);
      const tags = Array.isArray(item?.tags)
        ? item.tags.map(cleanHtmlText).filter(Boolean).slice(0, 4)
        : [];

      return {
        name,
        searchQuery,
        tags,
      };
    })
    .filter((item) => item.name && item.searchQuery && !isBroadAreaName(item.name))
    .filter((item) => {
      const key = compactText(item.name);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 14);
}

function buildGenerationPayload(input: {
  participants: Participant[];
  selectedCategory: MeetCategoryKey;
  selectionMode: SelectionModeKey;
  thrillLevel: number;
  targetCount: number;
}) {
  return {
    app: 'KoK',
    region: 'Seoul Capital Area',
    selectedCategory: input.selectedCategory,
    selectedCategoryLabel: CATEGORY_LABELS[input.selectedCategory],
    selectionMode: input.selectionMode,
    selectionModeLabel: MODE_LABELS[input.selectionMode],
    thrillLevel: input.thrillLevel,
    targetCount: input.targetCount,
    participants: input.participants.map((participant, index) => ({
      id: index + 1,
      name: normalizeText(participant.name) || `참여자 ${index + 1}`,
      location: normalizeText(participant.location),
      coordinates: participant.coordinates,
      maxTravelTime: participant.maxTravelTime,
      travelMode: participant.travelMode ?? 'transit',
      gender: participant.gender ?? 'unspecified',
    })),
    rules: [
      'Return only actual station names, neighborhood names, or commercial-area names in Seoul/Gyeonggi/Incheon.',
      'Do not return broad city, district, or province names.',
      'Do not return individual restaurants, cafes, stores, malls, hotels, hospitals, apartments, or parking lots.',
      'The app will verify each suggestion with NAVER Local Search and then run route-time fairness checks.',
      'In balance mode, propose practical midpoint/corridor areas first. Avoid areas that look fair only because everyone travels far.',
      'In hotplace mode, category density and recognizable appeal can matter more than time equality.',
      'In neighborhood mode, include participant-side living areas evenly instead of favoring one person.',
      ...(input.selectedCategory === 'date'
        ? [
            'For date category, prefer areas with a walkable mix of restaurants, wine bars, dessert cafes, exhibitions, galleries, parks, or scenic streets.',
            'Avoid areas that are mainly transfer stations, office blocks, fast-food corridors, malls, or chain-cafe clusters unless they also have clear date-course density.',
          ]
        : []),
    ],
  };
}

async function fetchOpenAiGeneratedAreas(input: {
  apiKey: string;
  model: string;
  payload: ReturnType<typeof buildGenerationPayload>;
}) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.5,
      input: [
        {
          role: 'system',
          content:
            'You generate candidate meetup areas for a Korean app. Return JSON only. Generate concise area/station candidates, not individual venues. The suggestions must be verifiable through NAVER Local Search and useful before travel-time validation.',
        },
        {
          role: 'user',
          content: JSON.stringify(input.payload),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'generated_meeting_areas',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              candidate_areas: {
                type: 'array',
                minItems: input.payload.targetCount,
                maxItems: input.payload.targetCount,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: {
                      type: 'string',
                    },
                    search_query: {
                      type: 'string',
                    },
                    tags: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 4,
                      items: {
                        type: 'string',
                      },
                    },
                  },
                  required: ['name', 'search_query', 'tags'],
                },
              },
            },
            required: ['candidate_areas'],
          },
        },
      },
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI candidate generation failed with status ${response.status}.`);
  }

  return getNormalizedGeneratedAreas(JSON.parse(getOpenAiResponseText(data))?.candidate_areas);
}

async function fetchUpstageGeneratedAreas(input: {
  apiKey: string;
  model: string;
  baseUrl: string;
  payload: ReturnType<typeof buildGenerationPayload>;
  providerLabel?: string;
}) {
  const apiBase = input.baseUrl.replace(/\/$/, '');
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.5,
      response_format: {
        type: 'json_object',
      },
      messages: [
        {
          role: 'system',
          content:
            'Return a JSON object with key candidate_areas. candidate_areas must be an array of objects with name, search_query, and tags. Generate concise Seoul/Gyeonggi/Incheon meetup area or station candidates, not individual venues, broad cities, or districts.',
        },
        {
          role: 'user',
          content: JSON.stringify(input.payload),
        },
      ],
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ??
        `${input.providerLabel ?? 'Upstage'} candidate generation failed with status ${response.status}.`,
    );
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  const content =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((item) => item?.text ?? '').join('\n')
        : '';

  return getNormalizedGeneratedAreas(JSON.parse(content)?.candidate_areas);
}

function getCandidateCategories(selectedCategory: MeetCategoryKey) {
  const extras: MeetCategoryKey[] =
    selectedCategory === 'date'
      ? ['dining', 'cafe', 'culture']
      : selectedCategory === 'drink'
        ? ['dining', 'cafe']
        : ['dining', 'cafe', 'drink'];

  return [...new Set<MeetCategoryKey>([selectedCategory, ...extras])];
}

function getDrawMood(selectionMode: SelectionModeKey): DrawMood {
  if (selectionMode === 'hotplace') {
    return '무드 픽';
  }

  if (selectionMode === 'neighborhood') {
    return '반전 픽';
  }

  return '안정 픽';
}

function buildCandidate(input: {
  verifiedArea: VerifiedArea;
  selectedCategory: MeetCategoryKey;
  selectionMode: SelectionModeKey;
  index: number;
}) {
  const name = input.verifiedArea.name;
  const searchTitle = cleanHtmlText(input.verifiedArea.item.title);
  const district =
    cleanHtmlText(input.verifiedArea.item.roadAddress)
      .split(/\s+/)
      .slice(0, 2)
      .join(' ') ||
    cleanHtmlText(input.verifiedArea.item.address)
      .split(/\s+/)
      .slice(0, 2)
      .join(' ') ||
    '지도 검증 후보';
  const stableName = normalizeAnchorName(name || searchTitle || `candidate-${input.index}`);

  return {
    id: `ai-generated-${stableName}-${input.index}`,
    name,
    district,
    description: 'AI가 제안하고 네이버 지도 검색으로 좌표를 확인한 후보예요.',
    vibe: `${CATEGORY_LABELS[input.selectedCategory]}와 어울리는 ${MODE_LABELS[input.selectionMode]} 후보`,
    coordinates: input.verifiedArea.coordinates,
    tags: [...new Set(['AI생성', '지도검증', ...input.verifiedArea.proposal.tags])].slice(0, 5),
    bestFor: `${CATEGORY_LABELS[input.selectedCategory]} 약속 후보로 비교하기`,
    whyItWorks: '지도에서 실제 위치를 확인한 뒤 기존 이동시간 검증에 함께 넣는 후보예요.',
    routeHint: `${name} 주변에서 실제 이동시간과 주변 정보를 다시 확인해 보세요.`,
    drawMood: getDrawMood(input.selectionMode),
    categories: getCandidateCategories(input.selectedCategory),
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    json(res, 405, { message: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const participants = Array.isArray(body?.participants) ? body.participants : [];
    const selectedCategory =
      typeof body?.selectedCategory === 'string' ? body.selectedCategory : 'dining';
    const selectionMode =
      typeof body?.selectionMode === 'string' ? body.selectionMode : 'balance';
    const thrillLevel =
      typeof body?.thrillLevel === 'number' ? body.thrillLevel : 1;
    const candidateTargetCount =
      typeof body?.candidateTargetCount === 'number' && Number.isFinite(body.candidateTargetCount)
        ? body.candidateTargetCount
        : 6;
    const normalizedCategory = ['dining', 'cafe', 'drink', 'date', 'culture', 'activity'].includes(
      selectedCategory,
    )
      ? (selectedCategory as MeetCategoryKey)
      : 'dining';
    const normalizedMode = ['balance', 'hotplace', 'neighborhood'].includes(selectionMode)
      ? (selectionMode as SelectionModeKey)
      : 'balance';
    const validParticipants = participants.filter(
      (participant: Participant) =>
        typeof participant?.coordinates?.lat === 'number' &&
        typeof participant?.coordinates?.lng === 'number',
    );

    if (validParticipants.length < 2) {
      json(res, 200, {
        candidates: [],
        source: 'empty',
        message: 'AI 후보 생성을 위해 참여자 2명 이상이 필요해요.',
      });
      return;
    }

    const env = process.env;
    const naverSearchClientId = env.NAVER_SEARCH_CLIENT_ID?.trim() ?? '';
    const naverSearchClientSecret = env.NAVER_SEARCH_CLIENT_SECRET?.trim() ?? '';

    if (!naverSearchClientId || !naverSearchClientSecret) {
      json(res, 200, {
        candidates: [],
        source: 'disabled',
        message: '네이버 검색 키가 없어 AI 후보를 지도에서 검증하지 못했어요.',
      });
      return;
    }

    const runtimeAiConfig = getRuntimeAiConfig(body);
    const aiProviders = getServerAiProviders(env, runtimeAiConfig);

    if (!aiProviders.length) {
      json(res, 200, {
        candidates: [],
        source: 'disabled',
        message: 'AI 키가 없어 생성 후보 없이 기본 후보를 사용했어요.',
      });
      return;
    }

    const generationTargetCount = Math.max(8, Math.min(14, candidateTargetCount + 6));
    const payload = buildGenerationPayload({
      participants: validParticipants,
      selectedCategory: normalizedCategory,
      selectionMode: normalizedMode,
      thrillLevel,
      targetCount: generationTargetCount,
    });
    let generatedAreas: GeneratedArea[] | null = null;
    let generationSource = '';
    let lastAiError: unknown = null;

    for (const aiProvider of aiProviders) {
      try {
        generatedAreas =
          aiProvider.provider === 'openai'
            ? await fetchOpenAiGeneratedAreas({
                apiKey: aiProvider.apiKey,
                model: aiProvider.model,
                payload,
              })
            : await fetchUpstageGeneratedAreas({
                apiKey: aiProvider.apiKey,
                model: aiProvider.model,
                baseUrl: aiProvider.baseUrl,
                payload,
                providerLabel: aiProvider.provider === 'gms' ? 'GMS AI' : 'Upstage',
              });
        generationSource = aiProvider.provider;
        break;
      } catch (error) {
        lastAiError = error;
      }
    }

    if (!generatedAreas) {
      json(res, 200, {
        candidates: [],
        source: 'fallback',
        message:
          lastAiError instanceof Error
            ? `AI 후보 생성 실패: ${lastAiError.message}`
            : 'AI 후보 생성에 실패해 기본 후보를 사용했어요.',
      });
      return;
    }
    const verifiedAreas = (
      await Promise.all(
        generatedAreas.map((proposal) =>
          verifyGeneratedArea({
            proposal,
            clientId: naverSearchClientId,
            clientSecret: naverSearchClientSecret,
          }),
        ),
      )
    )
      .filter((item): item is VerifiedArea => Boolean(item))
      .sort((left, right) => right.score - left.score);
    const seenCoordinates = new Set<string>();
    const candidates = verifiedAreas
      .filter((area) => {
        const coordinateKey = `${area.coordinates.lat.toFixed(3)}:${area.coordinates.lng.toFixed(3)}`;

        if (seenCoordinates.has(coordinateKey)) {
          return false;
        }

        seenCoordinates.add(coordinateKey);
        return true;
      })
      .slice(0, Math.max(3, Math.min(8, candidateTargetCount + 2)))
      .map((verifiedArea, index) =>
        buildCandidate({
          verifiedArea,
          selectedCategory: normalizedCategory,
          selectionMode: normalizedMode,
          index,
        }),
      );

    json(res, 200, {
      candidates,
      source: generationSource,
      message: candidates.length
        ? 'AI 생성 후보를 네이버 지도 검색으로 검증했어요.'
        : 'AI가 만든 후보가 지도 검증을 통과하지 못해 기본 후보를 사용했어요.',
    });
  } catch (error) {
    json(res, 200, {
      candidates: [],
      source: 'fallback',
      message:
        error instanceof Error
          ? `AI 후보 생성 실패: ${error.message}`
          : 'AI 후보 생성에 실패해 기본 후보를 사용했어요.',
    });
  }
}
