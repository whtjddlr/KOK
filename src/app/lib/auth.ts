import type { User } from '@supabase/supabase-js';
import type { Coordinates, LocationSource, ParticipantGender } from '../types';
import { normalizeParticipantGender } from './gender';
import { getSafeLocationLabel } from './service-area';
import { getSupabaseBrowserClient, isSupabaseConfigured } from './supabase';

export interface AuthUser {
  id: string;
  name: string;
  avatarUrl?: string | null;
  loginId: string;
  email: string;
  gender: ParticipantGender;
  preferences: UserPreferences;
  homeLocation: UserHomeLocation | null;
}

interface StoredAuthUser extends AuthUser {
  passwordHash: string;
}

interface ProfileRow {
  id: string;
  email: string;
  name: string;
  favorite_categories: string[] | null;
  vibe: string | null;
  favorite_keywords: string[] | null;
  home_location?: string | null;
  home_latitude?: number | null;
  home_longitude?: number | null;
  home_location_source?: string | null;
}

export type UserPreferenceVibe =
  | 'trendy'
  | 'cozy'
  | 'quiet'
  | 'lively'
  | 'local'
  | 'clean'
  | 'romantic'
  | 'retro'
  | 'outdoor';

export type UserPreferenceCategory =
  | 'restaurant'
  | 'cafe'
  | 'drink'
  | 'culture'
  | 'activity';

export interface UserPreferences {
  favoriteCategories: UserPreferenceCategory[];
  vibe: UserPreferenceVibe;
  favoriteKeywords: string[];
}

export interface UserHomeLocation {
  location: string;
  coordinates: Coordinates;
  locationSource?: LocationSource;
}

export interface ProfileSettingsInput {
  name: string;
  avatarUrl?: string | null;
  gender?: ParticipantGender;
  preferences: Partial<UserPreferences>;
  homeLocation?: UserHomeLocation | null;
}

export const MAX_FAVORITE_CATEGORIES = 3;
export const MAX_FAVORITE_KEYWORDS = 8;

export const preferenceVibeOptions: Array<{ value: UserPreferenceVibe; label: string }> = [
  { value: 'trendy', label: '힙한 곳' },
  { value: 'cozy', label: '감성 위주' },
  { value: 'quiet', label: '조용한 곳' },
  { value: 'lively', label: '활기찬 곳' },
  { value: 'local', label: '로컬 느낌' },
  { value: 'clean', label: '깔끔한 곳' },
  { value: 'romantic', label: '데이트 느낌' },
  { value: 'retro', label: '레트로' },
  { value: 'outdoor', label: '야외 느낌' },
];

export const preferenceCategoryOptions: Array<{
  value: UserPreferenceCategory;
  label: string;
}> = [
  { value: 'restaurant', label: '맛집' },
  { value: 'cafe', label: '카페' },
  { value: 'drink', label: '술/바' },
  { value: 'culture', label: '전시/문화' },
  { value: 'activity', label: '놀거리' },
];

export const preferenceKeywordOptions = [
  '한식',
  '고기',
  '브런치',
  '디저트',
  '파스타',
  '초밥',
  '중식',
  '분식',
  '해산물',
  '베이커리',
  '커피',
  '와인바',
  '칵테일',
  '이자카야',
  '포차',
  '루프탑',
  '전시',
  '영화',
  '공방',
  '쇼핑',
  '산책',
  '방탈출',
  '보드게임',
  '노래방',
  '볼링',
  '사진',
  '뷰 좋은',
  '야경',
  '가성비',
  '역 가까운',
  '주차 편한',
] as const;

const USERS_KEY = 'randommeet.auth.users';
const SESSION_KEY = 'randommeet.auth.session';
const PROFILE_SETTINGS_KEY_PREFIX = 'randommeet.profile.';
const SAVED_FRIENDS_KEY_PREFIX = 'randommeet.saved-friends.';
const PROFILE_BASE_SELECT = 'id, email, name, favorite_categories, vibe, favorite_keywords';
const PROFILE_HOME_SELECT = 'home_location, home_latitude, home_longitude, home_location_source';
const SYNTHETIC_EMAIL_DOMAIN = 'drop.local';

