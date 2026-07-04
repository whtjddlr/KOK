import {
  Candidate,
  Participant,
  RouteSnapshotStatus,
  TravelInfo,
  WinnerRouteSnapshot,
} from '../types';
import { getCarTravelInfo, getTravelInfo } from './meeting';
import { fetchDirectionsTravelInfo } from './naver-directions';
import { fetchOdsayTransitTravelInfo, getTransitServicePeriodKey } from './odsay-transit';

function getReasonMessage(reason: unknown) {
  if (reason instanceof Error && reason.message) {
    return reason.message.replace(/ODsay\s*/g, '');
  }

  if (
    reason &&
    typeof reason === 'object' &&
    'message' in reason &&
    typeof (reason as { message?: unknown }).message === 'string'
  ) {
    return (reason as { message: string }).message.replace(/ODsay\s*/g, '');
  }

  return null;
}

export function getFirstRouteError(results: PromiseSettledResult<TravelInfo>[]) {
  for (const result of results) {
    if (result.status === 'rejected') {
      const message = getReasonMessage(result.reason);

      if (message) {
        return message;
      }
    }
  }

  return null;
}

function isTransitNoRouteMessage(message: string | null) {
  return Boolean(
    message?.includes('대중교통 경로를 찾지 못했습니다') ||
      message?.includes('대중교통 경로 응답에 추천 경로가 없습니다'),
  );
}

function getFallbackMessage(
  message: string | null,
  partial: boolean,
  fallbackLabel: string,
  fullErrorLabel?: string,
) {
  if (message) {
    return partial ? '일부 경로는 예상이에요.' : (fullErrorLabel ?? message);
  }

  return partial ? '일부 경로는 예상이에요.' : fallbackLabel;
}

export function getTransitFallbackMessage(
  message: string | null,
  partial: boolean,
  exposeFullError = true,
) {
  if (isTransitNoRouteMessage(message)) {
    return partial ? '일부 경로는 예상이에요.' : '대중교통은 예상이에요.';
  }

  return getFallbackMessage(
    message,
    partial,
    '대중교통은 예상이에요.',
    exposeFullError ? undefined : '대중교통은 예상이에요.',
  );
}

export function getEstimatedRouteFallbackMessage(message: string | null, partial: boolean) {
  if (isTransitNoRouteMessage(message)) {
    return partial ? '일부 경로는 예상이에요.' : '대중교통은 예상이에요.';
  }

  return getFallbackMessage(message, partial, '예상 경로예요.', '예상 경로예요.');
}

function getCarFallbackMessage(message: string | null, partial: boolean) {
  return getFallbackMessage(message, partial, '자동차는 예상이에요.');
}

function getSnapshotStatus(liveCount: number, totalCount: number): RouteSnapshotStatus {
  if (!liveCount) {
    return 'error';
  }

  return liveCount === totalCount ? 'ready' : 'partial';
}

function mergeRouteResults(
  results: PromiseSettledResult<TravelInfo>[],
  fallbackTravelInfo: TravelInfo[],
  liveSource: TravelInfo['source'],
) {
  const merged = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    return fallbackTravelInfo[index];
  });
  const liveCount = merged.filter((item) => item.source === liveSource).length;

  return {
    merged,
    liveCount,
    firstRouteError: getFirstRouteError(results),
  };
}

export function getParticipantRouteSignature(participants: Participant[]) {
  return participants
    .map((participant) =>
      [
        participant.id,
        participant.coordinates.lat.toFixed(6),
        participant.coordinates.lng.toFixed(6),
        participant.travelMode ?? 'transit',
      ].join(':'),
    )
    .sort()
    .join('|');
}

function isTravelInfo(value: unknown): value is TravelInfo {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as TravelInfo).participantId === 'string' &&
    typeof (value as TravelInfo).participantName === 'string' &&
    typeof (value as TravelInfo).duration === 'number' &&
    typeof (value as TravelInfo).distance === 'number' &&
    typeof (value as TravelInfo).cost === 'number'
  );
}

function normalizeTravelInfoArray(value: unknown) {
  return Array.isArray(value) && value.every(isTravelInfo) ? value : null;
}

function normalizeSnapshotStatus(value: unknown): RouteSnapshotStatus {
  return value === 'ready' || value === 'partial' || value === 'error' ? value : 'error';
}

export function normalizeWinnerRouteSnapshot(value: unknown): WinnerRouteSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as Partial<WinnerRouteSnapshot>;
  const transitTravelInfo = normalizeTravelInfoArray(snapshot.transitTravelInfo);
  const carTravelInfo = normalizeTravelInfoArray(snapshot.carTravelInfo);

  if (
    typeof snapshot.winnerId !== 'string' ||
    typeof snapshot.participantSignature !== 'string' ||
    !transitTravelInfo ||
    !carTravelInfo
  ) {
    return null;
  }

  return {
    winnerId: snapshot.winnerId,
    participantSignature: snapshot.participantSignature,
    transitServicePeriod: snapshot.transitServicePeriod === 'night' ? 'night' : 'day',
    capturedAt:
      typeof snapshot.capturedAt === 'string' ? snapshot.capturedAt : new Date(0).toISOString(),
    transitTravelInfo,
    carTravelInfo,
    transitStatus: normalizeSnapshotStatus(snapshot.transitStatus),
    carStatus: normalizeSnapshotStatus(snapshot.carStatus),
    transitError: typeof snapshot.transitError === 'string' ? snapshot.transitError : null,
    carError: typeof snapshot.carError === 'string' ? snapshot.carError : null,
  };
}

export function isWinnerRouteSnapshotForInput(
  snapshot: WinnerRouteSnapshot | null | undefined,
  participants: Participant[],
  winner: Candidate,
) {
  return Boolean(
    snapshot &&
      snapshot.winnerId === winner.id &&
      snapshot.participantSignature === getParticipantRouteSignature(participants),
  );
}

export async function buildWinnerRouteSnapshot(
  participants: Participant[],
  winner: Candidate,
): Promise<WinnerRouteSnapshot> {
  const transitTravelInfo = participants.map((participant) => getTravelInfo(participant, winner));
  const fallbackCarTravelInfo = participants.map((participant) =>
    getCarTravelInfo(participant, winner),
  );
  const [transitResults, carResults] = await Promise.all([
    Promise.allSettled(
      participants.map((participant) => fetchOdsayTransitTravelInfo(participant, winner)),
    ),
    Promise.allSettled(
      participants.map((participant) => fetchDirectionsTravelInfo(participant, winner)),
    ),
  ]);
  const transit = mergeRouteResults(transitResults, transitTravelInfo, 'transit');
  const car = mergeRouteResults(carResults, fallbackCarTravelInfo, 'directions');
  const transitStatus = getSnapshotStatus(transit.liveCount, transit.merged.length);
  const carStatus = getSnapshotStatus(car.liveCount, car.merged.length);

  return {
    winnerId: winner.id,
    participantSignature: getParticipantRouteSignature(participants),
    transitServicePeriod: getTransitServicePeriodKey(),
    capturedAt: new Date().toISOString(),
    transitTravelInfo: transit.liveCount ? transit.merged : transitTravelInfo,
    carTravelInfo: car.liveCount ? car.merged : fallbackCarTravelInfo,
    transitStatus,
    carStatus,
    transitError:
      transitStatus === 'ready'
        ? null
        : getTransitFallbackMessage(transit.firstRouteError, transitStatus === 'partial'),
    carError:
      carStatus === 'ready'
        ? null
        : getCarFallbackMessage(car.firstRouteError, carStatus === 'partial'),
  };
}
