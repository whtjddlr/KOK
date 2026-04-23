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

  if (!window.naver?.maps?.Service?.geocode) {
    throw new Error('주소 검색 모듈을 아직 사용할 수 없어요. geocoder 설정을 확인해 주세요.');
  }

  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [] as AddressSearchResult[];
  }

  return new Promise<AddressSearchResult[]>((resolve, reject) => {
    window.naver.maps.Service.geocode(
      {
        query: trimmedQuery,
      },
      (status: string, response: any) => {
        if (status !== maps.Service.Status.OK) {
          reject(new Error('주소를 찾지 못했어요. 다른 주소로 다시 검색해 주세요.'));
          return;
        }

        const addresses = Array.isArray(response?.v2?.addresses) ? response.v2.addresses : [];

        resolve(
          addresses
            .map((item: any) => ({
              roadAddress: item?.roadAddress ?? '',
              jibunAddress: item?.jibunAddress ?? '',
              title: item?.roadAddress || item?.jibunAddress || trimmedQuery,
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

export async function reverseGeocodeCoordinates(lat: number, lng: number) {
  const maps = await loadNaverMapSdk();

  if (!window.naver?.maps?.Service?.reverseGeocode) {
    throw new Error('좌표를 주소로 바꾸는 기능을 아직 사용할 수 없어요.');
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
          title: roadAddress || jibunAddress || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        });
      },
    );
  });
}