let canPersistProfileHomeLocation: boolean | null = null;

function getDefaultPreferences(): UserPreferences {
  return {
    favoriteCategories: ['restaurant', 'cafe'],
    vibe: 'trendy',
    favoriteKeywords: ['맛집', '카페'],
  };
}

function normalizePreferences(input?: Partial<UserPreferences> | null): UserPreferences {
  const defaults = getDefaultPreferences();
  const favoriteCategories = Array.isArray(input?.favoriteCategories)
    ? input.favoriteCategories.filter(
        (value): value is UserPreferenceCategory =>
          typeof value === 'string' &&
          preferenceCategoryOptions.some((option) => option.value === value),
      )
    : [];
  const favoriteKeywords = Array.isArray(input?.favoriteKeywords)
    ? input.favoriteKeywords
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .slice(0, MAX_FAVORITE_KEYWORDS)
    : [];
  const vibe =
    typeof input?.vibe === 'string' &&
    preferenceVibeOptions.some((option) => option.value === input.vibe)
      ? input.vibe
      : defaults.vibe;

  return {
    favoriteCategories: favoriteCategories.length
      ? favoriteCategories.slice(0, MAX_FAVORITE_CATEGORIES)
      : defaults.favoriteCategories,
    vibe,
    favoriteKeywords: favoriteKeywords.length ? favoriteKeywords : defaults.favoriteKeywords,
  };
}

function normalizeHomeLocation(input?: Partial<UserHomeLocation> | null) {
  const location = typeof input?.location === 'string' ? input.location.trim() : '';
  const lat = Number(input?.coordinates?.lat);
  const lng = Number(input?.coordinates?.lng);
  const locationSource =
    input?.locationSource === 'current' ||
    input?.locationSource === 'address' ||
    input?.locationSource === 'map' ||
    input?.locationSource === 'station'
      ? input.locationSource
      : 'address';

  if (!location || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null as UserHomeLocation | null;
  }

  return {
    location: getSafeLocationLabel(location),
    coordinates: {
      lat,
      lng,
    },
    locationSource,
  };
}

