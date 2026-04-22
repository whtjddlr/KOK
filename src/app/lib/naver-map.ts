let naverMapPromise: Promise<any> | null = null;

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
