import { Candidate, MeetCategoryKey, VenueCategoryKey, VenueOption } from '../types';

type VenueSeed = Omit<VenueOption, 'id' | 'areaId' | 'category'>;

export const venueCategoryOrder: VenueCategoryKey[] = ['restaurant', 'cafe', 'activity'];

export const venueCategoryMeta: Record<
  VenueCategoryKey,
  { label: string; accent: string; placeholder: string }
> = {
  restaurant: {
    label: '맛집',
    accent: '#ff7b6b',
    placeholder: '메뉴, 분위기, 키워드 검색',
  },
  cafe: {
    label: '카페',
    accent: '#4ecdc4',
    placeholder: '디저트, 작업, 뷰 검색',
  },
  activity: {
    label: '놀거리',
    accent: '#2d3561',
    placeholder: '전시, 산책, 게임 검색',
  },
};

const venueLibrary: Record<string, Partial<Record<VenueCategoryKey, VenueSeed[]>>> = {
  sadang: {
    restaurant: [
      {
        name: '남성시장 온기식당',
        subtitle: '한식, 전골, 가볍게 시작',
        description: '여럿이 가도 메뉴 고르기 편한 한식 위주 식당.',
        tags: ['한식', '모임', '든든함'],
        walkMinutes: 6,
      },
      {
        name: '사당 숯불고기집',
        subtitle: '고기, 회식, 시끌벅적',
        description: '테이블 회전이 빨라서 즉흥 모임에 잘 맞는 곳.',
        tags: ['고기', '모임', '2차연결'],
        walkMinutes: 8,
      },
      {
        name: '골목 파스타바',
        subtitle: '파스타, 와인, 데이트',
        description: '너무 무겁지 않게 분위기를 챙기기 좋은 픽.',
        tags: ['양식', '데이트', '분위기'],
        walkMinutes: 5,
      },
    ],
    cafe: [
      {
        name: '사당 루프 커피',
        subtitle: '디저트, 좌석 넓음',
        description: '오래 앉아 이야기하기 편한 넓은 좌석형 카페.',
        tags: ['수다', '디저트', '넓은좌석'],
        walkMinutes: 7,
      },
      {
        name: '모서리 티룸',
        subtitle: '차, 조용함, 여유',
        description: '시끄러운 곳을 피하고 싶을 때 무난한 선택지.',
        tags: ['차', '조용함', '힐링'],
        walkMinutes: 4,
      },
      {
        name: '사당 크림라떼',
        subtitle: '달달함, 사진, 캐주얼',
        description: '2차로 가볍게 들르기 좋은 디저트 카페.',
        tags: ['라떼', '사진', '가벼움'],
        walkMinutes: 6,
      },
    ],
    activity: [
      {
        name: '남현 산책 루트',
        subtitle: '산책, 야외, 가볍게',
        description: '밥 먹고 걷기 좋은 짧은 산책 코스.',
        tags: ['산책', '야외', '무난함'],
        walkMinutes: 9,
      },
      {
        name: '사당 보드게임룸',
        subtitle: '보드게임, 단체, 웃김',
        description: '분위기 끊기지 않게 2차로 넘어가기 좋은 곳.',
        tags: ['보드게임', '실내', '모임'],
        walkMinutes: 5,
      },
      {
        name: '즉석 포토부스',
        subtitle: '사진, 짧게, 기록용',
        description: '짧게 들렀다 나와도 만족감이 남는 선택지.',
        tags: ['사진', '짧게', '기록'],
        walkMinutes: 3,
      },
    ],
  },
  hongdae: {
    restaurant: [
      {
        name: '홍대 합정 수제버거',
        subtitle: '버거, 캐주얼, 대화 쉬움',
        description: '편하게 앉아 수다 떨기 좋은 캐주얼 식사 픽.',
        tags: ['버거', '캐주얼', '친구모임'],
        walkMinutes: 7,
      },
      {
        name: '연남 골목 이자카야',
        subtitle: '일식, 분위기, 저녁',
        description: '저녁 약속 무드를 올려주는 골목형 식당.',
        tags: ['일식', '저녁', '분위기'],
        walkMinutes: 11,
      },
      {
        name: '홍대 솥밥집',
        subtitle: '한식, 깔끔함, 데이트',
        description: '깔끔한 한 끼로 시작하기 좋은 안정적인 선택.',
        tags: ['한식', '솥밥', '무난함'],
        walkMinutes: 5,
      },
    ],
    cafe: [
      {
        name: '연남 테라스 카페',
        subtitle: '채광, 사진, 여유',
        description: '낮 약속이면 거의 실패 없는 밝은 분위기 카페.',
        tags: ['채광', '사진', '데이트'],
        walkMinutes: 8,
      },
      {
        name: '홍대 작업실 커피',
        subtitle: '넓은 좌석, 수다',
        description: '오래 머물기 편한 대형 카페형 선택지.',
        tags: ['넓음', '수다', '편함'],
        walkMinutes: 4,
      },
      {
        name: '합정 크림디저트',
        subtitle: '디저트, 달달함, 2차',
        description: '식사 후 바로 이어지기 좋은 디저트 중심 카페.',
        tags: ['디저트', '2차', '가벼움'],
        walkMinutes: 6,
      },
    ],
    activity: [
      {
        name: '거리공연 라인',
        subtitle: '구경, 활기, 즉흥',
        description: '코스 없이도 바로 재미를 만들 수 있는 픽.',
        tags: ['구경', '즉흥', '활기'],
        walkMinutes: 2,
      },
      {
        name: '홍대 보드게임카페',
        subtitle: '실내, 단체, 텐션',
        description: '술 없이도 텐션을 살리기 좋은 대표 놀거리.',
        tags: ['실내', '보드게임', '모임'],
        walkMinutes: 5,
      },
      {
        name: '연남 산책 루프',
        subtitle: '걷기, 사진, 마무리',
        description: '카페 후반부에 가볍게 걷기 좋은 동선.',
        tags: ['산책', '사진', '데이트'],
        walkMinutes: 9,
      },
    ],
  },
  seongsu: {
    restaurant: [
      {
        name: '성수 브런치 테이블',
        subtitle: '브런치, 감성, 채광',
        description: '주말 낮 약속에 특히 잘 맞는 브런치형 식당.',
        tags: ['브런치', '채광', '데이트'],
        walkMinutes: 6,
      },
      {
        name: '서울숲 파스타 키친',
        subtitle: '양식, 데이트, 무드',
        description: '감성은 살리면서도 메뉴 호불호가 적은 편.',
        tags: ['파스타', '데이트', '분위기'],
        walkMinutes: 8,
      },
      {
        name: '성수 직화 덮밥',
        subtitle: '한끼, 빠름, 캐주얼',
        description: '웨이팅 부담을 줄이고 싶을 때 안정적인 선택지.',
        tags: ['덮밥', '빠름', '캐주얼'],
        walkMinutes: 4,
      },
    ],
    cafe: [
      {
        name: '성수 로스터리',
        subtitle: '핸드드립, 깊은 맛, 조용함',
        description: '커피 취향을 챙기면서도 말하기 편한 카페.',
        tags: ['커피', '조용함', '취향'],
        walkMinutes: 5,
      },
      {
        name: '서울숲 디저트하우스',
        subtitle: '케이크, 사진, 감성',
        description: '사진과 디저트를 모두 챙기기 좋은 곳.',
        tags: ['케이크', '사진', '감성'],
        walkMinutes: 7,
      },
      {
        name: '테라스 밀크티',
        subtitle: '뷰, 여유, 오후',
        description: '해 질 무렵 분위기가 예쁘게 살아나는 카페.',
        tags: ['뷰', '오후', '여유'],
        walkMinutes: 9,
      },
    ],
    activity: [
      {
        name: '서울숲 산책',
        subtitle: '공원, 산책, 사진',
        description: '식사와 카페 사이에 넣기 좋은 클래식 코스.',
        tags: ['산책', '공원', '사진'],
        walkMinutes: 10,
      },
      {
        name: '성수 팝업 라인',
        subtitle: '팝업, 전시, 구경',
        description: '무작정 걸어도 구경할 거리가 많은 동선.',
        tags: ['팝업', '구경', '트렌드'],
        walkMinutes: 6,
      },
      {
        name: '성수 포토부스',
        subtitle: '짧게, 기록, 가벼움',
        description: '짧은 시간 안에 약속의 기억을 남기기 좋다.',
        tags: ['사진', '짧게', '기록'],
        walkMinutes: 3,
      },
    ],
  },
  jamsil: {
    restaurant: [
      {
        name: '잠실 송리단길 파스타',
        subtitle: '양식, 데이트, 트렌디',
        description: '잠실 특유의 정돈된 무드를 느끼기 좋은 식당.',
        tags: ['파스타', '데이트', '송리단길'],
        walkMinutes: 7,
      },
      {
        name: '잠실 호수 근처 솥밥',
        subtitle: '한식, 깔끔함, 점심',
        description: '부담 적고 만족도 높은 무난한 식사 픽.',
        tags: ['솥밥', '한식', '점심'],
        walkMinutes: 5,
      },
      {
        name: '잠실 스테이크 하우스',
        subtitle: '저녁, 분위기, 기념일',
        description: '오늘 약속을 조금 더 특별하게 만들고 싶을 때.',
        tags: ['스테이크', '기념일', '저녁'],
        walkMinutes: 8,
      },
    ],
    cafe: [
      {
        name: '석촌호수 뷰카페',
        subtitle: '뷰, 사진, 여유',
        description: '낮과 밤 모두 그림이 나오는 잠실 대표 카페.',
        tags: ['뷰', '사진', '석촌호수'],
        walkMinutes: 6,
      },
      {
        name: '잠실 디저트 살롱',
        subtitle: '케이크, 부드러움, 2차',
        description: '식사 후 달달한 코스로 연결하기 좋은 선택.',
        tags: ['케이크', '디저트', '2차'],
        walkMinutes: 4,
      },
      {
        name: '조용한 로스터리',
        subtitle: '커피, 차분함, 대화',
        description: '말이 길어질 때 특히 만족도가 높다.',
        tags: ['커피', '조용함', '수다'],
        walkMinutes: 7,
      },
    ],
    activity: [
      {
        name: '석촌호수 산책',
        subtitle: '호수, 걷기, 야경',
        description: '잠실의 장점을 가장 쉽게 누릴 수 있는 코스.',
        tags: ['호수', '산책', '야경'],
        walkMinutes: 8,
      },
      {
        name: '아쿠아리움 or 전시',
        subtitle: '실내, 데이트, 비오는날',
        description: '날씨 영향을 덜 받는 잠실형 놀거리 픽.',
        tags: ['실내', '전시', '데이트'],
        walkMinutes: 12,
      },
      {
        name: '송리단길 포토스팟',
        subtitle: '사진, 구경, 짧게',
        description: '산책과 구경을 섞기 좋은 가벼운 마무리 코스.',
        tags: ['사진', '구경', '가볍게'],
        walkMinutes: 5,
      },
    ],
  },
  gangnam: {
    restaurant: [
      {
        name: '강남 트러플 파스타',
        subtitle: '양식, 분위기, 저녁',
        description: '도시적인 분위기로 저녁 약속 무드를 살리는 픽.',
        tags: ['양식', '저녁', '도시감'],
        walkMinutes: 6,
      },
      {
        name: '강남 샤브샤브',
        subtitle: '한식, 단체, 무난함',
        description: '여럿이 가도 메뉴 합의가 쉬운 편한 선택지.',
        tags: ['샤브', '단체', '무난함'],
        walkMinutes: 4,
      },
      {
        name: '역삼 스테이크 바',
        subtitle: '기념일, 대화, 세련됨',
        description: '조금 더 제대로 만나는 느낌을 주는 식당.',
        tags: ['스테이크', '세련됨', '데이트'],
        walkMinutes: 8,
      },
    ],
    cafe: [
      {
        name: '강남 라운지 카페',
        subtitle: '넓은 좌석, 미팅, 수다',
        description: '자리 잡고 오래 머무르기 좋은 카페형 공간.',
        tags: ['넓음', '수다', '모임'],
        walkMinutes: 5,
      },
      {
        name: '디저트 아틀리에',
        subtitle: '케이크, 사진, 달달함',
        description: '가볍게 기분을 올리기 좋은 후식 코스.',
        tags: ['디저트', '사진', '달달함'],
        walkMinutes: 6,
      },
      {
        name: '도산 블렌드 바',
        subtitle: '커피, 감도, 취향',
        description: '커피 취향 얘기하기 좋아지는 카페.',
        tags: ['커피', '취향', '분위기'],
        walkMinutes: 10,
      },
    ],
    activity: [
      {
        name: '강남 포토부스 라인',
        subtitle: '사진, 짧게, 텐션',
        description: '약속 텐션을 살리기 좋은 가장 빠른 놀거리.',
        tags: ['사진', '즉흥', '텐션'],
        walkMinutes: 3,
      },
      {
        name: '방탈출 카페',
        subtitle: '실내, 몰입, 단체',
        description: '밥카페 말고 확실히 놀고 싶을 때 잘 맞는다.',
        tags: ['방탈출', '실내', '몰입'],
        walkMinutes: 7,
      },
      {
        name: '가로수길 산책',
        subtitle: '걷기, 쇼윈도, 여유',
        description: '소화도 시키고 분위기도 챙기기 좋은 동선.',
        tags: ['산책', '쇼핑', '가볍게'],
        walkMinutes: 11,
      },
    ],
  },
  yongsan: {
    restaurant: [
      {
        name: '용산 브런치 델리',
        subtitle: '브런치, 캐주얼, 낮약속',
        description: '용산의 무난하고 감각적인 첫 코스.',
        tags: ['브런치', '낮약속', '감각'],
        walkMinutes: 6,
      },
      {
        name: '삼각지 고깃집',
        subtitle: '고기, 단체, 저녁',
        description: '저녁 약속의 만족도를 안정적으로 챙기는 픽.',
        tags: ['고기', '저녁', '단체'],
        walkMinutes: 5,
      },
      {
        name: '해방촌 파스타',
        subtitle: '양식, 감성, 데이트',
        description: '조금 더 분위기를 살리고 싶을 때 좋은 선택.',
        tags: ['양식', '감성', '데이트'],
        walkMinutes: 10,
      },
    ],
    cafe: [
      {
        name: '용산 로스터스',
        subtitle: '커피, 조용함, 대화',
        description: '식사 후 차분하게 이어가기 좋은 카페.',
        tags: ['커피', '차분함', '수다'],
        walkMinutes: 4,
      },
      {
        name: '해방촌 디저트룸',
        subtitle: '디저트, 감성, 사진',
        description: '사진과 디저트 둘 다 챙기기 좋은 스팟.',
        tags: ['디저트', '감성', '사진'],
        walkMinutes: 9,
      },
      {
        name: '용산 대형카페',
        subtitle: '넓은 공간, 수다, 무난함',
        description: '취향 갈릴 걱정이 적은 무난한 카드.',
        tags: ['넓음', '무난함', '모임'],
        walkMinutes: 5,
      },
    ],
    activity: [
      {
        name: '용산공원 산책',
        subtitle: '공원, 걷기, 여유',
        description: '식후 산책 코스로 편하게 넣기 좋은 루트.',
        tags: ['공원', '산책', '여유'],
        walkMinutes: 8,
      },
      {
        name: '리빙 편집숍 구경',
        subtitle: '쇼윈도, 취향, 구경',
        description: '말이 끊기지 않는 가벼운 구경 코스.',
        tags: ['구경', '취향', '가벼움'],
        walkMinutes: 6,
      },
      {
        name: '삼각지 재즈바',
        subtitle: '저녁, 무드, 2차',
        description: '분위기를 확 바꿔주는 후반부 카드.',
        tags: ['재즈', '무드', '2차'],
        walkMinutes: 10,
      },
    ],
  },
};

