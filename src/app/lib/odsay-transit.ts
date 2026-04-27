import { Candidate, Participant, TravelInfo, TravelRouteStep } from '../types';

interface OdsayLane {
  name?: string;
  busNo?: string;
}

interface OdsayStationPoint {
  x?: string | number;
  y?: string | number;
}

interface OdsaySubPath {
  trafficType?: number;
  distance?: number;
  sectionTime?: number;
  stationCount?: number;
  lane?: OdsayLane[];
  startName?: string;
  endName?: string;
  passStopList?: {
    stations?: OdsayStationPoint[];
  };
}

interface OdsayPathInfo {
  totalTime?: number;
  payment?: number;
  totalDistance?: number;
  trafficDistance?: number;
  totalWalk?: number;
  busTransitCount?: number;
  subwayTransitCount?: number;
  firstStartStation?: string;
  lastEndStation?: string;
}

interface OdsayPath {
  pathType?: number;
  info?: OdsayPathInfo;
  subPath?: OdsaySubPath[];
}

interface OdsayResponse {
  result?: {
    path?: OdsayPath[];
  };
  error?:
    | {
        code?: string | number;
        message?: string;
      }
    | Array<{
        code?: string | number;
        message?: string;
      }>;
  message?: string;
}

const transitCache = new Map<string, TravelInfo>();

function getCacheKey(participant: Participant, candidate: Candidate) {
  return [
    participant.id,
    participant.coordinates.lat.toFixed(6),
    participant.coordinates.lng.toFixed(6),
    candidate.id,
    candidate.coordinates.lat.toFixed(6),
    candidate.coordinates.lng.toFixed(6),
    getTransitServicePeriodKey(),
  ].join(':');
}

function getSeoulHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(date);
  const numericHour = Number(hour);

  return numericHour === 24 ? 0 : numericHour;
}

function isNightTransitWindow(date = new Date()) {
  const hour = getSeoulHour(date);

  return Number.isFinite(hour) && (hour >= 23 || hour < 5);
}

export function getTransitServicePeriodKey() {
  return isNightTransitWindow() ? 'night' : 'day';
}

function isNightBusLane(lane: OdsayLane) {
  const text = `${lane.name ?? ''} ${lane.busNo ?? ''}`.trim();

  return /(^|\s)N\d{2,4}\b/i.test(text) || text.includes('심야') || text.includes('올빼미');
}

function pathUsesNightBus(path: OdsayPath) {
  return (path.subPath ?? []).some(
    (step) => step.trafficType === 2 && (step.lane ?? []).some(isNightBusLane),
  );
}

function getRouteTypeLabel(trafficType?: number) {
  if (trafficType === 1) {
    return 'subway';
  }

  if (trafficType === 2) {
    return 'bus';
  }

  return 'walk';
}

function getStepLabel(step: OdsaySubPath) {
  if (step.trafficType === 1) {
    return step.lane?.[0]?.name ?? '지하철';
  }

  if (step.trafficType === 2) {
    const busNo = step.lane?.[0]?.busNo;
    return busNo ? `${busNo}번` : '버스';
  }

  return '도보';
}

function buildRouteSteps(path: OdsayPath): TravelRouteStep[] {
  return (path.subPath ?? []).map((step) => ({
    type: getRouteTypeLabel(step.trafficType),
    label: getStepLabel(step),
    duration: Math.max(0, Math.round(step.sectionTime ?? 0)),
    distance: typeof step.distance === 'number' ? Math.round(step.distance) : undefined,
    from: step.startName,
    to: step.endName,
    stationCount: step.stationCount,
  }));
}

function buildRouteSummary(steps: TravelRouteStep[]) {
  const transitSteps = steps.filter((step) => step.type !== 'walk');

  if (!transitSteps.length) {
    return '도보 중심';
  }

  return transitSteps
    .map((step) => step.label)
    .filter(Boolean)
    .slice(0, 4)
    .join(' → ');
}