function normalizeAvatarUrl(input?: unknown) {
  const value = typeof input === 'string' ? input.trim() : '';

  if (!value) {
    return null as string | null;
  }

  if (
    value.startsWith('data:image/') ||
    value.startsWith('https://') ||
    value.startsWith('http://')
  ) {
    return value;
  }

  return null as string | null;
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

async function hashStableText(value: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function normalizeAuthIdentifier(identifierInput: string) {
  const rawIdentifier = identifierInput.trim();
  const compactIdentifier = rawIdentifier.replace(/\s+/g, '');
  const lowerIdentifier = compactIdentifier.toLowerCase();

  if (!compactIdentifier) {
    return { error: '아이디를 입력해 주세요.' };
  }

  if (rawIdentifier.includes('@')) {
    const email = normalizeEmail(rawIdentifier);

    if (!isValidEmail(email)) {
      return { error: '이메일 형식이 올바르지 않아요.' };
    }

    return {
      email,
      loginId: email,
    };
  }

  if (compactIdentifier.length < 3 || compactIdentifier.length > 24) {
    return { error: '아이디는 3자 이상 24자 이하로 입력해 주세요.' };
  }

  if (!/^[0-9a-zA-Z._\-\u3131-\u318E\uAC00-\uD7A3]+$/.test(compactIdentifier)) {
    return { error: '아이디는 한글, 영문, 숫자, 점, 밑줄, 하이픈만 쓸 수 있어요.' };
  }

  const emailLocalPart = /^[0-9a-z._-]+$/.test(lowerIdentifier)
    ? lowerIdentifier
    : `u-${(await hashStableText(lowerIdentifier)).slice(0, 40)}`;

  return {
    email: `${emailLocalPart}@${SYNTHETIC_EMAIL_DOMAIN}`,
    loginId: compactIdentifier,
  };
}

function getLoginIdFromEmail(email?: string | null) {
  if (!email) {
    return '';
  }

  const suffix = `@${SYNTHETIC_EMAIL_DOMAIN}`;

  if (email.endsWith(suffix)) {
    return email.slice(0, -suffix.length);
  }

  return email;
}

function readStoredUsers() {
  if (!canUseStorage()) {
    return [] as StoredAuthUser[];
  }

  try {
    const raw = window.localStorage.getItem(USERS_KEY);

    if (!raw) {
      return [] as StoredAuthUser[];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [] as StoredAuthUser[];
    }

    return parsed.map((user) => ({
      ...(user as StoredAuthUser),
      loginId:
        (user as Partial<StoredAuthUser>).loginId ||
        getLoginIdFromEmail((user as Partial<StoredAuthUser>).email),
      gender: normalizeParticipantGender((user as Partial<StoredAuthUser>).gender),
      avatarUrl: normalizeAvatarUrl((user as Partial<StoredAuthUser>).avatarUrl),
      preferences: normalizePreferences((user as StoredAuthUser).preferences),
      homeLocation: normalizeHomeLocation((user as StoredAuthUser).homeLocation),
    }));
  } catch {
    return [] as StoredAuthUser[];
  }
}

function persistStoredUsers(users: StoredAuthUser[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function persistSession(userId: string | null) {
  if (!canUseStorage()) {
    return;
  }

  if (!userId) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }

  window.localStorage.setItem(SESSION_KEY, userId);
}

function getProfileSettingsKey(userId: string) {
  return `${PROFILE_SETTINGS_KEY_PREFIX}${userId}`;
}

function readStoredProfileSettings(userId: string) {
  if (!canUseStorage() || !userId) {
    return undefined as
      | {
          name?: string;
          avatarUrl?: string | null;
          gender?: ParticipantGender;
          preferences?: Partial<UserPreferences>;
          homeLocation?: Partial<UserHomeLocation> | null;
        }
      | undefined;
  }

  try {
    const raw = window.localStorage.getItem(getProfileSettingsKey(userId));

    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    return parsed as {
      name?: string;
      avatarUrl?: string | null;
      gender?: ParticipantGender;
      preferences?: Partial<UserPreferences>;
      homeLocation?: Partial<UserHomeLocation> | null;
    };
  } catch {
    return undefined;
  }
}

function persistStoredProfileSettings(
  userId: string,
  input: {
    name: string;
    avatarUrl?: string | null;
    gender: ParticipantGender;
    preferences: UserPreferences;
    homeLocation: UserHomeLocation | null;
  },
) {
  if (!canUseStorage() || !userId) {
    return;
  }

  window.localStorage.setItem(getProfileSettingsKey(userId), JSON.stringify(input));
}

function clearStoredUserArtifacts(userId: string) {
  if (!canUseStorage() || !userId) {
    return;
  }

  window.localStorage.removeItem(getProfileSettingsKey(userId));
  window.localStorage.removeItem(`${SAVED_FRIENDS_KEY_PREFIX}${userId}`);
}

async function hashPassword(password: string) {
  return hashStableText(password);
}

function getNameFromMetadata(user: User) {
  const metadata = user.user_metadata ?? {};

  return (
    metadata.name ||
    metadata.full_name ||
    metadata.nickname ||
    user.email?.split('@')[0] ||
    '사용자'
  );
}

function getLoginIdFromMetadata(user: User) {
  const metadata = user.user_metadata ?? {};
  const metadataLoginId =
    typeof metadata.loginId === 'string'
      ? metadata.loginId.trim()
      : typeof metadata.username === 'string'
        ? metadata.username.trim()
        : '';

  return metadataLoginId || getLoginIdFromEmail(user.email);
}

function getPreferencesFromMetadata(user: User) {
  const metadata = user.user_metadata ?? {};

  return normalizePreferences(metadata.preferences as Partial<UserPreferences> | undefined);
}

function getHomeLocationFromMetadata(user: User) {
  const metadata = user.user_metadata ?? {};

  return normalizeHomeLocation(metadata.homeLocation as Partial<UserHomeLocation> | undefined);
}

function getGenderFromMetadata(user: User) {
  const metadata = user.user_metadata ?? {};
  return normalizeParticipantGender(metadata.gender);
}

function getAvatarUrlFromMetadata(user: User) {
  const metadata = user.user_metadata ?? {};

  return normalizeAvatarUrl(metadata.avatarUrl ?? metadata.avatar_url ?? metadata.picture);
}

function mapProfileRowToPreferences(profile: ProfileRow | null | undefined) {
  if (!profile) {
    return null;
  }

  return normalizePreferences({
    favoriteCategories: profile.favorite_categories as UserPreferenceCategory[] | undefined,
    vibe: profile.vibe as UserPreferenceVibe | undefined,
    favoriteKeywords: profile.favorite_keywords ?? undefined,
  });
}

function mapProfileRowToHomeLocation(profile: ProfileRow | null | undefined) {
  if (!profile) {
    return null;
  }

  return normalizeHomeLocation({
    location: profile.home_location ?? '',
    coordinates: {
      lat: Number(profile.home_latitude),
      lng: Number(profile.home_longitude),
    },
    locationSource: profile.home_location_source as LocationSource | undefined,
  });
}

function mapSupabaseUser(user: User, profile?: ProfileRow | null): AuthUser {
  const profilePreferences = mapProfileRowToPreferences(profile);
  const profileHomeLocation = mapProfileRowToHomeLocation(profile);
  const storedProfile = readStoredProfileSettings(user.id);
  const storedName = typeof storedProfile?.name === 'string' ? storedProfile.name.trim() : '';
  const storedAvatarUrl =
    storedProfile && 'avatarUrl' in storedProfile
      ? normalizeAvatarUrl(storedProfile.avatarUrl)
      : undefined;
  const storedGender =
    storedProfile && 'gender' in storedProfile
      ? normalizeParticipantGender(storedProfile.gender)
      : undefined;
  const storedHomeLocation =
    storedProfile && 'homeLocation' in storedProfile
      ? normalizeHomeLocation(storedProfile.homeLocation)
      : undefined;

  return {
    id: user.id,
    name: storedName || profile?.name?.trim() || getNameFromMetadata(user),
    avatarUrl: storedAvatarUrl !== undefined ? storedAvatarUrl : getAvatarUrlFromMetadata(user),
    loginId: getLoginIdFromMetadata(user),
    email: user.email ?? profile?.email ?? '',
    gender: storedGender ?? getGenderFromMetadata(user),
    preferences: storedProfile?.preferences
      ? normalizePreferences(storedProfile.preferences)
      : profilePreferences ?? getPreferencesFromMetadata(user),
    homeLocation:
      storedHomeLocation !== undefined
        ? storedHomeLocation
        : profileHomeLocation ?? getHomeLocationFromMetadata(user),
  };
}

async function upsertProfile(
  user: User,
  name: string,
  preferences: UserPreferences,
  homeLocation?: UserHomeLocation | null,
) {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return null as ProfileRow | null;
  }

  const { data: baseProfile, error: baseError } = await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        email: user.email ?? '',
        name,
        favorite_categories: preferences.favoriteCategories,
        vibe: preferences.vibe,
        favorite_keywords: preferences.favoriteKeywords,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select(PROFILE_BASE_SELECT)
    .single();

  if (baseError || !baseProfile) {
    return null as ProfileRow | null;
  }

  if (canPersistProfileHomeLocation === false) {
    return baseProfile as ProfileRow;
  }

  const { data: homeProfile, error: homeError } = await supabase
    .from('profiles')
    .update({
      home_location: homeLocation?.location ?? null,
      home_latitude: homeLocation?.coordinates.lat ?? null,
      home_longitude: homeLocation?.coordinates.lng ?? null,
      home_location_source: homeLocation?.locationSource ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select(PROFILE_HOME_SELECT)
    .single();

  if (homeError) {
    canPersistProfileHomeLocation = false;
    return baseProfile as ProfileRow;
  }

  canPersistProfileHomeLocation = true;

  return {
    ...(baseProfile as ProfileRow),
    ...(homeProfile as Partial<ProfileRow> | null),
  } as ProfileRow;
}

async function clearStaleSupabaseSession() {
  const supabase = getSupabaseBrowserClient();

  try {
    await supabase?.auth.signOut({ scope: 'local' });
  } catch {
    // 만료된 로컬 세션 정리는 실패해도 화면 흐름을 막지 않는다.
  }
}

export async function loadSessionUser() {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return null as AuthUser | null;
    }

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      if (error) {
        await clearStaleSupabaseSession();
      }

      return null as AuthUser | null;
    }

    return mapSupabaseUser(data.user);
  }

  if (!canUseStorage()) {
    return null as AuthUser | null;
  }

  const sessionUserId = window.localStorage.getItem(SESSION_KEY);

  if (!sessionUserId) {
    return null as AuthUser | null;
  }

  const matchedUser = readStoredUsers().find((user) => user.id === sessionUserId);

  if (!matchedUser) {
    persistSession(null);
    return null as AuthUser | null;
  }

  return {
    id: matchedUser.id,
    name: matchedUser.name,
    avatarUrl: normalizeAvatarUrl(matchedUser.avatarUrl),
    loginId: matchedUser.loginId || getLoginIdFromEmail(matchedUser.email),
    email: matchedUser.email,
    gender: normalizeParticipantGender(matchedUser.gender),
    preferences: normalizePreferences(matchedUser.preferences),
    homeLocation: normalizeHomeLocation(matchedUser.homeLocation),
  };
}

export function subscribeToAuthChanges(callback: (user: AuthUser | null) => void) {
  if (!isSupabaseConfigured()) {
    return () => {};
  }

  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return () => {};
  }

  let cancelled = false;
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => {
      if (cancelled) {
        return;
      }

      if (!session?.user) {
        callback(null);
        return;
      }

      callback(mapSupabaseUser(session.user));
    }, 0);
  });

  return () => {
    cancelled = true;
    subscription.unsubscribe();
  };
}