function getAreaLabel(candidate: Candidate) {
  return candidate.name.replace(' 근처', '').replace(' 바로 앞', '').trim();
}

function buildFallbackSeeds(candidate: Candidate, category: VenueCategoryKey): VenueSeed[] {
  const areaLabel = getAreaLabel(candidate);

  if (category === 'restaurant') {
    return [
      {
        name: `${areaLabel} 골목 식당`,
        subtitle: '한식, 편한 시작',
        description: `${areaLabel}에서 무난하게 시작하기 좋은 식사 카드.`,
        tags: ['한식', '무난함', areaLabel],
        walkMinutes: 5,
      },
      {
        name: `${areaLabel} 파스타 키친`,
        subtitle: '양식, 분위기, 가벼움',
        description: '분위기를 챙기면서도 메뉴 합의가 쉬운 편.',
        tags: ['양식', '분위기', areaLabel],
        walkMinutes: 7,
      },
      {
        name: `${areaLabel} 직화 덮밥`,
        subtitle: '빠른 한끼, 캐주얼',
        description: '웨이팅 부담을 줄이고 바로 이어가기 좋은 식사 픽.',
        tags: ['덮밥', '캐주얼', '빠름'],
        walkMinutes: 4,
      },
    ];
  }

  if (category === 'cafe') {
    return [
      {
        name: `${areaLabel} 로스터리`,
        subtitle: '커피, 수다, 무난함',
        description: `${areaLabel}에서 오래 머물기 좋은 카페 카드.`,
        tags: ['커피', '수다', areaLabel],
        walkMinutes: 5,
      },
      {
        name: `${areaLabel} 디저트룸`,
        subtitle: '케이크, 달달함, 2차',
        description: '식사 후 바로 이어가기 좋은 달달한 코스.',
        tags: ['디저트', '2차', '사진'],
        walkMinutes: 6,
      },
      {
        name: `${areaLabel} 테라스 카페`,
        subtitle: '채광, 여유, 사진',
        description: '낮 약속이나 가벼운 데이트 무드에 잘 맞는다.',
        tags: ['채광', '사진', '여유'],
        walkMinutes: 8,
      },
    ];
  }

  return [
    {
      name: `${areaLabel} 산책 코스`,
      subtitle: '걷기, 사진, 여유',
      description: `${areaLabel} 주변을 가볍게 즐기기 좋은 루트.`,
      tags: ['산책', '야외', areaLabel],
      walkMinutes: 9,
    },
    {
      name: `${areaLabel} 보드게임룸`,
      subtitle: '실내, 단체, 텐션',
      description: '즉흥적으로도 분위기를 올리기 쉬운 놀거리 카드.',
      tags: ['보드게임', '실내', '모임'],
      walkMinutes: 6,
    },
    {
      name: `${areaLabel} 포토스팟`,
      subtitle: '짧게, 기록, 가벼움',
      description: '짧게 즐기고 다음 코스로 넘어가기 좋은 선택.',
      tags: ['사진', '기록', '짧게'],
      walkMinutes: 3,
    },
  ];
}