function parseRoutePoint(station: OdsayStationPoint) {
  const lng = Number(station.x);
  const lat = Number(station.y);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function isSamePoint(left: { lat: number; lng: number }, right: { lat: number; lng: number }) {
  return Math.abs(left.lat - right.lat) < 0.00001 && Math.abs(left.lng - right.lng) < 0.00001;
}

function buildRoutePath(path: OdsayPath, participant: Participant, candidate: Candidate) {
  const stationPoints =
    path.subPath
      ?.flatMap((step) => step.passStopList?.stations ?? [])
      .map(parseRoutePoint)
      .filter((point): point is { lat: number; lng: number } => Boolean(point)) ?? [];
  const routePath = [participant.coordinates, ...stationPoints, candidate.coordinates];

  return routePath.filter((point, index) => index === 0 || !isSamePoint(point, routePath[index - 1]));
}

function getBestPath(paths: OdsayPath[]) {
  const candidatePaths = isNightTransitWindow()
    ? paths
    : paths.filter((path) => !pathUsesNightBus(path));

  if (!candidatePaths.length) {
    return undefined;
  }

  return [...candidatePaths].sort((left, right) => {
    const leftInfo = left.info ?? {};
    const rightInfo = right.info ?? {};
    const leftTransferCount =
      Math.max(0, (leftInfo.busTransitCount ?? 0) + (leftInfo.subwayTransitCount ?? 0) - 1);
    const rightTransferCount =
      Math.max(0, (rightInfo.busTransitCount ?? 0) + (rightInfo.subwayTransitCount ?? 0) - 1);

    return (
      (leftInfo.totalTime ?? Number.MAX_SAFE_INTEGER) +
      leftTransferCount * 4 -
      ((rightInfo.totalTime ?? Number.MAX_SAFE_INTEGER) + rightTransferCount * 4)
    );
  })[0];
}

function getOdsayErrorMessage(payload: OdsayResponse) {
  const firstError = Array.isArray(payload.error) ? payload.error[0] : payload.error;
  const code = firstError?.code ? ` (${firstError.code})` : '';

  return firstError?.message
    ? `ODsay 대중교통 경로를 찾지 못했습니다${code}. ${firstError.message}`
    : payload.message
      ? `ODsay 대중교통 경로를 찾지 못했습니다. ${payload.message}`
    : 'ODsay 대중교통 경로를 찾지 못했습니다.';
}

function parseOdsayPayload(rawBody: string): OdsayResponse {
  try {
    return JSON.parse(rawBody) as OdsayResponse;
  } catch {
    return {
      message: rawBody.trim().slice(0, 160),
    };
  }
}

export async function fetchOdsayTransitTravelInfo(
  participant: Participant,
  candidate: Candidate,
): Promise<TravelInfo> {
  const cacheKey = getCacheKey(participant, candidate);
  const cached = transitCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const url = new URL('/api/odsay/transit', window.location.origin);
  url.searchParams.set('startX', String(participant.coordinates.lng));
  url.searchParams.set('startY', String(participant.coordinates.lat));
  url.searchParams.set('endX', String(candidate.coordinates.lng));
  url.searchParams.set('endY', String(candidate.coordinates.lat));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });
  const rawBody = await response.text();
  const payload = parseOdsayPayload(rawBody);

  if (!response.ok) {
    const fallbackMessage =
      typeof (payload as { message?: string }).message === 'string'
        ? (payload as { message: string }).message
        : `ODsay API 호출에 실패했습니다. (${response.status})`;
    throw new Error(fallbackMessage);
  }

  if (payload.error) {
    throw new Error(getOdsayErrorMessage(payload));
  }

  const paths = payload.result?.path ?? [];
  const path = getBestPath(paths);
  const info = path?.info;

  if (!path || !info) {
    throw new Error('ODsay 대중교통 경로 응답에 추천 경로가 없습니다.');
  }

  const routeSteps = buildRouteSteps(path);
  const rideCount = (info.busTransitCount ?? 0) + (info.subwayTransitCount ?? 0);
  const transferCount = Math.max(0, rideCount - 1);
  const totalDistance = info.totalDistance ?? (info.trafficDistance ?? 0) + (info.totalWalk ?? 0);
  const routePath = buildRoutePath(path, participant, candidate);
  const travelInfo: TravelInfo = {
    participantId: participant.id,
    participantName: participant.name,
    distance: Math.round((totalDistance / 1000) * 10) / 10,
    cost: Math.max(0, Math.round(info.payment ?? 0)),
    duration: Math.max(1, Math.round(info.totalTime ?? 0)),
    source: 'transit',
    mode: 'transit',
    transferCount,
    walkDistance: Math.round(info.totalWalk ?? 0),
    routeSummary: buildRouteSummary(routeSteps),
    routeSteps,
    routePath,
    firstStartStation: info.firstStartStation,
    lastEndStation: info.lastEndStation,
  };

  transitCache.set(cacheKey, travelInfo);
  return travelInfo;
}