export function subscribeToPasswordRecovery(callback: () => void) {
  if (!isSupabaseConfigured()) {
    return () => {};
  }

  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return () => {};
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session?.user) {
      callback();
    }
  });

  return () => {
    subscription.unsubscribe();
  };
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();
    await supabase?.auth.signOut();
    return;
  }

  persistSession(null);
}

export async function deleteAccount(currentUser: AuthUser) {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return { error: 'Supabase 클라이언트를 초기화하지 못했어요.' };
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      return { error: '로그인 정보를 다시 확인해 주세요.' };
    }

    let response: Response;

    try {
      response = await fetch('/api/account-delete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: currentUser.id }),
      });
    } catch {
      return { error: '계정 삭제 서버에 연결하지 못했어요.' };
    }

    const body = await response.json().catch(() => ({} as { message?: string }));

    if (!response.ok) {
      return {
        error:
          typeof body.message === 'string' && body.message
            ? body.message
            : '계정을 삭제하지 못했어요.',
      };
    }

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // 삭제된 계정의 로컬 세션 정리는 실패해도 다음 화면 흐름을 막지 않는다.
    }

    clearStoredUserArtifacts(currentUser.id);
    return {};
  }

  const users = readStoredUsers();
  persistStoredUsers(users.filter((user) => user.id !== currentUser.id));
  persistSession(null);
  clearStoredUserArtifacts(currentUser.id);

  return {};
}

