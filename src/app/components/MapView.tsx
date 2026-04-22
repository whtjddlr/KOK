import { Participant, Candidate } from '../types';

interface MapViewProps {
  participants: Participant[];
  candidates?: Candidate[];
  selectedCandidate?: Candidate;
  colors: string[];
}

export function MapView({ participants, candidates, selectedCandidate, colors }: MapViewProps) {
  const minLat = Math.min(...participants.map(p => p.coordinates.lat)) - 0.05;
  const maxLat = Math.max(...participants.map(p => p.coordinates.lat)) + 0.05;
  const minLng = Math.min(...participants.map(p => p.coordinates.lng)) - 0.05;
  const maxLng = Math.max(...participants.map(p => p.coordinates.lng)) + 0.05;

  const normalizeX = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * 100;
  const normalizeY = (lat: number) => 100 - ((lat - minLat) / (maxLat - minLat)) * 100;

  return (
    <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-[#f0f4f8] to-[#e8eef3] rounded-3xl overflow-hidden shadow-inner">
      <div className="absolute inset-0 opacity-10">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs text-[#6b7280]">
        수도권 지도
      </div>

      {participants.map((participant, index) => {
        const x = normalizeX(participant.coordinates.lng);
        const y = normalizeY(participant.coordinates.lat);
        const color = colors[index % colors.length];

        return (
          <div key={participant.id}>
            <div
              className="absolute w-24 h-24 rounded-full opacity-10 animate-pulse"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: 'translate(-50%, -50%)',
                backgroundColor: color,
              }}
            />

            <div
              className="absolute z-10"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-lg"
                style={{ backgroundColor: color }}
              >
                <span className="text-sm">{participant.name.charAt(0)}</span>
              </div>
              <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white/90 backdrop-blur-sm px-2 py-0.5 rounded-full text-xs text-[#1a1a2e] shadow-sm">
                {participant.name}
              </div>
            </div>
          </div>
        );
      })}

      {candidates?.map((candidate) => {
        const x = normalizeX(candidate.coordinates.lng);
        const y = normalizeY(candidate.coordinates.lat);
        const isSelected = selectedCandidate?.id === candidate.id;

        return (
          <div
            key={candidate.id}
            className="absolute z-5"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              className={`w-6 h-6 rounded-lg rotate-45 ${
                isSelected
                  ? 'bg-[#ff7b6b] shadow-lg scale-125'
                  : 'bg-white/80 border-2 border-[#4ecdc4]'
              } transition-all`}
            />
          </div>
        );
      })}

      {selectedCandidate && participants.map((participant, index) => {
        const x1 = normalizeX(participant.coordinates.lng);
        const y1 = normalizeY(participant.coordinates.lat);
        const x2 = normalizeX(selectedCandidate.coordinates.lng);
        const y2 = normalizeY(selectedCandidate.coordinates.lat);
        const color = colors[index % colors.length];

        return (
          <svg
            key={`line-${participant.id}`}
            className="absolute inset-0 pointer-events-none"
            style={{ width: '100%', height: '100%' }}
          >
            <line
              x1={`${x1}%`}
              y1={`${y1}%`}
              x2={`${x2}%`}
              y2={`${y2}%`}
              stroke={color}
              strokeWidth="2"
              strokeDasharray="4 4"
              opacity="0.5"
            />
          </svg>
        );
      })}
    </div>
  );
}
