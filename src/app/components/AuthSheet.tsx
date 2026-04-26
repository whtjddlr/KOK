import { useEffect, useState } from 'react';
import { LocateFixed, LoaderCircle, MapPin, Search, X } from 'lucide-react';
import {
  AuthUser,
  signIn,
  signUp,
  UserHomeLocation,
} from '../lib/auth';
import { participantGenderOptions } from '../lib/gender';
import type { ParticipantGender } from '../types';
import {
  reverseGeocodeCoordinates,
  searchAddress,
  type AddressSearchResult,
} from '../lib/naver-map';
import {
  filterSupportedServiceAreaResults,
  getAddressResultLocationLabel,
  getSafeLocationLabel,
  isSupportedServiceAreaLocation,
  looksLikeUnsupportedServiceAreaQuery,
  SERVICE_AREA_UNSUPPORTED_MESSAGE,
} from '../lib/service-area';

export type AuthMode = 'signup' | 'login';

interface AuthSheetProps {
  open: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

const DEFAULT_SIGNUP_CATEGORIES = ['restaurant', 'cafe'] as const;
const DEFAULT_SIGNUP_KEYWORDS = ['맛집', '카페'];

function getLocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return '브라우저 위치 권한을 허용해 주세요.';
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return '현재 위치를 찾지 못했어요. 주소 검색으로 설정해 주세요.';
  }

  return '위치를 가져오는 데 시간이 걸렸어요. 다시 시도해 주세요.';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        window.clearTimeout(timeoutId);
      });
  });
}

