import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, LocateFixed, MapPin, Minus, Plus, Search, X } from 'lucide-react';
import { Candidate, Coordinates, NearbyPlace, Participant, TravelInfo } from '../types';
import { loadNaverMapSdk } from '../lib/naver-map';
import { buildNaverMapReservationLink, buildNaverMapSearchLink } from '../lib/naver-links';

interface MapViewProps {
  participants: Participant[];
  candidates?: Candidate[];
  selectedCandidate?: Candidate;
  selectedRoutes?: TravelInfo[];
  reachableCandidateIds?: string[];
  nearbyPlaces?: NearbyPlace[];
  onCandidateSelect?: (candidateId: string) => void;
  onRouteSelect?: (participantId: string) => void;
  locationPickerEnabled?: boolean;
  locationPickerHintVisible?: boolean;
  pickedLocationPreview?: Coordinates | null;
  onLocationPick?: (coordinates: Coordinates) => void;
  colors: string[];
}

type ActiveMapDetail = { kind: 'nearby'; id: string };

interface SelectedRouteOverlay {
  participant: Participant;
  route: TravelInfo;
  color: string;
  path: Coordinates[];
  labelPosition: Coordinates;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createParticipantIcon(name: string, color: string) {
  const initial = escapeHtml(name.slice(0, 1));

  return {
    content: `
      <div style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:9999px;background:${color};color:#fff;font-weight:700;font-size:14px;box-shadow:0 8px 20px rgba(18,28,45,0.18);border:2px solid rgba(255,255,255,0.92);">
        ${initial}
      </div>
    `,
    size: new window.naver.maps.Size(40, 40),
    anchor: new window.naver.maps.Point(20, 20),
  };
}

function createCandidateIcon(name: string, active: boolean, reachable: boolean) {
  const safeName = escapeHtml(name);
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
          ? `<div style="padding:4px 8px;border-radius:9999px;background:rgba(255,255,255,0.92);backdrop-filter:blur(8px);font-size:11px;color:#44505b;white-space:nowrap;box-shadow:0 8px 16px rgba(18,28,45,0.08);">${safeName}</div>`
          : ''}
      </div>
    `,
    size: new window.naver.maps.Size(88, active || reachable ? 52 : 24),
    anchor: new window.naver.maps.Point(44, 24),
  };
}

function createNearbyPlaceIcon(label: string, category: NearbyPlace['category']) {
  const safeLabel = escapeHtml(label);
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
          ${safeLabel}
        </div>
      </div>
    `,
    size: new window.naver.maps.Size(144, 32),
    anchor: new window.naver.maps.Point(14, 14),
  };
}

function getRouteDistanceLabel(route: TravelInfo) {
  return route.source === 'estimated' ? '예상 거리' : `${route.distance}km`;
}

function createRouteInfoIcon(participantName: string, route: TravelInfo, color: string) {
  const initial = escapeHtml(participantName.slice(0, 1));
  const distanceLabel = getRouteDistanceLabel(route);

  return {
    content: `
      <button type="button" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:18px;background:rgba(255,255,255,0.96);backdrop-filter:blur(12px);box-shadow:0 14px 34px rgba(18,28,45,0.18);border:1px solid rgba(226,232,240,0.92);font-family:inherit;">
        <span style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:9999px;background:${color};color:#fff;font-weight:800;font-size:12px;flex-shrink:0;">
          ${initial}
        </span>
        <span style="display:flex;flex-direction:column;gap:1px;line-height:1.1;white-space:nowrap;">
          <span style="font-size:13px;font-weight:800;color:#1f2a44;">${route.duration}분 · ${distanceLabel}</span>
          <span style="font-size:11px;color:#7a8491;">상세 보기</span>
        </span>
      </button>
    `,
    size: new window.naver.maps.Size(150, 74),
    anchor: new window.naver.maps.Point(75, 74),
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

function getRouteOverlayPath(
  route: TravelInfo,
  fallbackStart?: Coordinates,
  fallbackEnd?: Coordinates,
) {
  const routePath =
    route.routePath?.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)) ??
    [];

  if (routePath.length >= 2) {
    return routePath;
  }

  if (fallbackStart && fallbackEnd) {
    return [fallbackStart, fallbackEnd];
  }

  return [];
}

