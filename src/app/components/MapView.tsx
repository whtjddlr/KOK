import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, ExternalLink, MapPin, Minus, Plus, Search, X } from 'lucide-react';
import { Candidate, Coordinates, NearbyPlace, Participant } from '../types';
import { getDistanceKm, getTravelDistanceFromMinutes } from '../lib/meeting';
import { loadNaverMapSdk } from '../lib/naver-map';

interface MapViewProps {
  participants: Participant[];
  candidates?: Candidate[];
  selectedCandidate?: Candidate;
  reachableCandidateIds?: string[];
  nearbyPlaces?: NearbyPlace[];
  onCandidateSelect?: (candidateId: string) => void;
  locationPickerEnabled?: boolean;
  locationPickerHintVisible?: boolean;
  pickedLocationPreview?: Coordinates | null;
  onLocationPick?: (coordinates: Coordinates) => void;
  colors: string[];
}

type ActiveMapDetail = { kind: 'nearby'; id: string };

function getCoverageCenter(points: Coordinates[]) {
  if (!points.length) {
    return null;
  }

  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}

function createParticipantIcon(name: string, color: string) {
  return {
    content: `
      <div style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:9999px;background:${color};color:#fff;font-weight:700;font-size:14px;box-shadow:0 8px 20px rgba(18,28,45,0.18);border:2px solid rgba(255,255,255,0.92);">
        ${name.slice(0, 1)}
      </div>
    `,
    size: new window.naver.maps.Size(40, 40),
    anchor: new window.naver.maps.Point(20, 20),
  };
}

function createCandidateIcon(name: string, active: boolean, reachable: boolean) {
  const background = active ? '#ff7b6b' : '#ffffff';
  const border = active ? '#ff7b6b' : reachable ? '#4ecdc4' : '#c9d4dc';
  const opacity = active || reachable ? 1 : 0.58;
  const shadow = active
    ? '0 0 0 8px rgba(255,123,107,0.14)'
    : '0 8px 20px rgba(18,28,45,0.12)';

  return {
    content: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;opacity:${opacity};transform:translateY(-4px);">
        <div style="width:22px;height:22px;transform:rotate(45deg);background:${background};border:2px solid ${border};border-radius:6px;box-shadow:${shadow};"></div>
        ${(active || reachable)
          ? `<div style="padding:4px 8px;border-radius:9999px;background:rgba(255,255,255,0.92);backdrop-filter:blur(8px);font-size:11px;color:#44505b;white-space:nowrap;box-shadow:0 8px 16px rgba(18,28,45,0.08);">${name}</div>`
          : ''}
      </div>
    `,
    size: new window.naver.maps.Size(88, active || reachable ? 52 : 24),
    anchor: new window.naver.maps.Point(44, 24),
  };
}

function createCoverageIcon() {
  return {
    content: `
      <div style="padding:8px 12px;border-radius:16px;background:rgba(255,255,255,0.92);backdrop-filter:blur(10px);font-size:12px;color:#2d3561;font-weight:600;box-shadow:0 12px 30px rgba(18,28,45,0.12);white-space:nowrap;">
        공통 접근권
      </div>
    `,
    size: new window.naver.maps.Size(110, 34),
    anchor: new window.naver.maps.Point(55, 17),
  };
}

function createNearbyPlaceIcon(label: string, category: NearbyPlace['category']) {
  const palette =
    category === 'restaurant'
      ? { background: '#ff7b6b', text: '#ffffff' }
      : category === 'cafe'
        ? { background: '#4ecdc4', text: '#10373b' }
        : { background: '#ffd166', text: '#5b4300' };

  return {
    content: `
      <div style="display:flex;align-items:center;gap:6px;transform:translateY(-6px);">
        <div style="width:14px;height:14px;border-radius:9999px;background:${palette.background};box-shadow:0 8px 16px rgba(18,28,45,0.16);border:2px solid rgba(255,255,255,0.95);"></div>
        <div style="max-width:124px;padding:4px 8px;border-radius:9999px;background:rgba(255,255,255,0.96);font-size:11px;color:#44505b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 8px 16px rgba(18,28,45,0.08);">
          ${label}
        </div>
      </div>
    `,
    size: new window.naver.maps.Size(144, 32),
    anchor: new window.naver.maps.Point(14, 14),
  };
}

function createPickedLocationIcon() {
  return {
    content: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;transform:translateY(-8px);">
        <div style="width:18px;height:18px;transform:rotate(45deg);background:#1f2a44;border:2px solid rgba(255,255,255,0.96);border-radius:6px;box-shadow:0 10px 18px rgba(18,28,45,0.18);"></div>
        <div style="padding:4px 9px;border-radius:9999px;background:rgba(31,42,68,0.94);color:#fff;font-size:11px;white-space:nowrap;box-shadow:0 10px 20px rgba(18,28,45,0.12);">
          새 출발지
        </div>
      </div>
    `,
    size: new window.naver.maps.Size(96, 42),
    anchor: new window.naver.maps.Point(18, 18),
  };
}