export async function updateProfileSettings(
  currentUser: AuthUser,
  input: ProfileSettingsInput,
) {
  const name = input.name.trim();
  const avatarUrl = normalizeAvatarUrl(input.avatarUrl);
  const gender = normalizeParticipantGender(input.gender);
  const preferences = normalizePreferences(input.preferences);
  const homeLocation = normalizeHomeLocation(input.homeLocation);

  if (!name) {
    return { error: '닉네임을 입력해 주세요.' };
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return { error: 'Supabase 클라이언트를 초기화하지 못했어요.' };
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return { error: '로그인 정보를 다시 확인해 주세요.' };
    }

    const { data: updatedAuth, error: updateError } = await supabase.auth.updateUser({
      data: {
        name,
        loginId: getLoginIdFromMetadata(authData.user),
        avatarUrl,
        gender,
        preferences,
        homeLocation,
      },
    });

    if (updateError) {
      return { error: updateError.message };
    }

    const authUser = updatedAuth.user ?? authData.user;
    persistStoredProfileSettings(authUser.id, {
      name,
      avatarUrl,
      gender,
      preferences,
      homeLocation,
    });

    void upsertProfile(authUser, name, preferences, homeLocation);

    return {
      user: {
        ...mapSupabaseUser(authUser),
        avatarUrl,
        gender,
        homeLocation,
      } satisfies AuthUser,
    };
  }

  const users = readStoredUsers();
  const nextUser = users.find((user) => user.id === currentUser.id);

  if (!nextUser) {
    return { error: '저장된 사용자를 찾지 못했어요.' };
  }

  const updatedUser: StoredAuthUser = {
    ...nextUser,
    name,
    avatarUrl,
    gender,
    preferences,
    homeLocation,
  };

  persistStoredUsers(users.map((user) => (user.id === currentUser.id ? updatedUser : user)));

  return {
    user: {
      id: updatedUser.id,
      name: updatedUser.name,
      avatarUrl: normalizeAvatarUrl(updatedUser.avatarUrl),
      loginId: updatedUser.loginId || getLoginIdFromEmail(updatedUser.email),
      email: updatedUser.email,
      gender: normalizeParticipantGender(updatedUser.gender),
      preferences: updatedUser.preferences,
      homeLocation,
    } satisfies AuthUser,
  };
}

