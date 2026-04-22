import { Candidate, Participant, TravelInfo } from '../types';

interface DirectionsSummary {
  distance?: number;
  duration?: number;
  tollFare?: number;
  taxiFare?: number;
  fuelPrice?: number;
}

interface DirectionsRoute {
  summary?: DirectionsSummary;
}

interface DirectionsResponse {
  code?: number;
  message?: string;
  error?: {
    errorCode?: string;
    message?: string;
    details?: string;
  };
  route?: Record<string, DirectionsRoute[]>;
}

const directionsCache = new Map<string, TravelInfo>();

function toLngLat(lat: number, lng: number) {
  return `${lng},${lat}`;
}

function getCacheKey(participant: Participant, candidate: Candidate) {
  return `${participant.id}:${candidate.id}`;
}

function getFirstRoute(payload: DirectionsResponse) {
  const routeGroups = payload.route ? Object.values(payload.route) : [];

  for (const routes of routeGroups) {
    if (routes?.length) {
      return routes[0];
    }
  }

  return null;
}

async function getErrorMessage(response: Response) {
  const fallback = `네이버 경로 API 호출에 실패했습니다. (${response.status})`;

  try {
    const payload = (await response.json()) as DirectionsResponse;
    if (payload.error?.details) {
      return `${fallback} ${payload.error.message ?? '오류'} - ${payload.error.details}`;
    }

    if (payload.error?.message) {
      return `${fallback} ${payload.error.message}`;
    }

    return payload.message ? `${fallback} ${payload.message}` : fallback;
  } catch {
    return fallback;
  }
}

export async function fetchDirectionsTravelInfo(
  participant: Participant,
  candidate: Candidate,
): Promise<TravelInfo> {
  const cacheKey = getCacheKey(participant, candidate);
  const cached = directionsCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const url = new URL('/api/naver/directions', window.location.origin);
  url.searchParams.set(
    'start',
    toLngLat(participant.coordinates.lat, participant.coordinates.lng),
  );
  url.searchParams.set('goal', toLngLat(candidate.coordinates.lat, candidate.coordinates.lng));
  url.searchParams.set('option', 'traoptimal');

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const payload = (await response.json()) as DirectionsResponse;
  const route = getFirstRoute(payload);

  if (!route?.summary) {
    throw new Error(payload.message || '실시간 경로 응답에 summary가 없습니다.');
  }

  const {
    distance = 0,
    duration = 0,
    tollFare = 0,
    taxiFare = 0,
    fuelPrice = 0,
  } = route.summary;

  const travelInfo: TravelInfo = {
    participantId: participant.id,
    participantName: participant.name,
    distance: Math.round((distance / 1000) * 10) / 10,
    duration: Math.max(1, Math.round(duration / 60000)),
    cost: Math.max(0, tollFare + fuelPrice),
    source: 'directions',
    tollFare,
    taxiFare,
    fuelPrice,
  };

  directionsCache.set(cacheKey, travelInfo);
  return travelInfo;
}
