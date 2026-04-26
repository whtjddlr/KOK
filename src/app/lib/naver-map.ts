import {
  fetchNearbySearchResults,
  type NearbySearchItem,
  type NaverLocalSearchSort,
} from './naver-local-search';

let naverMapPromise: Promise<any> | null = null;

export interface AddressSearchResult {
  roadAddress: string;
  jibunAddress: string;
  title: string;
  coordinates: {
    lat: number;
    lng: number;
  };
}

export interface ReverseGeocodeResult {
  roadAddress: string;
  jibunAddress: string;
  title: string;
}

function normalizeSearchText(value: string) {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\dA-Za-z가-힣]/g, '')
    .toLowerCase();
}

function looksLikeAddress(query: string) {
  return /\d/.test(query) && /(로|길|번길|대로|동|읍|면|리)\s*\d*/.test(query);
}

function buildPlaceSearchQueries(query: string) {
  const trimmedQuery = query.trim();
  const queries = trimmedQuery.endsWith('역')
    ? [`${trimmedQuery} 지하철역`, trimmedQuery]
    : [trimmedQuery];

  if (trimmedQuery.endsWith('역')) {
    queries.push(`${trimmedQuery} 역`);
  } else if (!/\s/.test(trimmedQuery) && trimmedQuery.length <= 12) {
    queries.push(`${trimmedQuery}역`);
  }

  return [...new Set(queries)];
}

function isStationQuery(query: string) {
  return query.trim().endsWith('역');
}

function isTransitCategory(category: string) {
  return category.includes('지하철') || category.includes('전철') || category.includes('교통');
}

function isStationExit(place: NearbySearchItem) {
  const title = normalizeSearchText(place.name);
  const category = normalizeSearchText(place.categoryPath);

  return title.includes('출구') || category.includes('출구번호');
}

function getPlaceSearchScore(place: NearbySearchItem, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(place.name);
  const category = normalizeSearchText(place.categoryPath);
  const address = normalizeSearchText(`${place.roadAddress} ${place.address}`);
  const queryWithoutStationSuffix = normalizedQuery.replace(/역$/, '');
  const stationQuery = isStationQuery(query);
  const transitCategory = isTransitCategory(category);
  let score = 0;

  if (title === normalizedQuery) {
    score += 1000;
  } else if (title.startsWith(normalizedQuery)) {
    score += 760;
  } else if (title.includes(normalizedQuery)) {
    score += 520;
  }

  if (
    stationQuery &&
    queryWithoutStationSuffix &&
    title.includes(queryWithoutStationSuffix) &&
    (title.includes('역') || transitCategory)
  ) {
    score += 260;
  }

  if (transitCategory) {
    score += stationQuery ? 180 : 24;
  }

  if (stationQuery && isStationExit(place)) {
    score -= 80;
  }

  if (stationQuery && !title.includes(normalizedQuery) && transitCategory) {
    score -= 220;
  }

  if (stationQuery && !title.includes(normalizedQuery) && !transitCategory) {
    score -= 160;
  }

  if (address.includes(normalizedQuery)) {
    score += stationQuery ? 4 : 8;
  }

  return score;
}

function getSearchSortsForQuery(query: string): NaverLocalSearchSort[] {
  return isStationQuery(query) ? ['random', 'comment'] : ['random'];
}

function getPlaceResultKey(place: NearbySearchItem) {
  const coordinateKey = place.coordinates
    ? `${place.coordinates.lat.toFixed(7)},${place.coordinates.lng.toFixed(7)}`
    : normalizeSearchText(`${place.roadAddress} ${place.address}`);

  return `${normalizeSearchText(place.name)}-${coordinateKey}`;
}

function getScriptUrl() {
  const keyId = import.meta.env.VITE_NAVER_MAP_KEY_ID;
  const submodules = import.meta.env.VITE_NAVER_MAP_SUBMODULES?.trim();

  if (!keyId) {
    throw new Error('네이버 지도 Key ID가 없습니다. .env의 VITE_NAVER_MAP_KEY_ID를 확인해 주세요.');
  }

  const url = new URL('https://oapi.map.naver.com/openapi/v3/maps.js');
  url.searchParams.set('ncpKeyId', keyId);
  url.searchParams.set('callback', '__naverMapsInit');

  if (submodules) {
    url.searchParams.set('submodules', submodules);
  }

  return url.toString();
}