export function AuthSheet({
  open,
  mode,
  onModeChange,
  onClose,
  onSuccess,
}: AuthSheetProps) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<ParticipantGender>('unspecified');
  const [homeLocation, setHomeLocation] = useState<UserHomeLocation | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<AddressSearchResult[]>([]);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setGender('unspecified');
      setHomeLocation(null);
      setLocationQuery('');
      setLocationResults([]);
      setIdentifier('');
      setPassword('');
      setError(null);
      setIsLocating(false);
      setIsSearchingLocation(false);
      setIsSubmitting(false);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    if (mode === 'signup' && !homeLocation) {
      setError('기본 출발지를 먼저 설정해 주세요.');
      return;
    }

    if (mode === 'signup' && homeLocation && !isSupportedServiceAreaLocation(homeLocation)) {
      setError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await withTimeout(
        mode === 'signup'
          ? signUp({
              name,
              gender,
              identifier,
              password,
              homeLocation,
              preferences: {
                favoriteCategories: [...DEFAULT_SIGNUP_CATEGORIES],
                favoriteKeywords: DEFAULT_SIGNUP_KEYWORDS,
                vibe: 'trendy',
              },
            })
          : signIn({ identifier, password }),
        8000,
        '인증 서버 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.',
      );

      if (result.error || !result.user) {
        setError(result.error ?? '다시 시도해 주세요.');
        return;
      }

      onSuccess(result.user);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : '인증 요청을 완료하지 못했어요.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('이 브라우저에서는 현재 위치 기능을 지원하지 않아요. 주소 검색으로 설정해 주세요.');
      return;
    }

    setIsLocating(true);
    setError(null);
    setLocationResults([]);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const coordinates = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        try {
          const result = await reverseGeocodeCoordinates(coordinates.lat, coordinates.lng);
          if (!isSupportedServiceAreaLocation({ ...result, coordinates })) {
            setHomeLocation(null);
            setLocationQuery('');
            setError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
            return;
          }

          const locationLabel = getAddressResultLocationLabel(result);
          setHomeLocation({
            location: locationLabel,
            coordinates,
            locationSource: 'current',
          });
          setLocationQuery(locationLabel);
        } catch {
          if (!isSupportedServiceAreaLocation({ coordinates })) {
            setHomeLocation(null);
            setLocationQuery('');
            setError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
            return;
          }

          setHomeLocation({
            location: '현재 위치 기준',
            coordinates,
            locationSource: 'current',
          });
          setLocationQuery('현재 위치 기준');
        } finally {
          setIsLocating(false);
        }
      },
      (locationError) => {
        setError(getLocationErrorMessage(locationError));
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  };

  const handleLocationSearch = async () => {
    const query = locationQuery.trim();

    if (!query) {
      setError('기본 출발지를 검색해 주세요.');
      return;
    }

    setIsSearchingLocation(true);
    setError(null);
    setLocationResults([]);

    try {
      if (looksLikeUnsupportedServiceAreaQuery(query)) {
        setError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
        return;
      }

      const rawResults = await searchAddress(query);
      const results = filterSupportedServiceAreaResults(rawResults);

      if (!results.length) {
        setError(
          rawResults.length
            ? SERVICE_AREA_UNSUPPORTED_MESSAGE
            : '위치 검색 결과가 없어요. 역 이름이나 장소명으로 다시 검색해 주세요.',
        );
        return;
      }

      setLocationResults(results.slice(0, 5));
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : '위치 검색 중 오류가 발생했어요.',
      );
    } finally {
      setIsSearchingLocation(false);
    }
  };

  const handleSelectLocation = (result: AddressSearchResult) => {
    const locationLabel = getAddressResultLocationLabel(result);

    setHomeLocation({
      location: locationLabel,
      coordinates: result.coordinates,
      locationSource: 'address',
    });
    setLocationQuery(locationLabel);
    setLocationResults([]);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(18,28,45,0.42)] px-4 pb-4 pt-10 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl text-[#1a1a2e]">
              {mode === 'signup' ? '회원가입' : '로그인'}
            </div>
            <div className="mt-1 text-sm text-[#6b7280]">
              {mode === 'signup'
                ? '이메일 없이 아이디와 닉네임으로 가볍게 시작해요.'
                : '저장한 취향과 친구 목록으로 바로 이어서 시작할 수 있어요.'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f1eb] text-[#44505b]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-[#f5f1eb] p-1">
          <button
            onClick={() => onModeChange('signup')}
            className={`h-11 rounded-[18px] text-sm transition-all ${
              mode === 'signup' ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#6b7280]'
            }`}
          >
            회원가입
          </button>
          <button
            onClick={() => onModeChange('login')}
            className={`h-11 rounded-[18px] text-sm transition-all ${
              mode === 'login' ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#6b7280]'
            }`}
          >
            로그인
          </button>
        </div>

        <div className="space-y-3">
          {mode === 'signup' && (
            <>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="닉네임"
                className="h-12 w-full rounded-2xl bg-[#f9f7f4] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:ring-2 focus:ring-[#2d3561]/20"
              />

              <div className="rounded-2xl bg-[#f9f7f4] px-4 py-3">
                <div className="mb-2 text-xs text-[#8a94a2]">성별</div>
                <div className="flex flex-wrap gap-2">
                  {participantGenderOptions.map((option) => {
                    const active = gender === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setGender(option.value)}
                        className={`rounded-full px-3 py-1.5 text-xs transition-all ${
                          active ? 'bg-[#1f2a44] text-white shadow-sm' : 'bg-white text-[#44505b]'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#e8edf3] bg-[#f8fbfd] p-4">
                <div className="mb-3 flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#ff7b6b]" />
                  <div>
                    <div className="text-sm text-[#1a1a2e]">기본 출발지</div>
                    <div className="mt-1 text-xs leading-relaxed text-[#8a94a2]">
                      가입할 때 한 번 저장해두면 방에서 바로 내 위치로 쓸 수 있어요.
                    </div>
                  </div>
                </div>

                {homeLocation && (
                  <div className="mb-3 rounded-2xl bg-white px-4 py-3">
                    <div className="text-sm text-[#1a1a2e]">
                      {getSafeLocationLabel(homeLocation.location)}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={isLocating}
                  className="mb-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#1f2a44] text-sm text-white transition-transform active:scale-95 disabled:opacity-60"
                >
                  {isLocating ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <LocateFixed className="h-4 w-4" />
                  )}
                  {isLocating ? '현재 위치 확인 중' : '현재 위치로 설정'}
                </button>

                <div className="flex gap-2">
                  <input
                    value={locationQuery}
                    onChange={(event) => {
                      setLocationQuery(event.target.value);
                      setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleLocationSearch();
                      }
                    }}
                    placeholder="역, 장소명 검색"
                    className="h-11 min-w-0 flex-1 rounded-2xl border border-[#edf1f4] bg-white px-4 text-sm text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:border-[#d8e0ea] focus:ring-2 focus:ring-[#2d3561]/10"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleLocationSearch();
                    }}
                    disabled={isSearchingLocation}
                    className="inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef4ff] text-[#2d5aa7] transition-transform active:scale-95 disabled:opacity-60"
                    aria-label="기본 출발지 검색"
                  >
                    {isSearchingLocation ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {locationResults.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {locationResults.map((result) => (
                      <button
                        key={`${result.title}-${result.coordinates.lat}-${result.coordinates.lng}`}
                        type="button"
                        onClick={() => handleSelectLocation(result)}
                        className="w-full rounded-2xl border border-[#e8edf3] bg-white px-4 py-3 text-left transition-all hover:border-[#2d3561]"
                      >
                        <div className="text-sm text-[#1a1a2e]">
                          {getAddressResultLocationLabel(result)}
                        </div>
                        {(result.roadAddress || result.jibunAddress) && (
                          <div className="mt-1 text-xs text-[#6b7280]">
                            {result.roadAddress || result.jibunAddress}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder={mode === 'signup' ? '아이디' : '아이디 또는 이메일'}
            className="h-12 w-full rounded-2xl bg-[#f9f7f4] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:ring-2 focus:ring-[#2d3561]/20"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="비밀번호"
            className="h-12 w-full rounded-2xl bg-[#f9f7f4] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:ring-2 focus:ring-[#2d3561]/20"
          />
        </div>

        {mode === 'signup' && (
          <div className="mt-4 rounded-[22px] bg-[#faf7f2] px-4 py-3 text-sm leading-relaxed text-[#6b7280]">
            저장된 출발지는 기본값이에요. 방 안에서는 이번 약속 위치만 따로 바꿀 수 있어요.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-2xl border border-[#ffd9cf] bg-[#fff5f2] px-4 py-3 text-sm text-[#c15b3d]">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1f2a44] text-white transition-transform active:scale-95 disabled:opacity-60"
        >
          {isSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {mode === 'signup' ? '가입하고 시작' : '로그인하고 시작'}
        </button>
      </div>
    </div>
  );
}
