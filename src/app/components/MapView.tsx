import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Minus, Plus } from 'lucide-react';
import { Candidate, Coordinates, Participant } from '../types';
import { getDistanceKm, getTravelDistanceFromMinutes } from '../lib/meeting';
import { loadNaverMapSdk } from '../lib/naver-map';

interface MapViewProps {
  participants: Participant[];
  candidates?: Candidate[];
  selectedCandidate?: Candidate;
  reachableCandidateIds?: string[];
  colors: string[];
}

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

export function MapView({
  participants,
  candidates = [],
  selectedCandidate,
  reachableCandidateIds = [],
  colors,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const fitViewRef = useRef<(() => void) | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number | null>(null);

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
      const marker = new maps.Marker({
        map,
        position: new maps.LatLng(candidate.coordinates.lat, candidate.coordinates.lng),
        title: candidate.name,
        icon: createCandidateIcon(candidate.name, Boolean(isSelected), isReachable),
      });

      overlaysRef.current.push(marker);
    });

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
    fitMapToData();

    return () => {
      fitViewRef.current = null;
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [sdkReady, participants, candidates, colors, coverageCenter, focusCandidates, reachableCandidateIds, reachableCandidates, selectedCandidate]);

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
    <div className="relative w-full h-[22rem] md:h-[28rem] rounded-3xl overflow-hidden shadow-inner border border-[#e7edf2] bg-[#eef3f7]">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      {!sdkReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.92),rgba(240,244,248,0.95))]">
          <div className="rounded-2xl bg-white/90 backdrop-blur-sm px-4 py-3 text-sm text-[#6b7280] shadow-sm">
            네이버 지도 불러오는 중...
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs text-[#6b7280] shadow-sm">
        수도권 연결 지도
      </div>

      <div className="pointer-events-none absolute top-4 right-4 flex gap-2 text-[11px] text-[#4f5b66]">
        <div className="bg-white/85 px-3 py-1.5 rounded-full shadow-sm">반투명 원: 이동 반경</div>
        <div className="bg-white/85 px-3 py-1.5 rounded-full shadow-sm">민트 영역: 공통 접근권</div>
      </div>

      <div className="pointer-events-none absolute left-4 bottom-4 bg-[#1f2a44]/82 text-white text-[11px] px-3 py-2 rounded-full shadow-lg backdrop-blur-sm">
        드래그로 이동 · 핀치나 버튼으로 확대/축소
      </div>

      <div className="absolute right-4 bottom-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => handleZoom(1)}
          className="w-11 h-11 rounded-2xl bg-white/94 text-[#1f2a44] shadow-lg border border-white/80 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform"
          aria-label="지도 확대"
        >
          <Plus className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => handleZoom(-1)}
          className="w-11 h-11 rounded-2xl bg-white/94 text-[#1f2a44] shadow-lg border border-white/80 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform"
          aria-label="지도 축소"
        >
          <Minus className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={handleResetView}
          className="min-w-[7rem] h-11 px-3 rounded-2xl bg-[#1f2a44]/92 text-white shadow-lg border border-[#314062] backdrop-blur-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
          aria-label="전체 범위 보기"
        >
          <Crosshair className="w-4 h-4" />
          <span className="text-xs">전체 보기{zoomLevel ? ` · 줌 ${zoomLevel}` : ''}</span>
        </button>
      </div>
    </div>
  );
}
