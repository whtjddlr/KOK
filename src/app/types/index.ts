export interface Participant {
  id: string;
  name: string;
  location: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  maxTravelTime?: number;
}

export interface Candidate {
  id: string;
  name: string;
  description: string;
  vibe: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  averageDistance: number;
  tags: string[];
}

export interface TravelInfo {
  participantId: string;
  distance: number;
  cost: number;
  duration: number;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
}

export interface MeetingResult {
  candidate: Candidate;
  travelInfo: TravelInfo[];
  totalCost: number;
}