export async function signUp(input: {
  name: string;
  identifier: string;
  password: string;
  gender?: ParticipantGender;
  preferences?: Partial<UserPreferences>;
  homeLocation?: UserHomeLocation | null;
}) {
  const name = input.name.trim();
  const authIdentifier = await normalizeAuthIdentifier(input.identifier);
  const password = input.password.trim();
  const gender = normalizeParticipantGender(input.gender);
  const preferences = normalizePreferences(input.preferences);
  const homeLocation = normalizeHomeLocation(input.homeLocation);

  if (!name) {
    return { error: '닉네임을 입력해 주세요.' };
  }

  if ('error' in authIdentifier) {
    return { error: authIdentifier.error };
  }

  if (password.length < 6) {
    return { error: '비밀번호는 6자 이상으로 입력해 주세요.' };
  }

  const { email, loginId } = authIdentifier;

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return { error: 'Supabase 클라이언트를 초기화하지 못했어요.' };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          loginId,
          gender,
          preferences,
          homeLocation,
        },
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      return { error: error.message };
    }

    if (!data.user) {
      return { error: '회원가입 결과를 확인하지 못했어요.' };
    }

    if (!data.session) {
      return {
        error:
          'Supabase 이메일 확인이 켜져 있어요. 아이디 로그인 테스트에서는 Authentication에서 Confirm email을 꺼 주세요.',
      };
    }

    persistStoredProfileSettings(data.user.id, {
      name,
      gender,
      preferences,
      homeLocation,
    });

    void upsertProfile(data.user, name, preferences, homeLocation);

    return {
      user: mapSupabaseUser(data.user) satisfies AuthUser,
    };
  }

  const users = readStoredUsers();

  if (users.some((user) => user.email === email)) {
    return { error: '이미 가입된 아이디예요.' };
  }

  const nextUser: StoredAuthUser = {
    id: `user-${Date.now()}`,
    name,
    avatarUrl: null,
    loginId,
    email,
    gender,
    preferences,
    homeLocation,
    passwordHash: await hashPassword(password),
  };

  persistStoredUsers([...users, nextUser]);
  persistSession(nextUser.id);

  return {
    user: {
      id: nextUser.id,
      name: nextUser.name,
      avatarUrl: normalizeAvatarUrl(nextUser.avatarUrl),
      loginId: nextUser.loginId,
      email: nextUser.email,
      gender: normalizeParticipantGender(nextUser.gender),
      preferences: normalizePreferences(nextUser.preferences),
      homeLocation,
    } satisfies AuthUser,
  };
}

