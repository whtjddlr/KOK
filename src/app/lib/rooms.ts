import { Candidate, MeetCategoryKey, MeetingRoom, Participant } from '../types';
import { getSupabaseBrowserClient, isSupabaseConfigured } from './supabase';

interface MeetingRoomRow {
  id: string;
  code: string;
  owner_id: string | null;
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
  saved_friend_id: string | null;
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeNullableUuid(value?: string | null) {
  const trimmed = value?.trim();

  return trimmed && UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function getClientOrThrow() {
  const supabase = getSupabaseBrowserClient();

  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Supabase 연결이 필요합니다.');
  }

  return supabase;
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
      .select(
        'id, code, owner_id, selected_category, selected_candidate, status, created_at, updated_at',
      )
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

  const { data, error } = await supabase
    .from('meeting_rooms')
    .select('id, code, owner_id, selected_category, selected_candidate, status, created_at, updated_at')
    .eq('code', normalizedCode)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapRoom(data as MeetingRoomRow) : null;
}

export async function loadRoomParticipants(roomId: string) {
  const supabase = getClientOrThrow();

  const { data, error } = await supabase
    .from('meeting_room_participants')
    .select(
      'id, room_id, created_by, name, location, latitude, longitude, max_travel_time, location_source, saved_friend_id',
    )
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });

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

  const { error } = await supabase.from('meeting_room_participants').upsert(
    {
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
    },
    { onConflict: 'id' },
  );

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
  const { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      selected_category: input.selectedCategory,
      selected_candidate: input.selectedCandidate,
      status: 'decided',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.roomId)
    .select('id, code, owner_id, selected_category, selected_candidate, status, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return mapRoom(data as MeetingRoomRow);
}

export function subscribeToRoomParticipants(
  roomId: string,
  onChange: (participants: Participant[]) => void,
  onError?: (message: string) => void,
) {
  const supabase = getSupabaseBrowserClient();

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
  const supabase = getSupabaseBrowserClient();

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