function getLoadedMaps() {
  if (window.naver?.maps?.Map) {
    return window.naver.maps;
  }

  return null;
}

export function loadNaverMapSdk() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('브라우저 환경에서만 네이버 지도를 불러올 수 있습니다.'));
  }

  const loadedMaps = getLoadedMaps();
  if (loadedMaps) {
    return Promise.resolve(loadedMaps);
  }

  if (naverMapPromise) {
    return naverMapPromise;
  }

  naverMapPromise = new Promise((resolve, reject) => {
    let settled = false;
    const existingScript = document.querySelector(
      'script[data-naver-map-sdk="true"]',
    ) as HTMLScriptElement | null;

    const cleanup = () => {
      delete window.__naverMapsInit;
      delete window.navermap_authFailure;
    };

    const finishError = (message: string) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      naverMapPromise = null;
      reject(new Error(message));
    };

    const finishSuccess = () => {
      if (settled) {
        return;
      }

      const maps = getLoadedMaps();
      if (!maps) {
        finishError('네이버 지도 초기화 응답이 도착하지 않았습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      resolve(maps);
    };

    const timeoutId = window.setTimeout(() => {
      finishError(
        '네이버 지도 로딩이 지연되고 있습니다. Web 서비스 URL과 네트워크 상태를 확인해 주세요.',
      );
    }, 12000);

    window.navermap_authFailure = () => {
      finishError(
        '네이버 지도 인증에 실패했습니다. Web 서비스 URL과 VITE_NAVER_MAP_KEY_ID를 다시 확인해 주세요.',
      );
    };

    window.__naverMapsInit = () => {
      finishSuccess();
    };

    if (existingScript) {
      const maps = getLoadedMaps();
      if (maps) {
        settled = true;
        window.clearTimeout(timeoutId);
        cleanup();
        resolve(maps);
        return;
      }

      existingScript.addEventListener('load', finishSuccess, { once: true });
      existingScript.addEventListener(
        'error',
        () => {
          finishError('네이버 지도 SDK를 불러오지 못했습니다. 네트워크 상태를 확인해 주세요.');
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = getScriptUrl();
    script.async = true;
    script.defer = true;
    script.dataset.naverMapSdk = 'true';
    script.addEventListener('load', finishSuccess, { once: true });
    script.addEventListener(
      'error',
      () => {
        finishError('네이버 지도 SDK를 불러오지 못했습니다. 네트워크 상태를 확인해 주세요.');
      },
      { once: true },
    );

    document.head.appendChild(script);
  });

  return naverMapPromise;
}

export async function searchAddress(query: string) {
  const maps = await loadNaverMapSdk();
  const canGeocode = Boolean(window.naver?.maps?.Service?.geocode);

  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [] as AddressSearchResult[];
  }

  if (canGeocode && looksLikeAddress(trimmedQuery)) {
    const addressFirstResults = await geocodeQuery(maps, trimmedQuery);

    if (addressFirstResults.length) {
      return addressFirstResults;
    }
  }

  const placeResults = await searchPlaceNameAsAddress(maps, trimmedQuery);

  if (placeResults.length) {
    return placeResults;
  }

  if (!canGeocode) {
    throw new Error('주소 검색 모듈을 아직 사용할 수 없어요. 현재 위치 또는 장소명으로 다시 시도해 주세요.');
  }

  const geocodeResults = await geocodeQuery(maps, trimmedQuery);

  if (geocodeResults.length) {
    return geocodeResults;
  }

  return [];
}

function geocodeQuery(maps: any, query: string) {
  return new Promise<AddressSearchResult[]>((resolve, reject) => {
    window.naver.maps.Service.geocode(
      {
        query,
      },
      (status: string, response: any) => {
        if (status !== maps.Service.Status.OK) {
          resolve([]);
          return;
        }

        const addresses = Array.isArray(response?.v2?.addresses) ? response.v2.addresses : [];

        resolve(
          addresses
            .map((item: any) => ({
              roadAddress: item?.roadAddress ?? '',
              jibunAddress: item?.jibunAddress ?? '',
              title: item?.roadAddress || item?.jibunAddress || query,
              coordinates: {
                lat: Number(item?.y),
                lng: Number(item?.x),
              },
            }))
            .filter(
              (item: AddressSearchResult) =>
                Number.isFinite(item.coordinates.lat) && Number.isFinite(item.coordinates.lng),
            ),
        );
      },
    );
  });
}

async function searchPlaceNameAsAddress(maps: any, query: string) {
  try {
    const placeGroups = await Promise.all(
      buildPlaceSearchQueries(query).flatMap((searchQuery, queryIndex) =>
        getSearchSortsForQuery(query).map(async (sort, sortIndex) => {
          const places = await fetchNearbySearchResults(searchQuery, 10, sort);
          return places.map((place, resultIndex) => ({
            place,
            score: getPlaceSearchScore(place, query),
            queryIndex,
            sortIndex,
            resultIndex,
          }));
        }),
      ),
    );
    const rankedPlaces = placeGroups
      .flat()
      .filter(({ score }) => score > -100)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.queryIndex - right.queryIndex ||
          left.sortIndex - right.sortIndex ||
          left.resultIndex - right.resultIndex,
      );
    const seenPlaceKeys = new Set<string>();
    const places = rankedPlaces
      .filter(({ place }) => {
        const key = getPlaceResultKey(place);

        if (seenPlaceKeys.has(key)) {
          return false;
        }

        seenPlaceKeys.add(key);
        return true;
      })
      .slice(0, 6)
      .map(({ place }) => place);
    const mappedResults = await Promise.all(
      places.map(async (place) => {
        const addressQuery = place.roadAddress || place.address || place.name;
        const localCoordinates = place.coordinates;

        if (localCoordinates) {
          return {
            roadAddress: place.roadAddress,
            jibunAddress: place.address,
            title: place.name,
            coordinates: localCoordinates,
          } satisfies AddressSearchResult;
        }

        if (!addressQuery) {
          return null;
        }

        const geocoded = await geocodeQuery(maps, addressQuery);
        const first = geocoded[0];

        if (!first) {
          return null;
        }

        return {
          roadAddress: place.roadAddress || first.roadAddress,
          jibunAddress: place.address || first.jibunAddress,
          title: place.name || first.title,
          coordinates: first.coordinates,
        } satisfies AddressSearchResult;
      }),
    );

    const deduped = new Map<string, AddressSearchResult>();

    mappedResults.forEach((result) => {
      if (!result) {
        return;
      }

      const key = `${result.title}-${result.coordinates.lat.toFixed(6)}-${result.coordinates.lng.toFixed(6)}`;
      deduped.set(key, result);
    });

    return [...deduped.values()];
  } catch {
    return [] as AddressSearchResult[];
  }
}

export async function reverseGeocodeCoordinates(lat: number, lng: number) {
  const maps = await loadNaverMapSdk();

  if (!window.naver?.maps?.Service?.reverseGeocode) {
    throw new Error('선택한 위치의 주소를 아직 확인할 수 없어요.');
  }

  return new Promise<ReverseGeocodeResult>((resolve, reject) => {
    window.naver.maps.Service.reverseGeocode(
      {
        location: new maps.LatLng(lat, lng),
      },
      (status: string, response: any) => {
        if (status !== maps.Service.Status.OK) {
          reject(new Error('선택한 위치의 주소를 찾지 못했어요.'));
          return;
        }

        const addresses = Array.isArray(response?.v2?.results)
          ? response.v2.results
          : Array.isArray(response?.result?.items)
            ? response.result.items
            : [];
        const roadResult = addresses.find((item: any) => item?.name === 'roadaddr');
        const jibunResult = addresses.find((item: any) => item?.name === 'addr');

        const roadAddress = [
          roadResult?.region?.area1?.name,
          roadResult?.region?.area2?.name,
          roadResult?.region?.area3?.name,
          roadResult?.land?.name,
          roadResult?.land?.number1,
          roadResult?.land?.number2,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();

        const jibunAddress = [
          jibunResult?.region?.area1?.name,
          jibunResult?.region?.area2?.name,
          jibunResult?.region?.area3?.name,
          jibunResult?.land?.name,
          jibunResult?.land?.number1,
          jibunResult?.land?.number2,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();

        resolve({
          roadAddress,
          jibunAddress,
          title: roadAddress || jibunAddress || '선택한 위치',
        });
      },
    );
  });
}
