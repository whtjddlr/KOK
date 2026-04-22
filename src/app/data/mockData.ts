import { Participant, Candidate } from '../types';

export const initialParticipants: Participant[] = [
  {
    id: '1',
    name: '지수',
    location: '강남역',
    coordinates: { lat: 37.4979, lng: 127.0276 },
    maxTravelTime: 40,
  },
  {
    id: '2',
    name: '민준',
    location: '홍대입구역',
    coordinates: { lat: 37.5565, lng: 126.9239 },
    maxTravelTime: 35,
  },
  {
    id: '3',
    name: '서연',
    location: '부천시청',
    coordinates: { lat: 37.5040, lng: 126.7667 },
    maxTravelTime: 50,
  },
];

export const mockCandidates: Candidate[] = [
  {
    id: 'gangnam',
    name: '강남',
    description: '트렌디한 카페와 레스토랑이 즐비한 곳',
    vibe: '세련되고 활기찬',
    coordinates: { lat: 37.4979, lng: 127.0276 },
    averageDistance: 12.3,
    tags: ['카페', '쇼핑', '트렌디'],
  },
  {
    id: 'hongdae',
    name: '홍대',
    description: '젊고 자유로운 분위기의 핫플레이스',
    vibe: '힙하고 활발한',
    coordinates: { lat: 37.5565, lng: 126.9239 },
    averageDistance: 14.7,
    tags: ['공연', '클럽', '힙'],
  },
  {
    id: 'seongsu',
    name: '성수',
    description: '감각적인 브런치와 복합문화공간의 성지',
    vibe: '감성적이고 차분한',
    coordinates: { lat: 37.5443, lng: 127.0557 },
    averageDistance: 11.2,
    tags: ['브런치', '감성', '복합문화'],
  },
  {
    id: 'yeouido',
    name: '여의도',
    description: '한강뷰와 함께하는 도심 속 힐링',
    vibe: '여유롭고 쾌적한',
    coordinates: { lat: 37.5219, lng: 126.9245 },
    averageDistance: 13.5,
    tags: ['한강', '공원', '데이트'],
  },
  {
    id: 'sadang',
    name: '사당',
    description: '접근성 좋은 중심지, 다양한 음식점 밀집',
    vibe: '편안하고 익숙한',
    coordinates: { lat: 37.4768, lng: 126.9813 },
    averageDistance: 10.8,
    tags: ['맛집', '편리', '접근성'],
  },
  {
    id: 'sinchon',
    name: '신촌',
    description: '대학가 특유의 활기와 저렴한 가격',
    vibe: '활기차고 친근한',
    coordinates: { lat: 37.5550, lng: 126.9366 },
    averageDistance: 15.3,
    tags: ['학생가', '저렴', '번화가'],
  },
];

export const seoulStations = [
  '강남역', '홍대입구역', '신촌역', '이태원역', '건대입구역',
  '잠실역', '사당역', '신림역', '노원역', '수유역',
  '왕십리역', '종로3가역', '시청역', '서울역', '용산역',
  '여의도역', '구로디지털단지역', '성수역', '압구정로데오역',
  '부천시청', '인천시청', '수원역', '분당역', '판교역',
];
