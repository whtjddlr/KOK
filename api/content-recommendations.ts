import {
  getRuntimeAiConfig,
  getServerAiProviders,
  json,
  readJsonBody,
} from './_lib/server.js';

interface PlaceCandidate {
  id: string;
  name: string;
  description?: string;
  categoryPath?: string;
  address?: string;
  roadAddress?: string;
  reviewEvidence?: PlaceReviewEvidence[];
}

interface PlaceReviewEvidence {
  title: string;
  snippet: string;
  source: string;
  link: string;
  postdate: string;
}

const genericChainKeywords = [
  '롯데리아',
  '맥도날드',
  '버거킹',
  'KFC',
  '맘스터치',
  '써브웨이',
  '노브랜드버거',
  '프랭크버거',
  '이디야',
  '메가커피',
  '빽다방',
  '컴포즈커피',
  '스타벅스',
  '투썸',
  '할리스',
  '커피빈',
  '엔제리너스',
  '탐앤탐스',
  '파스쿠찌',
  '폴바셋',
  '공차',
  '설빙',
  '던킨',
  '배스킨',
  '파리바게뜨',
  '뚜레쥬르',
  '한솥',
  '김밥천국',
  'CU',
  'GS25',
  '세븐일레븐',
  '이마트24',
  '다이소',
  '올리브영',
];

const fastFoodKeywords = [
  '롯데리아',
  '맥도날드',
  '버거킹',
  'KFC',
  '맘스터치',
  '써브웨이',
  '노브랜드버거',
  '프랭크버거',
  '패스트푸드',
  '푸드코트',
];

const unrelatedKeywords = [
  '마트',
  '편의점',
  '약국',
  '병원',
  '부동산',
  '주차장',
  '호텔',
  '모텔',
  '은행',
  'ATM',
  '학원',
  '공인중개사',
];

const datePositiveKeywords = [
  '레스토랑',
  '다이닝',
  '비스트로',
  '와인',
  '와인바',
  '칵테일',
  '루프탑',
  '오마카세',
  '파스타',
  '스테이크',
  '브런치',
  '이탈리안',
  '프렌치',
  '스페인',
  '타파스',
  '코스',
  '예약',
  '분위기',
  '감성',
  '뷰',
  '한강',
  '디저트',
  '베이커리',
  '케이크',
  '젤라또',
  '전시',
  '갤러리',
  '미술관',
  '공방',
  '복합문화',
  '소품샵',
  '산책',
];

const datePremiumKeywords = [
  '와인',
  '오마카세',
  '다이닝',
  '비스트로',
  '코스',
  '루프탑',
  '뷰',
  '전시',
  '갤러리',
  '브런치',
  '디저트',
];

const dateHardDenyKeywords = ['PC방', '노래방', '스터디카페', '기사식당', '푸드코트'];

const dateWeakDenyKeywords = [
  '분식',
  '김밥',
  '국밥',
  '해장국',
  '순대',
  '무한리필',
  '뷔페',
  '도시락',
  '떡볶이',
];

const gameActivityKeywords = [
  'PC방',
  '피시방',
  '보드게임',
  '당구',
  '볼링',
  '오락실',
  '게임',
  '플스',
  '스크린야구',
  '스크린골프',
  '다트',
];

const categoryHints: Record<string, string[]> = {
  restaurant: ['음식점', '한식', '일식', '양식', '중식', '고기', '구이', '회', '초밥', '파스타', '브런치', '레스토랑', '다이닝', '분식', '국수', '돈가스', '카레', '쌀국수', '샤브', '갈비', '곱창', '족발', '보쌈', '해물', '찜', '탕'],
  cafe: ['카페', '디저트', '베이커리', '커피', '브런치'],
  drink: ['술집', '바', '이자카야', '와인', '맥주', '포차', '칵테일', '펍', '호프'],
  culture: ['전시', '공연', '문화', '갤러리', '소품샵', '서점', '공방', '미술관', '박물관', '산책', '공원'],
  activity: [
    '방탈출',
    '보드게임',
    '볼링',
    '오락',
    '영화',
    '놀거리',
    '공원',
    '체험',
    '전시',
    '공방',
    '갤러리',
    '소품샵',
    '산책',
    '문화',
    '복합문화',
    'PC방',
    '피시방',
    '당구',
    '게임',
    '플스',
    '스크린야구',
    '스크린골프',
    '다트',
  ],
};