function getNearbyCategoryLabel(category: NearbyPlace['category']) {
  if (category === 'restaurant') {
    return '맛집';
  }

  if (category === 'cafe') {
    return '카페';
  }

  return '놀거리';
}

function buildNaverSearchLink(keyword: string) {
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
}

function buildViewportSignature(
  participants: Participant[],
  candidates: Candidate[],
  nearbyPlaces: NearbyPlace[],
  pickedLocationPreview: Coordinates | null,
  coverageCenter: Coordinates | null,
) {
  return JSON.stringify({
    participants: participants.map((participant) => [
      participant.id,
      participant.coordinates.lat,
      participant.coordinates.lng,
    ]),
    candidates: candidates.map((candidate) => [
      candidate.id,
      candidate.coordinates.lat,
      candidate.coordinates.lng,
    ]),
    nearbyPlaces: nearbyPlaces
      .filter((place) => place.coordinates)
      .map((place) => [place.id, place.coordinates?.lat, place.coordinates?.lng]),
    pickedLocationPreview: pickedLocationPreview
      ? [pickedLocationPreview.lat, pickedLocationPreview.lng]
      : null,
    coverageCenter: coverageCenter ? [coverageCenter.lat, coverageCenter.lng] : null,
  });
}

export function MapView({
  participants,
  candidates = [],
  selectedCandidate,
  reachableCandidateIds = [],
  nearbyPlaces = [],
  onCandidateSelect,
  locationPickerEnabled = false,
  locationPickerHintVisible = false,
  pickedLocationPreview = null,
  onLocationPick,
  colors,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const fitViewRef = useRef<(() => void) | null>(null);
  const mapListenersRef = useRef<any[]>([]);
  const lastViewportSignatureRef = useRef<string>('');
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number | null>(null);
  const [activeDetail, setActiveDetail] = useState<ActiveMapDetail | null>(null);

  const reachableCandidates = useMemo(
    () => candidates.filter((candidate) => reachableCandidateIds.includes(candidate.id)),
    [candidates, reachableCandidateIds],
  );

  const coverageCenter = useMemo(
    () => getCoverageCenter(reachableCandidates.map((candidate) => candidate.coordinates)),
    [reachableCandidates],
  );

  const focusCandidates = useMemo(() => {
    if (selectedCandidate) {
      return [selectedCandidate];
    }

    if (reachableCandidates.length) {
      return reachableCandidates;
    }

    return candidates.slice(0, Math.min(5, candidates.length));
  }, [candidates, reachableCandidates, selectedCandidate]);

  const nearbyPlacesWithCoordinates = useMemo(
    () => nearbyPlaces.filter((place) => place.coordinates),
    [nearbyPlaces],
  );
  const viewportSignature = useMemo(
    () =>
      buildViewportSignature(
        participants,
        candidates,
        nearbyPlacesWithCoordinates,
        pickedLocationPreview,
        coverageCenter,
      ),
    [participants, candidates, nearbyPlacesWithCoordinates, pickedLocationPreview, coverageCenter],
  );

  const activeCandidateDetail = null;
  const activeNearbyPlaceDetail =
    activeDetail?.kind === 'nearby'
      ? nearbyPlacesWithCoordinates.find((place) => place.id === activeDetail.id) ?? null
      : null;

  useEffect(() => {
    if (!activeDetail) {
      return;
    }

    if (
      activeDetail.kind === 'nearby' &&
      !nearbyPlacesWithCoordinates.some((place) => place.id === activeDetail.id)
    ) {
      setActiveDetail(null);
    }
  }, [activeDetail, candidates, nearbyPlacesWithCoordinates]);

  useEffect(() => {
    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;

    loadNaverMapSdk()
      .then((maps) => {
        if (!mounted || !containerRef.current) {
          return;
        }

        const initializeOrResizeMap = () => {
          if (!containerRef.current) {
            return false;
          }

          const rect = containerRef.current.getBoundingClientRect();
          const width = Math.max(1, Math.round(rect.width));
          const height = Math.max(1, Math.round(rect.height));

          if (width <= 1 || height <= 1) {
            return false;
          }

          const interactionEnabled = window.innerWidth >= 768;
          const initialCenter = participants[0]?.coordinates ?? { lat: 37.5665, lng: 126.978 };

          if (!mapRef.current) {
            mapRef.current = new maps.Map(containerRef.current, {
              center: new maps.LatLng(initialCenter.lat, initialCenter.lng),
              zoom: 11,
              minZoom: 8,
              maxZoom: 17,
              size: new maps.Size(width, height),
              zoomControl: false,
              mapDataControl: false,
              scaleControl: false,
              logoControl: false,
              keyboardShortcuts: true,
              scrollWheel: interactionEnabled,
              draggable: true,
              pinchZoom: true,
              disableDoubleTapZoom: false,
              disableDoubleClickZoom: false,
            });

            maps.Event.addListener(mapRef.current, 'zoom_changed', () => {
              setZoomLevel(mapRef.current?.getZoom?.() ?? null);
            });
          } else {
            mapRef.current.setSize(new maps.Size(width, height));
          }

          setZoomLevel(mapRef.current.getZoom());
          setSdkReady(true);
          return true;
        };

        if (!initializeOrResizeMap() && containerRef.current && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (initializeOrResizeMap()) {
              resizeObserver?.disconnect();
            }
          });
          resizeObserver.observe(containerRef.current);
          return;
        }

        if (containerRef.current && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            initializeOrResizeMap();
          });
          resizeObserver.observe(containerRef.current);
        }
      })
      .catch((sdkError: Error) => {
        if (!mounted) {
          return;
        }

        setError(sdkError.message);
      });

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
    };
  }, [participants]);

  useEffect(() => {
    if (!sdkReady || !mapRef.current || !window.naver?.maps) {
      return;
    }

    const map = mapRef.current;
    const maps = window.naver.maps;

    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    const pointsToFit: Coordinates[] = [...participants.map((participant) => participant.coordinates)];

    focusCandidates.forEach((candidate) => {
      pointsToFit.push(candidate.coordinates);
    });

    nearbyPlacesWithCoordinates.forEach((place) => {
      if (place.coordinates) {
        pointsToFit.push(place.coordinates);
      }
    });

    if (pickedLocationPreview) {
      pointsToFit.push(pickedLocationPreview);
    }

    if (coverageCenter) {
      pointsToFit.push(coverageCenter);
    }

    participants.forEach((participant, index) => {
      const color = colors[index % colors.length];
      const center = new maps.LatLng(participant.coordinates.lat, participant.coordinates.lng);
      const radius = getTravelDistanceFromMinutes(participant.maxTravelTime) * 1000;

      const circle = new maps.Circle({
        map,
        center,
        radius,
        fillColor: color,
        fillOpacity: 0.18,
        strokeColor: color,
        strokeOpacity: 0.7,
        strokeWeight: 2,
        strokeStyle: 'shortdash',
      });

      const marker = new maps.Marker({
        map,
        position: center,
        title: `${participant.name} · ${participant.location}`,
        icon: createParticipantIcon(participant.name, color),
      });

      overlaysRef.current.push(circle, marker);
    });

    if (coverageCenter) {
      const coverageRadius =
        reachableCandidates.length > 0
          ? Math.max(
              ...reachableCandidates.map((candidate) =>
                getDistanceKm(candidate.coordinates, coverageCenter),
              ),
            ) + 0.5
          : 0;

      if (coverageRadius > 0) {
        const coverageCircle = new maps.Circle({
          map,
          center: new maps.LatLng(coverageCenter.lat, coverageCenter.lng),
          radius: coverageRadius * 1000,
          fillColor: '#4ecdc4',
          fillOpacity: 0.12,
          strokeColor: '#4ecdc4',
          strokeOpacity: 0.5,
          strokeWeight: 2,
          strokeStyle: 'shortdash',
        });

        overlaysRef.current.push(coverageCircle);
      }

      const coverageMarker = new maps.Marker({
        map,
        position: new maps.LatLng(coverageCenter.lat, coverageCenter.lng),
        icon: createCoverageIcon(),
      });

      overlaysRef.current.push(coverageMarker);

      participants.forEach((participant, index) => {
        const color = colors[index % colors.length];
        const line = new maps.Polyline({
          map,
          path: [
            new maps.LatLng(participant.coordinates.lat, participant.coordinates.lng),
            new maps.LatLng(coverageCenter.lat, coverageCenter.lng),
          ],
          strokeColor: color,
          strokeOpacity: 0.38,
          strokeWeight: 2,
          strokeStyle: 'shortdash',
        });

        overlaysRef.current.push(line);
      });
    }

    candidates.forEach((candidate) => {
      const isSelected = selectedCandidate?.id === candidate.id;
      const isReachable = reachableCandidateIds.includes(candidate.id);
      const candidatePosition = new maps.LatLng(candidate.coordinates.lat, candidate.coordinates.lng);
      const marker = new maps.Marker({
        map,
        position: candidatePosition,
        title: candidate.name,
        icon: createCandidateIcon(candidate.name, Boolean(isSelected), isReachable),
      });

      if (onCandidateSelect) {
        maps.Event.addListener(marker, 'click', () => {
          onCandidateSelect(candidate.id);
          setActiveDetail(null);
          map.panTo(candidatePosition);
          if ((map.getZoom?.() ?? 0) < 12) {
            map.setZoom(12, true);
          }
        });
      } else {
        maps.Event.addListener(marker, 'click', () => {
          setActiveDetail(null);
          map.panTo(candidatePosition);
        });
      }

      overlaysRef.current.push(marker);
    });

    nearbyPlacesWithCoordinates.forEach((place) => {
      if (!place.coordinates) {
        return;
      }

      const placePosition = new maps.LatLng(place.coordinates.lat, place.coordinates.lng);
      const marker = new maps.Marker({
        map,
        position: placePosition,
        title: place.name,
        icon: createNearbyPlaceIcon(place.name, place.category),
      });

      maps.Event.addListener(marker, 'click', () => {
        map.panTo(placePosition);
        if ((map.getZoom?.() ?? 0) < 13) {
          map.setZoom(13, true);
        }
        setActiveDetail((current) =>
          current?.kind === 'nearby' && current.id === place.id
            ? null
            : { kind: 'nearby', id: place.id },
        );
      });

      overlaysRef.current.push(marker);
    });

    if (pickedLocationPreview) {
      const marker = new maps.Marker({
        map,
        position: new maps.LatLng(pickedLocationPreview.lat, pickedLocationPreview.lng),
        title: '새 출발지',
        icon: createPickedLocationIcon(),
      });

      overlaysRef.current.push(marker);
    }

    if (selectedCandidate) {
      participants.forEach((participant, index) => {
        const color = colors[index % colors.length];
        const line = new maps.Polyline({
          map,
          path: [
            new maps.LatLng(participant.coordinates.lat, participant.coordinates.lng),
            new maps.LatLng(selectedCandidate.coordinates.lat, selectedCandidate.coordinates.lng),
          ],
          strokeColor: color,
          strokeOpacity: 0.72,
          strokeWeight: 3,
          strokeStyle: 'shortdash',
        });

        overlaysRef.current.push(line);
      });
    }

    const fitMapToData = () => {
      if (pointsToFit.length > 1) {
        const nextBounds = new maps.LatLngBounds();

        pointsToFit.forEach((point) => {
          nextBounds.extend(new maps.LatLng(point.lat, point.lng));
        });

        map.fitBounds(nextBounds, {
          top: 56,
          right: 40,
          bottom: 56,
          left: 40,
        });
      } else if (pointsToFit.length === 1) {
        map.setCenter(new maps.LatLng(pointsToFit[0].lat, pointsToFit[0].lng));
        map.setZoom(12);
      }

      setZoomLevel(map.getZoom());
    };

    fitViewRef.current = fitMapToData;

    if (lastViewportSignatureRef.current !== viewportSignature) {
      fitMapToData();
      lastViewportSignatureRef.current = viewportSignature;
    }

    return () => {
      fitViewRef.current = null;
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [
    sdkReady,
    participants,
    candidates,
    colors,
    coverageCenter,
    focusCandidates,
    nearbyPlacesWithCoordinates,
    onCandidateSelect,
    reachableCandidateIds,
    reachableCandidates,
    selectedCandidate,
    pickedLocationPreview,
    viewportSignature,
  ]);

  useEffect(() => {
    if (!sdkReady || !mapRef.current || !window.naver?.maps) {
      return;
    }

    const maps = window.naver.maps;
    const map = mapRef.current;

    mapListenersRef.current.forEach((listener) => maps.Event.removeListener(listener));
    mapListenersRef.current = [];

    if (!locationPickerEnabled || !onLocationPick) {
      return;
    }

    const handlePick = (event: any) => {
      if (typeof event?.pointerEvent?.preventDefault === 'function') {
        event.pointerEvent.preventDefault();
      }

      const coord = event?.coord;

      if (!coord) {
        return;
      }

      const lat =
        typeof coord.y === 'number'
          ? coord.y
          : typeof coord.lat === 'function'
            ? coord.lat()
            : typeof coord.lat === 'number'
              ? coord.lat
              : null;
      const lng =
        typeof coord.x === 'number'
          ? coord.x
          : typeof coord.lng === 'function'
            ? coord.lng()
            : typeof coord.lng === 'number'
              ? coord.lng
              : null;

      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return;
      }

      onLocationPick({ lat, lng });
    };

    mapListenersRef.current.push(
      maps.Event.addListener(map, 'rightclick', handlePick),
      maps.Event.addListener(map, 'longtap', handlePick),
    );

    return () => {
      mapListenersRef.current.forEach((listener) => maps.Event.removeListener(listener));
      mapListenersRef.current = [];
    };
  }, [locationPickerEnabled, onLocationPick, sdkReady]);

  const handleZoom = (delta: number) => {
    if (!mapRef.current) {
      return;
    }

    const currentZoom = mapRef.current.getZoom();
    const nextZoom = Math.max(8, Math.min(17, currentZoom + delta));

    mapRef.current.setZoom(nextZoom, true);
    setZoomLevel(nextZoom);
  };

  const handleResetView = () => {
    fitViewRef.current?.();
  };

  if (error) {
    return (
      <div className="relative w-full h-[22rem] md:h-[28rem] rounded-3xl overflow-hidden border border-[#f0d4d0] bg-[#fff8f7] p-5 shadow-inner">
        <div className="text-sm text-[#a24b41] mb-2">네이버 지도를 불러오지 못했습니다.</div>
        <p className="text-sm text-[#6b7280] leading-relaxed">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative h-[22rem] w-full overflow-hidden rounded-3xl border border-[#e7edf2] bg-[#eef3f7] shadow-inner md:h-[28rem]">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      {!sdkReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.92),rgba(240,244,248,0.95))]">
          <div className="rounded-2xl bg-white/90 backdrop-blur-sm px-4 py-3 text-sm text-[#6b7280] shadow-sm">
            네이버 지도 불러오는 중...
          </div>
        </div>
      )}

      {locationPickerHintVisible && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-[#1f2a44]/92 px-4 py-2 text-xs text-white shadow-lg backdrop-blur-sm">
          지도에서 우클릭하거나 길게 눌러 출발지를 찍어주세요
        </div>
      )}

      {activeNearbyPlaceDetail && (
        <div className="absolute inset-x-4 bottom-16 z-10 md:right-20 md:left-4">
          <div className="rounded-[1.4rem] border border-white/80 bg-white/96 p-4 shadow-[0_18px_40px_rgba(18,28,45,0.16)] backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap gap-2">
                  {false ? (
                    <span className="rounded-full bg-[#fff2ee] px-3 py-1 text-[11px] text-[#ff7b6b]">
                      후보 지역
                    </span>
                  ) : null}
                  {activeNearbyPlaceDetail ? (
                    <span className="rounded-full bg-[#eef4ff] px-3 py-1 text-[11px] text-[#2d5aa7]">
                      {getNearbyCategoryLabel(activeNearbyPlaceDetail.category)}
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-base text-[#1a1a2e]">
                  {activeNearbyPlaceDetail?.name}
                </div>
                <div className="mt-1 text-sm leading-relaxed text-[#6b7280]">
                  {activeNearbyPlaceDetail?.categoryPath ??
                    activeNearbyPlaceDetail?.description}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveDetail(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f1eb] text-[#6b7280] transition-transform active:scale-95"
                aria-label="상세 정보 닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {activeCandidateDetail ? (
              <>
                <p className="mt-3 text-sm leading-relaxed text-[#44505b]">
                  {activeCandidateDetail.description}
                </p>
                <div className="mt-3 flex items-start gap-2 text-xs text-[#6b7280]">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ff7b6b]" />
                  <span>{activeCandidateDetail.routeHint}</span>
                </div>
              </>
            ) : null}

            {activeNearbyPlaceDetail ? (
              <>
                <div className="mt-3 flex items-start gap-2 text-xs text-[#6b7280]">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ff7b6b]" />
                  <span>
                    {activeNearbyPlaceDetail.roadAddress ||
                      activeNearbyPlaceDetail.address ||
                      `${activeNearbyPlaceDetail.name} 근처`}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={
                      activeNearbyPlaceDetail.link ||
                      buildNaverSearchLink(activeNearbyPlaceDetail.name)
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#1f2a44] px-4 text-xs text-white transition-transform active:scale-95"
                  >
                    네이버 보기
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <a
                    href={buildNaverSearchLink(`${activeNearbyPlaceDetail.name} 예약`)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#f5f1eb] px-4 text-xs text-[#1a1a2e] transition-transform active:scale-95"
                  >
                    예약 검색
                    <Search className="h-3.5 w-3.5" />
                  </a>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
      <div className="pointer-events-none hidden absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs text-[#6b7280] shadow-sm">
        수도권 연결 지도
      </div>

      <div className="pointer-events-none hidden absolute top-4 right-4 flex gap-2 text-[11px] text-[#4f5b66]">
        <div className="bg-white/85 px-3 py-1.5 rounded-full shadow-sm">반투명 원: 이동 반경</div>
        <div className="bg-white/85 px-3 py-1.5 rounded-full shadow-sm">민트 영역: 공통 접근권</div>
      </div>

      <div className="pointer-events-none hidden absolute left-4 bottom-4 bg-[#1f2a44]/82 text-white text-[11px] px-3 py-2 rounded-full shadow-lg backdrop-blur-sm">
        드래그로 이동 · 핀치나 버튼으로 확대/축소
      </div>

      <div className="absolute right-4 bottom-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => handleZoom(1)}
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/80 bg-white/94 text-[#1f2a44] shadow-lg backdrop-blur-sm transition-transform active:scale-95"
          aria-label="지도 확대"
        >
          <Plus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => handleZoom(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/80 bg-white/94 text-[#1f2a44] shadow-lg backdrop-blur-sm transition-transform active:scale-95"
          aria-label="지도 축소"
        >
          <Minus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={handleResetView}
          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-[#314062] bg-[#1f2a44]/92 text-white shadow-lg backdrop-blur-sm transition-transform active:scale-95"
          aria-label="전체 범위 보기"
        >
          <Crosshair className="h-4 w-4" />
          <span className="text-xs">전체 보기{zoomLevel ? ` · 줌 ${zoomLevel}` : ''}</span>
        </button>
      </div>

      {zoomLevel !== null && !activeNearbyPlaceDetail && (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-white/88 px-3 py-1.5 text-[11px] text-[#6b7280] shadow-sm backdrop-blur-sm">
          Zoom {zoomLevel}
        </div>
      )}
    </div>
  );
}
