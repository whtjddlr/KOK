import { useEffect, useRef, useState } from 'react';
import { LocateFixed, LoaderCircle, MapPin, Search, X } from 'lucide-react';
import {
  AuthUser,
  requestPasswordReset,
  signIn,
  signUp,
  updateRecoveredPassword,
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

export type AuthMode = 'signup' | 'login' | 'reset-request' | 'reset-update';

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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const openRef = useRef(open);
  const locationRequestIdRef = useRef(0);

  openRef.current = open;

  const isSignup = mode === 'signup';
  const isLogin = mode === 'login';
  const isResetRequest = mode === 'reset-request';
  const isResetUpdate = mode === 'reset-update';

  useEffect(() => {
    if (!open) {
      locationRequestIdRef.current += 1;
      setName('');
      setGender('unspecified');
      setHomeLocation(null);
      setLocationQuery('');
      setLocationResults([]);
      setIdentifier('');
      setPassword('');
      setConfirmPassword('');
      setError(null);
      setSuccess(null);
      setIsLocating(false);
      setIsSearchingLocation(false);
      setIsSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      locationRequestIdRef.current += 1;
    };
  }, []);

  if (!open) {
    return null;
  }

  const handleModeChange = (nextMode: AuthMode) => {
    setError(null);
    setSuccess(null);
    setPassword('');
    setConfirmPassword('');
    onModeChange(nextMode);
  };

  const handleSubmit = async () => {
    if (isResetRequest) {
      setIsSubmitting(true);
      setError(null);
      setSuccess(null);

      try {
        const result = await withTimeout(
          requestPasswordReset({ identifier }),
          8000,
          '재설정 요청 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.',
        );

        if (result.error) {
          setError(result.error);
          return;
        }

        setSuccess('재설정 메일을 보냈어요.');
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : '재설정 요청을 완료하지 못했어요.',
        );
      } finally {
        setIsSubmitting(false);
      }

      return;
    }

    if (isResetUpdate) {
      if (password !== confirmPassword) {
        setError('비밀번호가 서로 달라요.');
        return;
      }

      setIsSubmitting(true);
      setError(null);
      setSuccess(null);

      try {
        const result = await withTimeout(
          updateRecoveredPassword({ password }),
          8000,
          '비밀번호 변경 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.',
        );

        if (result.error || !result.user) {
          setError(result.error ?? '비밀번호를 변경하지 못했어요.');
          return;
        }

        onSuccess(result.user);
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : '비밀번호 변경을 완료하지 못했어요.',
        );
      } finally {
        setIsSubmitting(false);
      }

      return;
    }

    if (isSignup && !identifier.trim().includes('@')) {
      setError('비밀번호 재설정을 위해 이메일로 가입해 주세요.');
      return;
    }

    if (isSignup && !homeLocation) {
      setError('기본 출발지를 먼저 설정해 주세요.');
      return;
    }

    if (isSignup && homeLocation && !isSupportedServiceAreaLocation(homeLocation)) {
      setError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await withTimeout(
        isSignup
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

    const requestId = locationRequestIdRef.current + 1;
    locationRequestIdRef.current = requestId;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (!openRef.current || locationRequestIdRef.current !== requestId) {
          return;
        }

        const coordinates = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        try {
          const result = await reverseGeocodeCoordinates(coordinates.lat, coordinates.lng);
          if (!openRef.current || locationRequestIdRef.current !== requestId) {
            return;
          }

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
          if (!openRef.current || locationRequestIdRef.current !== requestId) {
            return;
          }

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
          if (openRef.current && locationRequestIdRef.current === requestId) {
            setIsLocating(false);
          }
        }
      },
      (locationError) => {
        if (!openRef.current || locationRequestIdRef.current !== requestId) {
          return;
        }

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
    <div className="kok-auth-overlay fixed inset-0 z-50 flex items-end justify-center bg-[rgba(18,28,45,0.42)] px-4 pb-4 pt-10 backdrop-blur-sm sm:items-center sm:pb-10">
      <div className="kok-auth-sheet flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-[32px] bg-white shadow-[0_30px_90px_rgba(20,35,29,0.24)]">
        <div className="px-6 pb-4 pt-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="text-2xl text-[#16241D]">
                {isSignup
                  ? '회원가입'
                  : isResetRequest
                    ? '비밀번호 재설정'
                    : isResetUpdate
                      ? '새 비밀번호'
                      : '로그인'}
              </div>
              <div className="mt-1 text-sm text-[#6E7C75]">
                {isSignup
                  ? '이메일과 닉네임으로 시작해요.'
                  : isResetRequest
                    ? '가입한 이메일로 링크를 보내요.'
                    : isResetUpdate
                      ? '새 비밀번호를 입력해 주세요.'
                      : '저장한 취향과 친구 목록으로 이어서 시작해요.'}
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F5F9F7] text-[#44505b] transition-transform active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!isResetRequest && !isResetUpdate && (
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#F5F9F7] p-1">
            <button
              onClick={() => handleModeChange('signup')}
              className={`h-11 rounded-[18px] text-sm transition-all ${
                isSignup ? 'bg-white text-[#16241D] shadow-sm' : 'text-[#6E7C75]'
              }`}
            >
              회원가입
            </button>
            <button
              onClick={() => handleModeChange('login')}
              className={`h-11 rounded-[18px] text-sm transition-all ${
                isLogin ? 'bg-white text-[#16241D] shadow-sm' : 'text-[#6E7C75]'
              }`}
            >
              로그인
            </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4">
          <div className="space-y-3">
            {isSignup && (
              <>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="닉네임"
                  className="h-12 w-full rounded-2xl bg-[#F5F9F7] px-4 text-[#16241D] outline-none placeholder:text-[#9AA8A1] focus:ring-2 focus:ring-[#16241D]/20"
                />

                <div className="rounded-2xl bg-[#F5F9F7] px-4 py-3">
                  <div className="mb-2 text-xs text-[#9AA8A1]">성별</div>
                  <div className="flex flex-wrap gap-2">
                    {participantGenderOptions.map((option) => {
                      const active = gender === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setGender(option.value)}
                          className={`rounded-full px-3 py-1.5 text-xs transition-all ${
                            active ? 'bg-[#16241D] text-white shadow-sm' : 'bg-white text-[#44505b]'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-[24px] border border-[#E4EFE9] bg-[#F5F9F7] p-4">
                  <div className="mb-3 flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6B5F]" />
                    <div>
                      <div className="text-sm text-[#16241D]">기본 출발지</div>
                      <div className="mt-1 text-xs leading-relaxed text-[#9AA8A1]">
                        가입할 때 한 번 저장해두면 방에서 바로 내 위치로 쓸 수 있어요.
                      </div>
                    </div>
                  </div>

                  {homeLocation && (
                    <div className="mb-3 rounded-2xl bg-white px-4 py-3">
                      <div className="text-sm text-[#16241D]">
                        {getSafeLocationLabel(homeLocation.location)}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleUseCurrentLocation}
                    disabled={isLocating}
                    className="mb-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#16241D] text-sm text-white transition-transform active:scale-95 disabled:opacity-60"
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
                      className="h-11 min-w-0 flex-1 rounded-2xl border border-[#E4EFE9] bg-white px-4 text-sm text-[#16241D] outline-none placeholder:text-[#9AA8A1] focus:border-[#E4EFE9] focus:ring-2 focus:ring-[#16241D]/10"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void handleLocationSearch();
                      }}
                      disabled={isSearchingLocation}
                      className="inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FFF0EE] text-[#E85F55] transition-transform active:scale-95 disabled:opacity-60"
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
                          className="w-full rounded-2xl border border-[#E4EFE9] bg-white px-4 py-3 text-left transition-all hover:border-[#16241D]"
                        >
                          <div className="text-sm text-[#16241D]">
                            {getAddressResultLocationLabel(result)}
                          </div>
                          {(result.roadAddress || result.jibunAddress) && (
                            <div className="mt-1 text-xs text-[#6E7C75]">
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
            {!isResetUpdate && (
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder={isSignup ? '이메일' : '아이디 또는 이메일'}
                className="h-12 w-full rounded-2xl bg-[#F5F9F7] px-4 text-[#16241D] outline-none placeholder:text-[#9AA8A1] focus:ring-2 focus:ring-[#16241D]/20"
              />
            )}
            {!isResetRequest && (
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isResetUpdate ? '새 비밀번호' : '비밀번호'}
                className="h-12 w-full rounded-2xl bg-[#F5F9F7] px-4 text-[#16241D] outline-none placeholder:text-[#9AA8A1] focus:ring-2 focus:ring-[#16241D]/20"
              />
            )}
            {isResetUpdate && (
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="새 비밀번호 확인"
                className="h-12 w-full rounded-2xl bg-[#F5F9F7] px-4 text-[#16241D] outline-none placeholder:text-[#9AA8A1] focus:ring-2 focus:ring-[#16241D]/20"
              />
            )}
          </div>

          {isLogin && (
            <button
              type="button"
              onClick={() => handleModeChange('reset-request')}
              className="mt-3 text-sm font-semibold text-[#6E7C75] underline underline-offset-4 transition-colors hover:text-[#16241D]"
            >
              비밀번호를 잊으셨나요?
            </button>
          )}

          {(isResetRequest || isResetUpdate) && (
            <button
              type="button"
              onClick={() => handleModeChange('login')}
              className="mt-3 text-sm font-semibold text-[#6E7C75]"
            >
              로그인으로 돌아가기
            </button>
          )}

          {isSignup && (
            <div className="mt-4 rounded-[22px] bg-[#FFF0EE] px-4 py-3 text-sm leading-relaxed text-[#6E7C75]">
              저장된 출발지는 기본값이에요. 방 안에서는 이번 약속 위치만 따로 바꿀 수 있어요.
            </div>
          )}
        </div>

        <div className="border-t border-[#E4EFE9] bg-white/96 px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur-md">
          {error && (
            <div className="mb-3 rounded-2xl border border-[#FFD8D2] bg-[#FFF0EE] px-4 py-3 text-sm text-[#E85F55]">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-3 rounded-2xl border border-[#FFD8D2] bg-[#FFF8F7] px-4 py-3 text-sm text-[#9F3D2F]">
              {success}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="kok-pressable kok-button-shine flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#16241D] text-white shadow-[0_14px_34px_rgba(20,35,29,0.16)] transition-transform active:scale-95 disabled:opacity-60"
          >
            {isSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {isSignup
              ? '가입하고 시작'
              : isResetRequest
                ? '재설정 메일 받기'
                : isResetUpdate
                  ? '비밀번호 바꾸기'
                  : '로그인하고 시작'}
          </button>
        </div>
      </div>
    </div>
  );
}