export async function signIn(input: { identifier: string; password: string }) {
  const authIdentifier = await normalizeAuthIdentifier(input.identifier);
  const password = input.password.trim();

  if ('error' in authIdentifier) {
    return { error: authIdentifier.error };
  }

  if (!password) {
    return { error: '비밀번호를 입력해 주세요.' };
  }

  const { email } = authIdentifier;

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return { error: 'Supabase 클라이언트를 초기화하지 못했어요.' };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: error.message };
    }

    if (!data.user) {
      return { error: '로그인 결과를 확인하지 못했어요.' };
    }

    return {
      user: mapSupabaseUser(data.user) satisfies AuthUser,
    };
  }

  const users = readStoredUsers();
  const matchedUser = users.find((user) => user.email === email);

  if (!matchedUser) {
    return { error: '가입한 계정을 찾지 못했어요.' };
  }

  const passwordHash = await hashPassword(password);

  if (matchedUser.passwordHash !== passwordHash) {
    return { error: '비밀번호가 맞지 않아요.' };
  }

  persistSession(matchedUser.id);

  return {
    user: {
      id: matchedUser.id,
      name: matchedUser.name,
      avatarUrl: normalizeAvatarUrl(matchedUser.avatarUrl),
      loginId: matchedUser.loginId || getLoginIdFromEmail(matchedUser.email),
      email: matchedUser.email,
      gender: normalizeParticipantGender(matchedUser.gender),
      preferences: normalizePreferences(matchedUser.preferences),
      homeLocation: normalizeHomeLocation(matchedUser.homeLocation),
    } satisfies AuthUser,
  };
}

export async function requestPasswordReset(input: { identifier: string }) {
  const authIdentifier = await normalizeAuthIdentifier(input.identifier);

  if ('error' in authIdentifier) {
    return { error: authIdentifier.error };
  }

  const { email } = authIdentifier;

  if (email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)) {
    return {
      error: '비밀번호 재설정은 이메일로 가입한 계정만 가능해요.',
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      error: '비밀번호 재설정은 온라인 계정에서만 가능해요.',
    };
  }

  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return { error: 'Supabase 클라이언트를 초기화하지 못했어요.' };
  }

  const redirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?reset-password=1`
      : undefined;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    return { error: error.message };
  }

  return {};
}

export async function updateRecoveredPassword(input: { password: string }) {
  const password = input.password.trim();

  if (password.length < 6) {
    return { error: '비밀번호는 6자 이상으로 입력해 주세요.' };
  }

  if (!isSupabaseConfigured()) {
    return {
      error: '비밀번호 변경은 온라인 계정에서만 가능해요.',
    };
  }

  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return { error: 'Supabase 클라이언트를 초기화하지 못했어요.' };
  }

  const { data, error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    return { error: error.message };
  }

  if (!data.user) {
    return { error: '비밀번호 변경 결과를 확인하지 못했어요.' };
  }

  return {
    user: mapSupabaseUser(data.user) satisfies AuthUser,
  };
}
