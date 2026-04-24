export function buildNaverMapSearchLink(keyword: string) {
  const normalizedKeyword = keyword.trim().replace(/\s+/g, ' ');

  return `https://map.naver.com/p/search/${encodeURIComponent(normalizedKeyword)}`;
}

export function buildNaverMapReservationLink(keyword: string) {
  return buildNaverMapSearchLink(`${keyword} 예약`);
}