const categoryDenyHints: Record<string, string[]> = {
  restaurant: ['카페', '디저트', '커피', '베이커리'],
  drink: ['카페', '디저트', '베이커리', '패스트푸드'],
  culture: ['편의점', '마트', '약국', '음식점'],
  activity: ['편의점', '마트', '약국'],
};

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

function getAllowedIds(items: PlaceCandidate[]) {
  return items
    .map((item) => normalizeText(item.id))
    .filter((id): id is string => id.length > 0);
}

function getPlaceText(item: PlaceCandidate) {
  return [
    item.name,
    item.description,
    item.categoryPath,
    item.address,
    item.roadAddress,
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

function getCategoryKey(category: string, meetCategory = '') {
  if (category === 'landmark') {
    return 'culture';
  }

  if (category === 'dining' || meetCategory === 'dining') {
    return category === 'cafe' || category === 'drink' ? category : 'restaurant';
  }

  if (meetCategory === 'date') {
    return ['cafe', 'drink', 'culture', 'activity'].includes(category) ? category : 'restaurant';
  }

  return category || meetCategory || 'restaurant';
}

function isDateContext(meetCategory = '', detailQuery = '') {
  return (
    meetCategory === 'date' ||
    detailQuery.includes('데이트') ||
    detailQuery.includes('분위기') ||
    detailQuery.includes('감성')
  );
}

function getGroupGenderCounts(groupGenderContext = '') {
  const female = Number(groupGenderContext.match(/여성\s*(\d+)명/)?.[1] ?? 0);
  const male = Number(groupGenderContext.match(/남성\s*(\d+)명/)?.[1] ?? 0);
  const total = Number(groupGenderContext.match(/총\s*(\d+)명/)?.[1] ?? female + male);

  return { female, male, total };
}

function isMaleLeaningGroup(groupGenderContext = '') {
  if (!groupGenderContext) {
    return false;
  }

  if (groupGenderContext.includes('남성 중심')) {
    return true;
  }

  const { female, male, total } = getGroupGenderCounts(groupGenderContext);
  const knownBinaryTotal = female + male;
  const denominator = knownBinaryTotal || total;

  return male >= 2 && denominator > 0 && male / denominator >= 0.6;
}

function hasGameActivityIntent(categoryKey: string, detailQuery: string, meetCategory = '') {
  return (
    categoryKey === 'activity' ||
    meetCategory === 'activity' ||
    includesAny(detailQuery, gameActivityKeywords)
  );
}

function isGenericChainPlace(item: PlaceCandidate) {
  return includesAny(getPlaceText(item), genericChainKeywords);
}

function isFastFoodPlace(item: PlaceCandidate) {
  return includesAny(getPlaceText(item), fastFoodKeywords);
}

function isUnrelatedPlace(item: PlaceCandidate) {
  return includesAny(getPlaceText(item), unrelatedKeywords);
}

function isDateHardMismatch(item: PlaceCandidate, meetCategory = '', detailQuery = '') {
  if (!isDateContext(meetCategory, detailQuery)) {
    return false;
  }

  const text = getPlaceText(item);

  return isFastFoodPlace(item) || includesAny(text, unrelatedKeywords) || includesAny(text, dateHardDenyKeywords);
}

function isCategoryMismatch(item: PlaceCandidate, category: string, detailQuery: string, meetCategory: string) {
  const categoryKey = getCategoryKey(category, meetCategory);
  const text = getPlaceText(item);
  const allowHints = categoryHints[categoryKey] ?? [];
  const denyHints = categoryDenyHints[categoryKey] ?? [];
  const hasAllowedSignal = includesAny(text, allowHints);
  const hasDeniedSignal = includesAny(text, denyHints);
  const detailAllowsCafe =
    detailQuery.includes('브런치') || detailQuery.includes('카페') || categoryKey === 'cafe';

  if (categoryKey === 'restaurant' && hasDeniedSignal && !detailAllowsCafe && !hasAllowedSignal) {
    return true;
  }

  if (categoryKey === 'drink' && hasDeniedSignal && !hasAllowedSignal) {
    return true;
  }

  if (
    ['restaurant', 'cafe', 'drink', 'culture', 'activity'].includes(categoryKey) &&
    !hasAllowedSignal
  ) {
    return true;
  }

  return false;
}

function getDateSuitabilityScore(
  item: PlaceCandidate,
  categoryKey: string,
  meetCategory: string,
  detailQuery: string,
) {
  if (!isDateContext(meetCategory, detailQuery)) {
    return 0;
  }

  const text = getPlaceText(item);
  const positiveHitCount = datePositiveKeywords.filter((keyword) => includesAny(text, [keyword])).length;
  let score = 0;

  if (positiveHitCount > 0) {
    score += 24 + Math.min(18, positiveHitCount * 3);
  } else if (categoryKey === 'restaurant' || categoryKey === 'cafe') {
    score -= 18;
  }

  if (includesAny(text, datePremiumKeywords)) {
    score += 14;
  }

  if (categoryKey === 'restaurant' && includesAny(text, ['양식', '이탈리안', '파스타', '스테이크', '브런치', '와인'])) {
    score += 10;
  }

  if (categoryKey === 'cafe' && includesAny(text, ['디저트', '베이커리', '케이크', '젤라또', '감성', '뷰'])) {
    score += 10;
  }

  if (isFastFoodPlace(item)) {
    score -= 130;
  }

  if (includesAny(text, dateWeakDenyKeywords)) {
    score -= 42;
  }

  if (isGenericChainPlace(item)) {
    score -= 28;
  }

  return score;
}

function getGroupActivitySuitabilityScore(
  item: PlaceCandidate,
  categoryKey: string,
  meetCategory: string,
  detailQuery: string,
  groupGenderContext = '',
) {
  if (isDateContext(meetCategory, detailQuery)) {
    return 0;
  }

  const text = getPlaceText(item);
  const hasGameSignal = includesAny(text, gameActivityKeywords);

  if (!hasGameSignal || !hasGameActivityIntent(categoryKey, detailQuery, meetCategory)) {
    return 0;
  }

  let score = 8;

  if (includesAny(detailQuery, gameActivityKeywords)) {
    score += 24;
  }

  if (isMaleLeaningGroup(groupGenderContext)) {
    score += 22;
  }

  return score;
}

function getHeuristicScore(
  item: PlaceCandidate,
  category: string,
  detailQuery: string,
  meetCategory: string,
  groupGenderContext = '',
) {
  const text = getPlaceText(item);
  const lowerText = text.toLowerCase();
  const normalizedDetail = detailQuery.trim().toLowerCase();
  const categoryKey = getCategoryKey(category, meetCategory);
  const hints = categoryHints[categoryKey] ?? [];
  let score = 0;

  hints.forEach((hint) => {
    if (text.includes(hint)) {
      score += 12;
    }
  });

  if (normalizedDetail && lowerText.includes(normalizedDetail)) {
    score += 8;
  }

  if (text.includes('맛집') || text.includes('핫플') || text.includes('분위기')) {
    score += 5;
  }

  if (text.includes('예약') || text.includes('레스토랑') || text.includes('다이닝')) {
    score += 3;
  }

  score += getDateSuitabilityScore(item, categoryKey, meetCategory, detailQuery);
  score += getGroupActivitySuitabilityScore(
    item,
    categoryKey,
    meetCategory,
    detailQuery,
    groupGenderContext,
  );

  if (isGenericChainPlace(item)) {
    score -= meetCategory === 'date' || detailQuery.includes('데이트') || detailQuery.includes('분위기')
      ? 70
      : 48;
  }

  if (isCategoryMismatch(item, category, detailQuery, meetCategory)) {
    score -= 64;
  }

  if (isUnrelatedPlace(item)) {
    score -= 90;
  }

  return score;
}

function getPreferredItems(
  items: PlaceCandidate[],
  category: string,
  detailQuery: string,
  meetCategory: string,
  groupGenderContext = '',
) {
  const scoredItems = items
    .map((item, index) => ({
      item,
      index,
      score: getHeuristicScore(item, category, detailQuery, meetCategory, groupGenderContext),
      chain: isGenericChainPlace(item),
      mismatch: isCategoryMismatch(item, category, detailQuery, meetCategory),
      dateHardMismatch: isDateHardMismatch(item, meetCategory, detailQuery),
      unrelated: isUnrelatedPlace(item),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    });
  const viableItems = scoredItems.filter(
    (entry) => !entry.mismatch && !entry.unrelated && !entry.dateHardMismatch,
  );
  const independentItems = viableItems.filter((entry) => !entry.chain);
  const primaryItems =
    independentItems.length >= Math.min(5, items.length)
      ? [
          ...independentItems,
          ...viableItems.filter((entry) => entry.chain),
        ]
      : viableItems;

  return primaryItems.map((entry) => entry.item);
}

function buildFallbackIds(
  items: PlaceCandidate[],
  category: string,
  detailQuery: string,
  meetCategory: string,
  groupGenderContext: string,
  limit: number,
) {
  return [...items]
    .sort(
      (left, right) =>
        getHeuristicScore(right, category, detailQuery, meetCategory, groupGenderContext) -
        getHeuristicScore(left, category, detailQuery, meetCategory, groupGenderContext),
    )
    .map((item) => item.id)
    .filter(Boolean)
    .slice(0, limit);
}

async function fetchPlaceReviewEvidence(input: {
  item: PlaceCandidate;
  candidateName: string;
  detailQuery: string;
  clientId: string;
  clientSecret: string;
}) {
  if (!input.clientId || !input.clientSecret || !input.item.name) {
    return [] as PlaceReviewEvidence[];
  }

  const query = [input.candidateName, input.item.name, input.detailQuery, '후기']
    .filter(Boolean)
    .join(' ');
  const upstreamUrl = new URL('https://openapi.naver.com/v1/search/blog.json');
  upstreamUrl.searchParams.set('query', query);
  upstreamUrl.searchParams.set('display', '3');
  upstreamUrl.searchParams.set('start', '1');
  upstreamUrl.searchParams.set('sort', 'sim');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);

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
    const items = Array.isArray(data?.items) ? data.items : [];

    return items
      .map((item: any) => ({
        title: cleanHtmlText(item?.title),
        snippet: cleanHtmlText(item?.description),
        source: cleanHtmlText(item?.bloggername),
        link: normalizeText(item?.link),
        postdate: normalizeText(item?.postdate),
      }))
      .filter((item: PlaceReviewEvidence) => item.title || item.snippet)
      .slice(0, 2);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function attachReviewEvidence(input: {
  items: PlaceCandidate[];
  candidateName: string;
  detailQuery: string;
  clientId: string;
  clientSecret: string;
}) {
  if (!input.clientId || !input.clientSecret) {
    return input.items;
  }

  const evidenceList = await Promise.all(
    input.items.map((item) =>
      fetchPlaceReviewEvidence({
        item,
        candidateName: input.candidateName,
        detailQuery: input.detailQuery,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      }),
    ),
  );

  return input.items.map((item, index) => ({
    ...item,
    reviewEvidence: evidenceList[index] ?? [],
  }));
}

function extractOpenAiResponseText(data: any) {
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

function buildPlaceSelectionPayload(input: {
  candidateName: string;
  candidateDistrict: string;
  category: string;
  detailQuery: string;
  meetCategory: string;
  userVibe: string;
  favoriteKeywords: string[];
  groupGenderContext: string;
  limit: number;
  items: PlaceCandidate[];
}) {
  return {
    placeArea: input.candidateName,
    district: input.candidateDistrict,
    meetCategory: input.meetCategory,
    recommendationCategory: input.category,
    detailQuery: input.detailQuery,
    userVibe: input.userVibe,
    favoriteKeywords: input.favoriteKeywords,
    groupGenderContext: input.groupGenderContext,
    targetCount: input.limit,
    allowedIds: input.items.map((item) => item.id),
    places: input.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      categoryPath: item.categoryPath,
	      address: item.roadAddress || item.address,
	      heuristicScore: Math.round(
	        getHeuristicScore(
	          item,
	          input.category,
	          input.detailQuery,
	          input.meetCategory,
	          input.groupGenderContext,
	        ) * 10,
	      ) / 10,
	      genericChain: genericChainKeywords.some((keyword) => getPlaceText(item).includes(keyword)),
	      reviewEvidence: (item.reviewEvidence ?? []).map((evidence) => ({
	        title: evidence.title,
	        snippet: evidence.snippet,
	        source: evidence.source,
	        postdate: evidence.postdate,
	      })),
	    })),
	  };
	}

async function fetchOpenAiPlaceRanking(input: {
  apiKey: string;
  model: string;
  payload: ReturnType<typeof buildPlaceSelectionPayload>;
  allowedIds: string[];
}) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.45,
      input: [
        {
          role: 'system',
          content:
            'You rank real nearby places for a Korean meetup/date planning app. Return JSON only. Choose only allowed ids. Prioritize places that fit the requested category, detail query, and social context. Prefer distinctive local venues, appropriate ambience, reservation-worthy restaurants/cafes/bars, and places people would actually choose for a meetup. Use reviewEvidence snippets as retrieval evidence for ambience, menu/category fit, popularity, and date/meetup suitability; ignore irrelevant or spammy snippets. Large generic franchises should be treated as fallback only when there are no suitable independent/local venues. Use groupGenderContext only as a soft ambience and comfort signal: prefer clean, safe, conversation-friendly, inclusive places for mixed or gender-skewed groups, but do not stereotype or exclude valid options only by gender. For activity/game requests, PC cafes, board-game cafes, billiards, bowling, arcades, and screen sports can be strong picks when the group is male-leaning or the user explicitly asks for game-style activities. For date requests, act like a human date planner: prefer conversation-friendly seating, ambience, reservation value, dessert/wine/exhibit/walkable follow-up options, and a natural two-stop flow. A plain chain cafe, fast-food shop, convenience store, mart, pharmacy, hotel/motel, unrelated retail store, or transport-only landmark is not a good date pick. Penalize generic fast-food chains such as Lotteria and McDonalds very strongly, and rank plain franchises only as last-resort fallbacks. Do not invent places.',
        },
        {
          role: 'user',
          content: JSON.stringify(input.payload),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'place_recommendation_ranking',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              item_ids: {
                type: 'array',
                minItems: input.payload.targetCount,
                maxItems: input.payload.targetCount,
                uniqueItems: true,
                items: {
                  type: 'string',
                  enum: input.allowedIds,
                },
              },
              summary: {
                type: 'string',
              },
            },
            required: ['item_ids', 'summary'],
          },
        },
      },
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI place ranking failed with status ${response.status}.`);
  }

  const outputText = extractOpenAiResponseText(data);
  const parsed = JSON.parse(outputText);

  return {
    itemIds: Array.isArray(parsed?.item_ids)
      ? parsed.item_ids.filter((id: unknown): id is string => typeof id === 'string')
      : [],
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
  };
}

async function fetchUpstagePlaceRanking(input: {
  apiKey: string;
  model: string;
  baseUrl: string;
  payload: ReturnType<typeof buildPlaceSelectionPayload>;
  allowedIds: string[];
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
      temperature: 0.45,
      response_format: {
        type: 'json_object',
      },
      messages: [
        {
          role: 'system',
          content:
            'Return a JSON object with keys item_ids and summary. item_ids must contain only allowed ids and match targetCount. You rank real nearby places for a Korean meetup/date planning app. Prioritize category fit, detail query fit, ambience, local distinctiveness, and places people would actually choose for a meetup. Use reviewEvidence snippets as retrieval evidence for ambience, menu/category fit, popularity, and date/meetup suitability; ignore irrelevant or spammy snippets. Large generic franchises should be treated as fallback only when there are no suitable independent/local venues. Use groupGenderContext only as a soft ambience and comfort signal: prefer clean, safe, conversation-friendly, inclusive places for mixed or gender-skewed groups, but do not stereotype or exclude valid options only by gender. For activity/game requests, PC cafes, board-game cafes, billiards, bowling, arcades, and screen sports can be strong picks when the group is male-leaning or the user explicitly asks for game-style activities. For date requests, act like a human date planner: prefer conversation-friendly seating, ambience, reservation value, dessert/wine/exhibit/walkable follow-up options, and a natural two-stop flow. A plain chain cafe, fast-food shop, convenience store, mart, pharmacy, hotel/motel, unrelated retail store, or transport-only landmark is not a good date pick. Penalize generic fast-food chains such as Lotteria and McDonalds very strongly, and rank plain franchises only as last-resort fallbacks. Do not invent places.',
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
        `${input.providerLabel ?? 'Upstage'} place ranking failed with status ${response.status}.`,
    );
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  const content =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((item) => item?.text ?? '').join('\n')
        : '';
  const parsed = JSON.parse(content);

  return {
    itemIds: Array.isArray(parsed?.item_ids)
      ? parsed.item_ids.filter((id: unknown): id is string => typeof id === 'string')
      : [],
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    json(res, 405, { message: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const items = Array.isArray(body?.items)
      ? body.items
          .map((item: any) => ({
            id: normalizeText(item?.id),
            name: normalizeText(item?.name),
            description: normalizeText(item?.description),
            categoryPath: normalizeText(item?.categoryPath),
            address: normalizeText(item?.address),
            roadAddress: normalizeText(item?.roadAddress),
          }))
          .filter((item: PlaceCandidate) => item.id && item.name)
      : [];
    const category = normalizeText(body?.category) || 'restaurant';
    const detailQuery = normalizeText(body?.detailQuery) || category;
    const meetCategory = normalizeText(body?.meetCategory) || category;
    if (!items.length) {
      json(res, 200, {
        itemIds: [],
        source: 'empty',
        message: '추천 후보가 아직 없어요.',
      });
      return;
    }

    const requestedLimit =
      typeof body?.limit === 'number' && Number.isFinite(body.limit) ? Math.round(body.limit) : 6;
    const groupGenderContext = normalizeText(body?.groupGenderContext);
    const preferredItems = getPreferredItems(
      items,
      category,
      detailQuery,
      meetCategory,
      groupGenderContext,
    );
    const independentItems = preferredItems.filter((item) => !isGenericChainPlace(item));
    const rankableItems =
      independentItems.length >= Math.min(requestedLimit, 6) ? independentItems : preferredItems;
    const limit = Math.max(1, Math.min(requestedLimit, rankableItems.length));
    const allowedIds = getAllowedIds(rankableItems);
    const fallbackIds = buildFallbackIds(
      rankableItems,
      category,
      detailQuery,
      meetCategory,
      groupGenderContext,
      limit,
    );

    if (!allowedIds.length) {
      json(res, 200, {
        itemIds: [],
        source: 'empty',
        message: '추천 후보가 아직 없어요.',
      });
      return;
    }

	    const env = process.env;
	    const naverSearchClientId = env.NAVER_SEARCH_CLIENT_ID?.trim() ?? '';
	    const naverSearchClientSecret = env.NAVER_SEARCH_CLIENT_SECRET?.trim() ?? '';
    const runtimeAiConfig = getRuntimeAiConfig(body);
    const aiProviders = getServerAiProviders(env, runtimeAiConfig);
	    const candidateName = normalizeText(body?.candidate?.name);
	    const candidateDistrict = normalizeText(body?.candidate?.district);
	    const evidenceItems =
	      aiProviders.length
	        ? await attachReviewEvidence({
	            items: rankableItems,
	            candidateName,
	            detailQuery,
	            clientId: naverSearchClientId,
	            clientSecret: naverSearchClientSecret,
	          })
	        : rankableItems;
	    const payload = buildPlaceSelectionPayload({
	      candidateName,
	      candidateDistrict,
	      category,
	      detailQuery,
	      meetCategory,
      userVibe: normalizeText(body?.userVibe),
      groupGenderContext,
	      favoriteKeywords: Array.isArray(body?.favoriteKeywords)
	        ? body.favoriteKeywords.filter((keyword: unknown): keyword is string => typeof keyword === 'string')
	        : [],
	      limit,
	      items: evidenceItems,
	    });

    if (!aiProviders.length) {
      json(res, 200, {
        itemIds: fallbackIds,
        source: 'heuristic',
        message: 'AI 키가 없어 기본 필터로 장소를 정리했어요.',
      });
      return;
    }

    let lastAiError: unknown = null;

    for (const aiProvider of aiProviders) {
      try {
        const aiRanking =
          aiProvider.provider === 'openai'
            ? await fetchOpenAiPlaceRanking({
                apiKey: aiProvider.apiKey,
                model: aiProvider.model,
                payload,
                allowedIds,
              })
            : await fetchUpstagePlaceRanking({
                apiKey: aiProvider.apiKey,
                model: aiProvider.model,
                baseUrl: aiProvider.baseUrl,
                payload,
                allowedIds,
                providerLabel: aiProvider.provider === 'gms' ? 'GMS AI' : 'Upstage',
              });
        const itemIds = aiRanking.itemIds
          .filter((id) => allowedIds.includes(id))
          .slice(0, limit);

        json(res, 200, {
          itemIds: itemIds.length ? itemIds : fallbackIds,
          source: aiProvider.provider,
          message: aiRanking.summary || 'AI가 모임에 어울리는 순서로 장소를 정리했어요.',
        });
        return;
      } catch (error) {
        lastAiError = error;
      }
    }

    json(res, 200, {
      itemIds: fallbackIds,
      source: 'heuristic',
      message:
        lastAiError instanceof Error
          ? `AI 추천 정렬 실패: ${lastAiError.message}`
          : 'AI 추천 정렬에 실패해 기본 필터로 장소를 정리했어요.',
    });
  } catch (error) {
    json(res, 500, {
      itemIds: [],
      source: 'error',
      message:
        error instanceof Error
          ? error.message
          : '장소 추천을 정리하지 못했어요.',
    });
  }
}
