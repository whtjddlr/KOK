import { Candidate, MeetCategoryKey, MeetingRoom, Participant } from '../types';
import { getSupabasePublicClient, isSupabaseConfigured } from './supabase';

interface MeetingRoomRow {
  id: string;
  code: string;
  owner_id: string | null;
  draw_controller_id?: string | null;
  redraw_votes?: unknown;
  redraw_requested_at?: string | null;
  selected_category: string | null;
  selected_candidate: Candidate | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

interface RoomParticipantRow {
  id: string;
  room_id: string;
  created_by: string | null;
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  max_travel_time: number | null;
  location_source: string | null;
  travel_mode?: string | null;
  saved_friend_id: string | null;
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_ROOM_SELECT =
  'id, code, owner_id, selected_category, selected_candidate, status, created_at, updated_at';
const CONTROL_ROOM_SELECT = `${BASE_ROOM_SELECT}, draw_controller_id, redraw_votes, redraw_requested_at`;
const BASE_PARTICIPANT_SELECT =
  'id, room_id, created_by, name, location, latitude, longitude, max_travel_time, location_source, saved_friend_id';
const PARTICIPANT_WITH_MODE_SELECT = `${BASE_PARTICIPANT_SELECT}, travel_mode`;
const LOCAL_PARTICIPANTS_KEY_PREFIX = 'randommeet.room.participants.';

let canUseRoomControlColumns: boolean | null = null;
let canUseParticipantTravelModeColumn: boolean | null = null;

function normalizeNullableUuid(value?: string | null) {
  const trimmed = value?.trim();

  return trimmed && UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function getClientOrThrow() {
  const supabase = getSupabasePublicClient();

  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Supabase 연결이 필요합니다.');
  }

  return supabase;
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getLocalParticipantStorageKey(roomId: string) {
  return `${LOCAL_PARTICIPANTS_KEY_PREFIX}${roomId}`;
}

function isMissingRoomControlColumnError(error: unknown) {
  const message =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';

  return (
    message.includes('draw_controller_id') ||
    message.includes('redraw_votes') ||
    message.includes('redraw_requested_at')
  );
}

function isMissingParticipantTravelModeColumnError(error: unknown) {
  const message =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';

  return message.includes('travel_mode');
}

function getRoomSelectColumns() {
  return canUseRoomControlColumns === false ? BASE_ROOM_SELECT : CONTROL_ROOM_SELECT;
}

function getParticipantSelectColumns() {
  return canUseParticipantTravelModeColumn === false
    ? BASE_PARTICIPANT_SELECT
    : PARTICIPANT_WITH_MODE_SELECT;
}

function normalizeRedrawVotes(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function createRoomCode() {
  const values = new Uint32Array(ROOM_CODE_LENGTH);

  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(values);
  } else {
    values.forEach((_, index) => {
      values[index] = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    });
  }

  return Array.from(values)
    .map((value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length])
    .join('');
}

function normalizeCategory(category: string | null | undefined): MeetCategoryKey {
  const knownCategories: MeetCategoryKey[] = [
    'dining',
    'cafe',
    'drink',
    'date',
    'culture',
    'activity',
  ];

  return knownCategories.includes(category as MeetCategoryKey)
    ? (category as MeetCategoryKey)
    : 'dining';
}

function mapRoom(row: MeetingRoomRow): MeetingRoom {
  return {
    id: row.id,
    code: row.code,
    ownerId: row.owner_id,
    drawControllerId: row.draw_controller_id ?? null,
    redrawVotes: normalizeRedrawVotes(row.redraw_votes),
    redrawRequestedAt: row.redraw_requested_at ?? null,
    selectedCategory: normalizeCategory(row.selected_category),
    selectedCandidate: row.selected_candidate ?? null,
    status: row.status === 'decided' ? 'decided' : 'planning',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapParticipant(row: RoomParticipantRow): Participant {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    coordinates: {
      lat: Number(row.latitude),
      lng: Number(row.longitude),
    },
    maxTravelTime: Number(row.max_travel_time) || 45,
    travelMode: row.travel_mode === 'car' ? 'car' : 'transit',
    locationSource:
      row.location_source === 'current' ||
      row.location_source === 'address' ||
      row.location_source === 'map' ||
      row.location_source === 'station'
        ? row.location_source
        : undefined,
    savedFriendId: row.saved_friend_id ?? undefined,
    createdBy: row.created_by,
  };
}

export function isOnlineRoomsAvailable() {
  return isSupabaseConfigured();
}

export function rememberLocalRoomParticipant(roomId: string, participantId: string) {
  if (!canUseStorage() || !roomId || !participantId) {
    return;
  }

  const current = getLocalRoomParticipantIds(roomId);
  const next = current.includes(participantId) ? current : [...current, participantId];
  window.localStorage.setItem(getLocalParticipantStorageKey(roomId), JSON.stringify(next));
}

export function forgetLocalRoomParticipant(roomId: string, participantId: string) {
  if (!canUseStorage() || !roomId || !participantId) {
    return;
  }

  const next = getLocalRoomParticipantIds(roomId).filter((id) => id !== participantId);
  window.localStorage.setItem(getLocalParticipantStorageKey(roomId), JSON.stringify(next));
}

export function getLocalRoomParticipantIds(roomId: string) {
  if (!canUseStorage() || !roomId) {
    return [] as string[];
  }

  try {
    const raw = window.localStorage.getItem(getLocalParticipantStorageKey(roomId));
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
  } catch {
    return [] as string[];
  }
}

export function getParticipantActorKey(participant: Participant) {
  return participant.createdBy || participant.id;
}

export function getPreferredDrawControllerId(
  participants: Participant[],
  ownerId?: string | null,
) {
  if (!participants.length) {
    return null;
  }

  if (ownerId) {
    const ownerParticipant = participants.find((participant) => participant.createdBy === ownerId);

    if (ownerParticipant) {
      return ownerId;
    }
  }

  return getParticipantActorKey(participants[0]);
}

export function getCurrentRoomActorIds(input: {
  roomId?: string | null;
  currentUserId?: string | null;
  participants: Participant[];
}) {
  const actorIds = new Set<string>();

  if (
    input.currentUserId &&
    input.participants.some((participant) => participant.createdBy === input.currentUserId)
  ) {
    actorIds.add(input.currentUserId);
  }

  if (input.roomId) {
    const participantIds = new Set(input.participants.map((participant) => participant.id));
    getLocalRoomParticipantIds(input.roomId)
      .filter((participantId) => participantIds.has(participantId))
      .forEach((participantId) => actorIds.add(participantId));
  }

  return [...actorIds];
}

export function getRedrawRequiredVotes(participantCount: number) {
  return Math.max(1, Math.floor(participantCount / 2) + 1);
}

export function getRoomShareUrl(code: string) {
  if (typeof window === 'undefined') {
    return `?room=${encodeURIComponent(code)}`;
  }

  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  return url.toString();
}

export async function createMeetingRoom(input: {
  ownerId?: string | null;
  selectedCategory: MeetCategoryKey;
}) {
  const supabase = getClientOrThrow();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = createRoomCode();
    const { data, error } = await supabase
      .from('meeting_rooms')
      .insert({
        code,
        owner_id: normalizeNullableUuid(input.ownerId),
        selected_category: input.selectedCategory,
      })
      .select(BASE_ROOM_SELECT)
      .single();

    if (!error && data) {
      return mapRoom(data as MeetingRoomRow);
    }

    lastError = error;
  }

  throw lastError ?? new Error('약속방을 만들지 못했습니다.');
}

export async function loadMeetingRoomByCode(code: string) {
  const supabase = getClientOrThrow();
  const normalizedCode = code.trim().toUpperCase();

  const loadRoom = (columns: string) =>
    supabase
      .from('meeting_rooms')
      .select(columns)
      .eq('code', normalizedCode)
      .maybeSingle();

  let { data, error } = await loadRoom(getRoomSelectColumns());

  if (error && canUseRoomControlColumns !== false && isMissingRoomControlColumnError(error)) {
    canUseRoomControlColumns = false;
    ({ data, error } = await loadRoom(BASE_ROOM_SELECT));
  } else if (!error && canUseRoomControlColumns !== false) {
    canUseRoomControlColumns = true;
  }

  if (error) {
    throw error;
  }

  return data ? mapRoom(data as MeetingRoomRow) : null;
}

export async function loadRoomParticipants(roomId: string) {
  const supabase = getClientOrThrow();

  const loadParticipants = (columns: string) =>
    supabase
      .from('meeting_room_participants')
      .select(columns)
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
  let { data, error } = await loadParticipants(getParticipantSelectColumns());

  if (
    error &&
    canUseParticipantTravelModeColumn !== false &&
    isMissingParticipantTravelModeColumnError(error)
  ) {
    canUseParticipantTravelModeColumn = false;
    ({ data, error } = await loadParticipants(BASE_PARTICIPANT_SELECT));
  } else if (!error && canUseParticipantTravelModeColumn !== false) {
    canUseParticipantTravelModeColumn = true;
  }

  if (error) {
    throw error;
  }

  return Array.isArray(data)
    ? (data as RoomParticipantRow[]).map((participant) => mapParticipant(participant))
    : [];
}

export async function addRoomParticipant(input: {
  roomId: string;
  participant: Participant;
  userId?: string | null;
}) {
  const supabase = getClientOrThrow();
  const { participant } = input;

  const basePayload = {
      id: participant.id,
      room_id: input.roomId,
      created_by: normalizeNullableUuid(input.userId ?? participant.createdBy),
      name: participant.name,
      location: participant.location,
      latitude: participant.coordinates.lat,
      longitude: participant.coordinates.lng,
      max_travel_time: participant.maxTravelTime,
      location_source: participant.locationSource ?? null,
      saved_friend_id: participant.savedFriendId ?? null,
  };
  const payload =
    canUseParticipantTravelModeColumn === false
      ? basePayload
      : {
          ...basePayload,
          travel_mode: participant.travelMode ?? 'transit',
        };
  let { error } = await supabase
    .from('meeting_room_participants')
    .upsert(payload, { onConflict: 'id' });

  if (
    error &&
    canUseParticipantTravelModeColumn !== false &&
    isMissingParticipantTravelModeColumnError(error)
  ) {
    canUseParticipantTravelModeColumn = false;
    ({ error } = await supabase
      .from('meeting_room_participants')
      .upsert(basePayload, { onConflict: 'id' }));
  } else if (!error && canUseParticipantTravelModeColumn !== false) {
    canUseParticipantTravelModeColumn = true;
  }

  if (error) {
    throw error;
  }
}

export async function removeRoomParticipant(roomId: string, participantId: string) {
  const supabase = getClientOrThrow();
  const { error } = await supabase
    .from('meeting_room_participants')
    .delete()
    .eq('room_id', roomId)
    .eq('id', participantId);

  if (error) {
    throw error;
  }
}

export async function updateRoomSelection(input: {
  roomId: string;
  selectedCategory: MeetCategoryKey;
  selectedCandidate: Candidate;
}) {
  const supabase = getClientOrThrow();
  const controlReset =
    canUseRoomControlColumns === false
      ? {}
      : {
          redraw_votes: [],
          redraw_requested_at: null,
        };
  let { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      selected_category: input.selectedCategory,
      selected_candidate: input.selectedCandidate,
      status: 'decided',
      updated_at: new Date().toISOString(),
      ...controlReset,
    })
    .eq('id', input.roomId)
    .select(getRoomSelectColumns())
    .single();

  if (error && canUseRoomControlColumns !== false && isMissingRoomControlColumnError(error)) {
    canUseRoomControlColumns = false;
    ({ data, error } = await supabase
      .from('meeting_rooms')
      .update({
        selected_category: input.selectedCategory,
        selected_candidate: input.selectedCandidate,
        status: 'decided',
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.roomId)
      .select(BASE_ROOM_SELECT)
      .single());
  }

  if (error) {
    throw error;
  }

  return mapRoom(data as MeetingRoomRow);
}

export async function resetRoomSelection(input: {
  roomId: string;
  selectedCategory: MeetCategoryKey;
}) {
  const supabase = getClientOrThrow();
  const controlReset =
    canUseRoomControlColumns === false
      ? {}
      : {
          redraw_votes: [],
          redraw_requested_at: null,
        };
  let { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      selected_category: input.selectedCategory,
      selected_candidate: null,
      status: 'planning',
      updated_at: new Date().toISOString(),
      ...controlReset,
    })
    .eq('id', input.roomId)
    .select(getRoomSelectColumns())
    .single();

  if (error && canUseRoomControlColumns !== false && isMissingRoomControlColumnError(error)) {
    canUseRoomControlColumns = false;
    ({ data, error } = await supabase
      .from('meeting_rooms')
      .update({
        selected_category: input.selectedCategory,
        selected_candidate: null,
        status: 'planning',
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.roomId)
      .select(BASE_ROOM_SELECT)
      .single());
  }

  if (error) {
    throw error;
  }

  return mapRoom(data as MeetingRoomRow);
}

export async function updateRoomDrawController(input: {
  roomId: string;
  drawControllerId: string;
}) {
  if (canUseRoomControlColumns === false) {
    return null as MeetingRoom | null;
  }

  const supabase = getClientOrThrow();
  const { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      draw_controller_id: input.drawControllerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.roomId)
    .select(CONTROL_ROOM_SELECT)
    .single();

  if (error) {
    if (isMissingRoomControlColumnError(error)) {
      canUseRoomControlColumns = false;
      return null;
    }

    throw error;
  }

  canUseRoomControlColumns = true;
  return mapRoom(data as MeetingRoomRow);
}

export async function requestRoomRedrawVote(input: {
  room: MeetingRoom;
  voterId: string;
}) {
  if (canUseRoomControlColumns === false) {
    throw new Error('다시뽑기 투표 컬럼이 아직 DB에 없어요. supabase/schema.sql을 실행해 주세요.');
  }

  const supabase = getClientOrThrow();
  const nextVotes = [...new Set([...input.room.redrawVotes, input.voterId])];
  const { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      redraw_votes: nextVotes,
      redraw_requested_at: input.room.redrawRequestedAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.room.id)
    .select(CONTROL_ROOM_SELECT)
    .single();

  if (error) {
    if (isMissingRoomControlColumnError(error)) {
      canUseRoomControlColumns = false;
      throw new Error('다시뽑기 투표 컬럼이 아직 DB에 없어요. supabase/schema.sql을 실행해 주세요.');
    }

    throw error;
  }

  canUseRoomControlColumns = true;
  return mapRoom(data as MeetingRoomRow);
}

export function subscribeToRoomParticipants(
  roomId: string,
  onChange: (participants: Participant[]) => void,
  onError?: (message: string) => void,
) {
  const supabase = getSupabasePublicClient();

  if (!supabase) {
    return () => {};
  }

  const reloadParticipants = () => {
    void loadRoomParticipants(roomId)
      .then(onChange)
      .catch((error: Error) => onError?.(error.message));
  };

  const channel = supabase
    .channel(`room-participants-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'meeting_room_participants',
        filter: `room_id=eq.${roomId}`,
      },
      reloadParticipants,
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToRoomState(
  roomId: string,
  onChange: (room: MeetingRoom) => void,
  onError?: (message: string) => void,
) {
  const supabase = getSupabasePublicClient();

  if (!supabase) {
    return () => {};
  }

  const channel = supabase
    .channel(`room-state-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'meeting_rooms',
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        try {
          onChange(mapRoom(payload.new as MeetingRoomRow));
        } catch (error) {
          onError?.(error instanceof Error ? error.message : '방 상태를 읽지 못했습니다.');
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