function materializeOptions(
  areaId: string,
  category: VenueCategoryKey,
  seeds: VenueSeed[],
): VenueOption[] {
  return seeds.map((seed, index) => ({
    ...seed,
    id: `${areaId}-${category}-${index + 1}`,
    areaId,
    category,
  }));
}

export function getVenueOptionsByCategory(candidate: Candidate): Record<VenueCategoryKey, VenueOption[]> {
  const areaSeeds = venueLibrary[candidate.id] ?? {};

  return {
    restaurant: materializeOptions(
      candidate.id,
      'restaurant',
      areaSeeds.restaurant ?? buildFallbackSeeds(candidate, 'restaurant'),
    ),
    cafe: materializeOptions(
      candidate.id,
      'cafe',
      areaSeeds.cafe ?? buildFallbackSeeds(candidate, 'cafe'),
    ),
    activity: materializeOptions(
      candidate.id,
      'activity',
      areaSeeds.activity ?? buildFallbackSeeds(candidate, 'activity'),
    ),
  };
}

export function getDefaultVenueCategory(category: MeetCategoryKey): VenueCategoryKey {
  switch (category) {
    case 'cafe':
      return 'cafe';
    case 'activity':
    case 'culture':
      return 'activity';
    case 'date':
      return 'restaurant';
    case 'drink':
      return 'activity';
    case 'dining':
    default:
      return 'restaurant';
  }
}

export function buildInitialVenueSelections(
  candidate: Candidate,
): Record<VenueCategoryKey, VenueOption | null> {
  const venues = getVenueOptionsByCategory(candidate);

  return {
    restaurant: venues.restaurant[0] ?? null,
    cafe: venues.cafe[0] ?? null,
    activity: venues.activity[0] ?? null,
  };
}
