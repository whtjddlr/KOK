export interface PlaceQualityCandidate {
  name?: string;
  description?: string;
  categoryPath?: string;
  address?: string;
  roadAddress?: string;
}

const largeFranchiseKeywords = [
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
  '편의점',
  '마트',
  '슈퍼',
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

const categoryAllowKeywords: Record<string, string[]> = {
  restaurant: [
    '음식점',
    '한식',
    '일식',
    '중식',
    '양식',
    '고기',
    '구이',
    '회',
    '초밥',
    '파스타',
    '레스토랑',
    '다이닝',
    '분식',
    '치킨',
    '브런치',
    '국수',
    '돈가스',
    '카레',
    '쌀국수',
    '샤브',
    '갈비',
    '곱창',
    '족발',
    '보쌈',
    '해물',
    '찜',
    '탕',
  ],
  cafe: ['카페', '디저트', '베이커리', '커피', '브런치', '케이크'],
  drink: ['술집', '바', '이자카야', '와인', '맥주', '포차', '칵테일', '펍', '호프'],
  culture: ['전시', '공연', '문화', '갤러리', '서점', '공방', '미술관', '박물관', '소품샵', '산책', '공원'],
  activity: [
    '방탈출',
    '보드게임',
    '볼링',
    '오락',
    '영화',
    '놀거리',
    '공원',
    '체험',
    '스포츠',
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

const categoryDenyKeywords: Record<string, string[]> = {
  restaurant: ['카페', '디저트', '커피', '베이커리'],
  drink: ['카페', '디저트', '베이커리', '패스트푸드'],
  culture: ['편의점', '마트', '약국', '음식점'],
  activity: ['편의점', '마트', '약국'],
};

function getPlaceText(place: PlaceQualityCandidate) {
  return [
    place.name,
    place.description,
    place.categoryPath,
    place.address,
    place.roadAddress,
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

export function isLargeFranchisePlace(place: PlaceQualityCandidate) {
  return includesAny(getPlaceText(place), largeFranchiseKeywords);
}

function isFastFoodPlace(place: PlaceQualityCandidate) {
  return includesAny(getPlaceText(place), fastFoodKeywords);
}

function isUnrelatedPlace(place: PlaceQualityCandidate) {
  return includesAny(getPlaceText(place), unrelatedKeywords);
}

function isDateHardMismatch(place: PlaceQualityCandidate, meetCategory = '', detailQuery = '') {
  if (!isDateContext(meetCategory, detailQuery)) {
    return false;
  }

  const text = getPlaceText(place);

  return isFastFoodPlace(place) || includesAny(text, unrelatedKeywords) || includesAny(text, dateHardDenyKeywords);
}

function isCategoryMismatch(place: PlaceQualityCandidate, category: string, detailQuery: string, meetCategory = '') {
  const categoryKey = getCategoryKey(category, meetCategory);
  const text = getPlaceText(place);
  const allowKeywords = categoryAllowKeywords[categoryKey] ?? [];
  const denyKeywords = categoryDenyKeywords[categoryKey] ?? [];
  const hasAllowedSignal = includesAny(text, allowKeywords);
  const hasDeniedSignal = includesAny(text, denyKeywords);
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
  place: PlaceQualityCandidate,
  categoryKey: string,
  meetCategory: string,
  detailQuery: string,
) {
  if (!isDateContext(meetCategory, detailQuery)) {
    return 0;
  }

  const text = getPlaceText(place);
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

  if (isFastFoodPlace(place)) {
    score -= 130;
  }

  if (includesAny(text, dateWeakDenyKeywords)) {
    score -= 42;
  }

  if (isLargeFranchisePlace(place)) {
    score -= 28;
  }

  return score;
}

function getGroupActivitySuitabilityScore(
  place: PlaceQualityCandidate,
  categoryKey: string,
  meetCategory: string,
  detailQuery: string,
  groupGenderContext = '',
) {
  if (isDateContext(meetCategory, detailQuery)) {
    return 0;
  }

  const text = getPlaceText(place);
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

export function getPlaceQualityScore(
  place: PlaceQualityCandidate,
  category: string,
  detailQuery: string,
  meetCategory = '',
  groupGenderContext = '',
) {
  const categoryKey = getCategoryKey(category, meetCategory);
  const text = getPlaceText(place);
  const lowerText = text.toLowerCase();
  const normalizedDetail = detailQuery.trim().toLowerCase();
  const allowKeywords = categoryAllowKeywords[categoryKey] ?? [];
  let score = 0;

  if (includesAny(text, allowKeywords)) {
    score += 32;
  }

  if (normalizedDetail && lowerText.includes(normalizedDetail)) {
    score += 12;
  }

  if (includesAny(text, ['맛집', '핫플', '분위기', '예약', '레스토랑', '다이닝'])) {
    score += 8;
  }

  score += getDateSuitabilityScore(place, categoryKey, meetCategory, detailQuery);
  score += getGroupActivitySuitabilityScore(
    place,
    categoryKey,
    meetCategory,
    detailQuery,
    groupGenderContext,
  );

  if (isLargeFranchisePlace(place)) {
    score -= meetCategory === 'date' || detailQuery.includes('데이트') || detailQuery.includes('분위기')
      ? 70
      : 48;
  }

  if (isCategoryMismatch(place, category, detailQuery, meetCategory)) {
    score -= 64;
  }

  if (isUnrelatedPlace(place)) {
    score -= 90;
  }

  return score;
}

const categoryHighlightLabels: Record<string, string> = {
  restaurant: '음식점 적합',
  cafe: '카페/디저트',
  drink: '술자리 적합',
  culture: '전시/문화',
  activity: '놀거리 적합',
};

function pushUnique(items: string[], value: string) {
  if (!items.includes(value)) {
    items.push(value);
  }
}

export function getPlaceQualityHighlights(
  place: PlaceQualityCandidate,
  options: {
    category: string;
    detailQuery: string;
    meetCategory?: string;
    groupGenderContext?: string;
    favoriteKeywords?: string[];
  },
) {
  const categoryKey = getCategoryKey(options.category, options.meetCategory);
  const text = getPlaceText(place);
  const highlights: string[] = [];
  const favoriteMatched = (options.favoriteKeywords ?? []).some(
    (keyword) => keyword && (text.includes(keyword) || options.detailQuery.includes(keyword)),
  );

  if (favoriteMatched) {
    pushUnique(highlights, '취향 반영');
  }

  if (isDateContext(options.meetCategory, options.detailQuery)) {
    if (includesAny(text, ['분위기', '감성', '뷰', '루프탑', '한강'])) {
      pushUnique(highlights, '분위기');
    }

    if (includesAny(text, ['예약', '오마카세', '다이닝', '코스', '비스트로'])) {
      pushUnique(highlights, '예약/다이닝');
    }

    if (includesAny(text, ['디저트', '베이커리', '케이크', '젤라또'])) {
      pushUnique(highlights, '디저트');
    }

    if (includesAny(text, ['전시', '갤러리', '공방', '소품샵', '산책'])) {
      pushUnique(highlights, '데이트 코스');
    }
  }

  if (!isDateContext(options.meetCategory, options.detailQuery)) {
    const hasGameSignal = includesAny(text, gameActivityKeywords);

    if (hasGameSignal && hasGameActivityIntent(categoryKey, options.detailQuery, options.meetCategory)) {
      pushUnique(
        highlights,
        isMaleLeaningGroup(options.groupGenderContext) ? '남성 모임 취향' : '게임/액티비티',
      );
    }
  }

  if (includesAny(text, categoryAllowKeywords[categoryKey] ?? [])) {
    pushUnique(highlights, categoryHighlightLabels[categoryKey] ?? '카테고리 적합');
  }

  if (!isLargeFranchisePlace(place) && !isUnrelatedPlace(place)) {
    pushUnique(highlights, '로컬 후보');
  }

  return highlights.slice(0, 4);
}

export function getPreferredPlaceCandidates<T extends PlaceQualityCandidate>(
  places: T[],
  options: {
    category: string;
    detailQuery: string;
    meetCategory?: string;
    groupGenderContext?: string;
    minimumIndependent?: number;
    allowRejectedFallback?: boolean;
  },
) {
  const scoredPlaces = places
    .map((place, index) => ({
      place,
      index,
      score: getPlaceQualityScore(
        place,
        options.category,
        options.detailQuery,
        options.meetCategory,
        options.groupGenderContext,
      ),
      chain: isLargeFranchisePlace(place),
      mismatch: isCategoryMismatch(
        place,
        options.category,
        options.detailQuery,
        options.meetCategory,
      ),
      dateHardMismatch: isDateHardMismatch(
        place,
        options.meetCategory,
        options.detailQuery,
      ),
      unrelated: isUnrelatedPlace(place),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    });
  const viablePlaces = scoredPlaces.filter(
    (item) => !item.mismatch && !item.unrelated && !item.dateHardMismatch,
  );
  const independentPlaces = viablePlaces.filter((item) => !item.chain);
  const minimumIndependent = options.minimumIndependent ?? Math.min(4, places.length);
  const primaryPlaces =
    independentPlaces.length >= Math.min(minimumIndependent, places.length)
      ? [
          ...independentPlaces,
          ...viablePlaces.filter((item) => item.chain),
        ]
      : viablePlaces;
  if (primaryPlaces.length || !options.allowRejectedFallback) {
    return primaryPlaces.map((item) => item.place);
  }

  return scoredPlaces.map((item) => item.place);
}