function buildViewportSignature(
  participants: Participant[],
  candidates: Candidate[],
  selectedRoutes: TravelInfo[],
  nearbyPlaces: NearbyPlace[],
  pickedLocationPreview: Coordinates | null,
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
    selectedRoutes: selectedRoutes.map((route) => [
      route.participantId,
      route.source,
      route.duration,
      route.distance,
      route.routePath?.length ?? 0,
    ]),
    nearbyPlaces: nearbyPlaces
      .filter((place) => place.coordinates)
      .map((place) => [place.id, place.coordinates?.lat, place.coordinates?.lng]),
    pickedLocationPreview: pickedLocationPreview
      ? [pickedLocationPreview.lat, pickedLocationPreview.lng]
      : null,
  });
}

function getMapLocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return '위치 권한을 허용하면 현재 위치로 이동할 수 있어요.';
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return '현재 위치를 찾지 못했어요.';
  }

  return '위치를 가져오는 데 시간이 걸렸어요.';
}

export function MapView({
  participants,
  candidates = [],
  selectedCandidate,
  selectedRoutes = [],
  reachableCandidateIds = [],
  nearbyPlaces = [],
  onCandidateSelect,
  onRouteSelect,
  locationPickerEnabled = false,
  locationPickerHintVisible = false,
  pickedLocationPreview = null,
  onLocationPick,
  colors,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const mapListenersRef = useRef<any[]>([]);
  const lastViewportSignatureRef = useRef<string>('');
  const lastWheelZoomAtRef = useRef(0);
  const initialCenterRef = useRef(participants[0]?.coordinates ?? { lat: 37.5665, lng: 126.978 });
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number | null>(null);
  const [activeDetail, setActiveDetail] = useState<ActiveMapDetail | null>(null);
  const [mapCenterError, setMapCenterError] = useState<string | null>(null);
  const [isLocatingMapCenter, setIsLocatingMapCenter] = useState(false);

  const reachableCandidates = useMemo(
    () => candidates.filter((candidate) => reachableCandidateIds.includes(candidate.id)),
    [candidates, reachableCandidateIds],
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
  const selectedRouteOverlays = useMemo<SelectedRouteOverlay[]>(() => {
    if (!selectedCandidate) {
      return [];
    }

    return participants
      .map((participant, index) => {
        const route = selectedRoutes.find((item) => item.participantId === participant.id);

        if (!route) {
          return null;
        }

        const path = getRouteOverlayPath(
          route,
          participant.coordinates,
          selectedCandidate.coordinates,
        );

        if (!path.length) {
          return null;
        }

        return {
          participant,
          route,
          color: colors[index % colors.length],
          path,
          labelPosition: participant.coordinates,
        };
      })
      .filter((item): item is SelectedRouteOverlay => Boolean(item));
  }, [colors, participants, selectedCandidate, selectedRoutes]);
  const viewportSignature = useMemo(
    () =>
      buildViewportSignature(
        participants,
        candidates,
        selectedRoutes,
        nearbyPlacesWithCoordinates,
        pickedLocationPreview,
      ),
    [participants, candidates, selectedRoutes, nearbyPlacesWithCoordinates, pickedLocationPreview],
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

          const initialCenter = initialCenterRef.current;

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
              scrollWheel: true,
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
  }, []);

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

    selectedRouteOverlays.forEach((routeOverlay) => {
      routeOverlay.path.forEach((point) => {
        pointsToFit.push(point);
      });
    });

    participants.forEach((participant, index) => {
      const color = colors[index % colors.length];
      const center = new maps.LatLng(participant.coordinates.lat, participant.coordinates.lng);
      const marker = new maps.Marker({
        map,
        position: center,
        title: `${participant.name} · ${participant.location}`,
        icon: createParticipantIcon(participant.name, color),
      });

      overlaysRef.current.push(marker);
    });

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

    selectedRouteOverlays.forEach((routeOverlay) => {
      const line = new maps.Polyline({
        map,
        path: routeOverlay.path.map((point) => new maps.LatLng(point.lat, point.lng)),
        strokeColor: routeOverlay.color,
        strokeOpacity: routeOverlay.route.source === 'estimated' ? 0.42 : 0.82,
        strokeWeight: routeOverlay.route.source === 'estimated' ? 3 : 4,
        strokeStyle: routeOverlay.route.source === 'estimated' ? 'shortdash' : 'solid',
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
      });
      const labelPosition = new maps.LatLng(
        routeOverlay.labelPosition.lat,
        routeOverlay.labelPosition.lng,
      );
      const labelMarker = new maps.Marker({
        map,
        position: labelPosition,
        title: `${routeOverlay.participant.name} 경로 상세`,
        icon: createRouteInfoIcon(
          routeOverlay.participant.name,
          routeOverlay.route,
          routeOverlay.color,
        ),
        zIndex: 120,
      });

      maps.Event.addListener(labelMarker, 'click', () => {
        onRouteSelect?.(routeOverlay.participant.id);
        map.panTo(labelPosition);
      });

      overlaysRef.current.push(line, labelMarker);
    });

    const fitMapToData = () => {
      if (pointsToFit.length > 1) {
        const nextBounds = new maps.LatLngBounds();

        pointsToFit.forEach((point) => {
          nextBounds.extend(new maps.LatLng(point.lat, point.lng));
        });

        map.fitBounds(nextBounds, {
          top: 96,
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

    if (lastViewportSignatureRef.current !== viewportSignature) {
      fitMapToData();
      lastViewportSignatureRef.current = viewportSignature;
    }

    return () => {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [
    sdkReady,
    participants,
    candidates,
    colors,
    focusCandidates,
    nearbyPlacesWithCoordinates,
    onCandidateSelect,
    onRouteSelect,
    reachableCandidateIds,
    selectedCandidate,
    selectedRouteOverlays,
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

  useEffect(() => {
    const container = containerRef.current;

    if (!sdkReady || !container) {
      return;
    }

    const handleWheelZoom = (event: WheelEvent) => {
      if (!mapRef.current) {
        return;
      }

      event.preventDefault();

      const now = window.performance.now();

      if (now - lastWheelZoomAtRef.current < 120) {
        return;
      }

      lastWheelZoomAtRef.current = now;
      const currentZoom = mapRef.current.getZoom?.() ?? 11;
      const nextZoom = Math.max(8, Math.min(17, currentZoom + (event.deltaY < 0 ? 1 : -1)));

      if (nextZoom === currentZoom) {
        return;
      }

      mapRef.current.setZoom(nextZoom, true);
      setZoomLevel(nextZoom);
    };

    container.addEventListener('wheel', handleWheelZoom, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheelZoom);
    };
  }, [sdkReady]);

  const handleZoom = (delta: number) => {
    if (!mapRef.current) {
      return;
    }

    const currentZoom = mapRef.current.getZoom();
    const nextZoom = Math.max(8, Math.min(17, currentZoom + delta));

    mapRef.current.setZoom(nextZoom, true);
    setZoomLevel(nextZoom);
  };

  const handleMoveToCurrentLocation = () => {
    if (!mapRef.current || !window.naver?.maps) {
      return;
    }

    if (!navigator.geolocation) {
      setMapCenterError('이 브라우저에서는 현재 위치 기능을 지원하지 않아요.');
      return;
    }

    setIsLocatingMapCenter(true);
    setMapCenterError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mapRef.current || !window.naver?.maps) {
          setIsLocatingMapCenter(false);
          return;
        }

        const map = mapRef.current;
        const nextCenter = new window.naver.maps.LatLng(
          position.coords.latitude,
          position.coords.longitude,
        );
        const currentZoom = map.getZoom?.() ?? 11;
        const nextZoom = Math.max(14, currentZoom);

        if (typeof map.panTo === 'function') {
          map.panTo(nextCenter);
        } else {
          map.setCenter(nextCenter);
        }

        map.setZoom(nextZoom, true);
        setZoomLevel(map.getZoom?.() ?? nextZoom);
        setIsLocatingMapCenter(false);
      },
      (locationError) => {
        setMapCenterError(getMapLocationErrorMessage(locationError));
        setIsLocatingMapCenter(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  };

  if (error) {
    return (
      <div className="relative h-[24rem] w-full overflow-hidden rounded-[2rem] border border-[#f0d4d0] bg-[#fff8f7] p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)] md:h-[30rem]">
        <div className="text-sm text-[#a24b41] mb-2">네이버 지도를 불러오지 못했습니다.</div>
        <p className="text-sm text-[#6b7280] leading-relaxed">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative h-[24rem] w-full overflow-hidden rounded-[2rem] border border-white/70 bg-[#e4e2e4] shadow-[0_10px_30px_rgba(26,26,46,0.08)] sm:h-[28rem] md:h-[32rem]">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      {!sdkReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.92),rgba(240,244,248,0.95))] px-6">
          <div className="kok-loading-card w-full max-w-[320px] rounded-[1.5rem] bg-white/90 px-5 py-4 text-sm text-[#76777e] shadow-[0_10px_30px_rgba(26,26,46,0.08)] backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="kok-route-loader scale-90">
                <span />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-[#17233c]">지도 여는 중</div>
                <div className="mt-1 text-xs">후보와 출발지를 지도 위에 올리고 있어요.</div>
              </div>
            </div>
            <div className="mt-4 kok-loading-progress" />
          </div>
        </div>
      )}

      {locationPickerHintVisible && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-[#1f2a44]/92 px-4 py-2 text-xs text-white shadow-[0_10px_30px_rgba(26,26,46,0.14)] backdrop-blur-sm">
          지도에서 우클릭하거나 길게 눌러 출발지를 찍어주세요
        </div>
      )}

      {activeNearbyPlaceDetail && (
        <div className="absolute inset-x-4 bottom-16 z-10 md:right-20 md:left-4">
          <div className="rounded-[1.75rem] border border-white/80 bg-white/96 p-4 shadow-[0_18px_40px_rgba(18,28,45,0.16)] backdrop-blur-sm">
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
                      buildNaverMapSearchLink(activeNearbyPlaceDetail.name)
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#1f2a44] px-4 text-xs text-white transition-transform active:scale-95"
                  >
                    네이버 보기
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <a
                    href={buildNaverMapReservationLink(activeNearbyPlaceDetail.name)}
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

      <div className="pointer-events-none hidden absolute left-4 bottom-4 bg-[#1f2a44]/82 text-white text-[11px] px-3 py-2 rounded-full shadow-lg backdrop-blur-sm">
        드래그로 이동 · 스크롤/핀치로 확대/축소
      </div>

      <div className="absolute right-3 bottom-3 flex flex-col gap-2 sm:right-4 sm:bottom-4">
        <button
          type="button"
          onClick={() => handleZoom(1)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/80 bg-white/94 text-[#1f2a44] shadow-[0_10px_30px_rgba(26,26,46,0.12)] backdrop-blur-sm transition-transform active:scale-95"
          aria-label="지도 확대"
        >
          <Plus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => handleZoom(-1)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/80 bg-white/94 text-[#1f2a44] shadow-[0_10px_30px_rgba(26,26,46,0.12)] backdrop-blur-sm transition-transform active:scale-95"
          aria-label="지도 축소"
        >
          <Minus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={handleMoveToCurrentLocation}
          disabled={isLocatingMapCenter || !sdkReady}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-[#314062] bg-[#1f2a44]/92 text-white shadow-[0_10px_30px_rgba(26,26,46,0.16)] backdrop-blur-sm transition-transform active:scale-95"
          aria-label="현재 위치로 이동"
        >
          {isLocatingMapCenter ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <LocateFixed className="h-4 w-4" />
          )}
        </button>
      </div>

      {mapCenterError && !activeNearbyPlaceDetail ? (
        <div className="pointer-events-none absolute bottom-4 left-4 max-w-[240px] rounded-2xl bg-white/92 px-3 py-2 text-[11px] leading-relaxed text-[#a24b41] shadow-sm backdrop-blur-sm">
          {mapCenterError}
        </div>
      ) : zoomLevel !== null && !activeNearbyPlaceDetail ? (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-white/88 px-3 py-1.5 text-[11px] text-[#6b7280] shadow-sm backdrop-blur-sm">
          Zoom {zoomLevel}
        </div>
      ) : null}
    </div>
  );
}
