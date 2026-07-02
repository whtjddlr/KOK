import { createClient } from '@supabase/supabase-js';
import { json, pickFirstEnv } from './_lib/server.js';

function getBearerToken(req: any) {
  const header =
    typeof req.headers?.authorization === 'string'
      ? req.headers.authorization
      : typeof req.headers?.Authorization === 'string'
        ? req.headers.Authorization
        : '';
  const match = header.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() ?? '';
}

function throwIfSupabaseError(result: { error?: Error | null }) {
  if (result.error) {
    throw result.error;
  }
}

async function deleteOwnedRoomsOrTransferOwnership(serviceClient: any, userId: string) {
  const { data: ownedRooms, error: roomsError } = await serviceClient
    .from('meeting_rooms')
    .select('id')
    .eq('owner_id', userId);

  if (roomsError) {
    throw roomsError;
  }

  for (const room of ownedRooms ?? []) {
    const { data: participants, error: participantsError } = await serviceClient
      .from('meeting_room_participants')
      .select('id, created_by, created_at')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true });

    if (participantsError) {
      throw participantsError;
    }

    const nextOwnerId =
      participants?.find((participant: { created_by?: string | null }) => participant.created_by)
        ?.created_by ?? null;

    if (!participants?.length) {
      const { error: deleteRoomError } = await serviceClient
        .from('meeting_rooms')
        .delete()
        .eq('id', room.id);

      if (deleteRoomError) {
        throw deleteRoomError;
      }

      continue;
    }

    let { error: updateRoomError } = await serviceClient
      .from('meeting_rooms')
      .update({
        owner_id: nextOwnerId,
        draw_controller_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', room.id);

    if (
      updateRoomError &&
      typeof updateRoomError.message === 'string' &&
      updateRoomError.message.includes('draw_controller_id')
    ) {
      ({ error: updateRoomError } = await serviceClient
        .from('meeting_rooms')
        .update({
          owner_id: nextOwnerId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', room.id));
    }

    if (updateRoomError) {
      throw updateRoomError;
    }
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    json(res, 405, { message: 'Method not allowed' });
    return;
  }

  const token = getBearerToken(req);

  if (!token) {
    json(res, 401, { message: '로그인 토큰이 필요합니다.' });
    return;
  }

  const supabaseUrl = pickFirstEnv(process.env, ['SUPABASE_URL', 'VITE_SUPABASE_URL']);
  const serviceRoleKey = pickFirstEnv(process.env, [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY',
  ]);

  if (!supabaseUrl || !serviceRoleKey) {
    json(res, 500, {
      message: '계정 삭제 서버 설정이 아직 준비되지 않았습니다.',
    });
    return;
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    const {
      data: { user },
      error: userError,
    } = await serviceClient.auth.getUser(token);

    if (userError || !user) {
      json(res, 401, { message: '로그인 정보를 확인하지 못했습니다.' });
      return;
    }

    throwIfSupabaseError(
      await serviceClient.from('meeting_room_participants').delete().eq('created_by', user.id),
    );
    await deleteOwnedRoomsOrTransferOwnership(serviceClient, user.id);
    throwIfSupabaseError(
      await serviceClient.from('saved_friends').delete().eq('user_id', user.id),
    );
    throwIfSupabaseError(await serviceClient.from('profiles').delete().eq('id', user.id));

    const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(user.id);

    if (deleteUserError) {
      throw deleteUserError;
    }

    json(res, 200, { ok: true });
  } catch (error) {
    json(res, 500, {
      message:
        error instanceof Error
          ? error.message
          : '계정 삭제 중 알 수 없는 오류가 발생했습니다.',
    });
  }
}
