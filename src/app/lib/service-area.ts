import type { Coordinates } from '../types';

export const SERVICE_AREA_UNSUPPORTED_MESSAGE =
  '서비스를 제공하지 않는 지역이에요. 서울·경기·인천 안에서 검색해 주세요.';

const COORDINATE_TEXT_PATTERN =
  /^\s*-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\s*$/;

const CAPITAL_AREA_BOUNDS = {
  minLat: 36.85,
  maxLat: 38.35,
  minLng: 126.0,
  maxLng: 127.95,
};

const supportedAreaKeywords = ['서울특별시', '서울', '인천광역시', '인천', '경기도', '경기'];

const unsupportedAreaKeywords = [
  '부산광역시',
  '부산',
  '대구광역시',
  '대구',
  '광주광역시',
  '대전광역시',
  '대전',
  '울산광역시',
  '울산',
  '세종특별자치시',
  '세종',
  '강원특별자치도',
  '강원도',
  '강원',
  '충청북도',
  '충북',
  '충청남도',
  '충남',
  '전북특별자치도',
  '전라북도',
  '전북',
  '전라남도',
  '전남',
  '경상북도',
  '경북',
  '경상남도',
  '경남',
  '제주특별자치도',
  '제주도',
  '제주',
];

interface ServiceAreaLocation {
  title?: string;
  location?: string;
  roadAddress?: string;
  jibunAddress?: string;
  address?: string;
  coordinates?: Coordinates | null;
}

function normalizeRegionText(value: string) {
  return value.replace(/\s+/g, '').trim();
}

function includesAnyKeyword(value: string, keywords: string[]) {
  const normalized = normalizeRegionText(value);

  return keywords.some((keyword) => normalized.includes(normalizeRegionText(keyword)));
}

function getAddressAreaSupport(value: string) {
  if (!value.trim()) {
    return null as boolean | null;
  }

  if (includesAnyKeyword(value, supportedAreaKeywords)) {
    return true;
  }

  if (includesAnyKeyword(value, unsupportedAreaKeywords)) {
    return false;
  }

  return null as boolean | null;
}

export function isCoordinateText(value?: string | null) {
  return COORDINATE_TEXT_PATTERN.test(value?.trim() ?? '');
}

export function getSafeLocationLabel(value?: string | null, fallback = '선택한 위치') {
  const trimmed = value?.trim() ?? '';

  if (!trimmed || isCoordinateText(trimmed)) {
    return fallback;
  }

  return trimmed;
}

export function getAddressResultLocationLabel(result: {
  title?: string;
  roadAddress?: string;
  jibunAddress?: string;
}) {
  return (
    getSafeLocationLabel(result.title, '') ||
    getSafeLocationLabel(result.roadAddress, '') ||
    getSafeLocationLabel(result.jibunAddress, '') ||
    '선택한 위치'
  );
}

export function isWithinCapitalAreaBounds(coordinates?: Coordinates | null) {
  if (!coordinates) {
    return false;
  }

  return (
    coordinates.lat >= CAPITAL_AREA_BOUNDS.minLat &&
    coordinates.lat <= CAPITAL_AREA_BOUNDS.maxLat &&
    coordinates.lng >= CAPITAL_AREA_BOUNDS.minLng &&
    coordinates.lng <= CAPITAL_AREA_BOUNDS.maxLng
  );
}

export function looksLikeUnsupportedServiceAreaQuery(query: string) {
  const trimmed = query.trim();

  if (!trimmed || includesAnyKeyword(trimmed, supportedAreaKeywords)) {
    return false;
  }

  return includesAnyKeyword(trimmed, unsupportedAreaKeywords);
}

export function isSupportedServiceAreaLocation(location: ServiceAreaLocation) {
  const addressSupport = getAddressAreaSupport(
    [location.roadAddress, location.jibunAddress, location.address].filter(Boolean).join(' '),
  );

  if (addressSupport !== null) {
    return addressSupport;
  }

  if (location.coordinates) {
    return isWithinCapitalAreaBounds(location.coordinates);
  }

  const labelSupport = getAddressAreaSupport(
    [location.title, location.location].filter(Boolean).join(' '),
  );

  return labelSupport ?? true;
}

export function filterSupportedServiceAreaResults<T extends ServiceAreaLocation>(results: T[]) {
  return results.filter((result) => isSupportedServiceAreaLocation(result));
}
