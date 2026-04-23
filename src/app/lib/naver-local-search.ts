import { NearbyPlaceCategory } from '../types';

interface NaverLocalSearchItemResponse {
  title?: string;
  link?: string;
  category?: string;
  description?: string;
  address?: string;
  roadAddress?: string;
}

interface NaverLocalSearchResponse {
  items?: NaverLocalSearchItemResponse[];
  message?: string;
}

export interface NearbySearchDefinition {
  key: NearbyPlaceCategory;
  label: string;
  query: string;
}

export interface NearbySearchItem {
  name: string;
  link: string;
  categoryPath: string;
  description: string;
  address: string;
  roadAddress: string;
}

export type NaverLocalSearchSort = 'random' | 'comment';

function cleanHtmlText(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchNearbySearchResults(
  query: string,
  display = 4,
  sort: NaverLocalSearchSort = 'comment',
) {
  const requestUrl = new URL('/api/naver/local-search', window.location.origin);
  requestUrl.searchParams.set('query', query);
  requestUrl.searchParams.set('display', String(display));
  requestUrl.searchParams.set('sort', sort);

  const response = await fetch(requestUrl.toString());
  const data = (await response.json()) as NaverLocalSearchResponse;

  if (!response.ok) {
    throw new Error(data.message ?? '근처 정보를 가져오지 못했습니다.');
  }

  return (data.items ?? []).map<NearbySearchItem>((item) => ({
    name: cleanHtmlText(item.title ?? ''),
    link: item.link?.trim() ?? '',
    categoryPath: cleanHtmlText(item.category ?? ''),
    description: cleanHtmlText(item.description ?? ''),
    address: cleanHtmlText(item.address ?? ''),
    roadAddress: cleanHtmlText(item.roadAddress ?? ''),
  }));
}
