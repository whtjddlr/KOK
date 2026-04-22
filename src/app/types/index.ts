export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Participant {
  id: string;
  name: string;
  location: string;
  coordinates: Coordinates;
  maxTravelTime: number;
}

export type DrawMood = '안정 픽' | '반전 픽' | '무드 픽';

export interface Candidate {
  id: string;
  name: string;
  district: string;
  description: string;
  vibe: string;
  coordinates: Coordinates;
  tags: string[];
  bestFor: string;
  whyItWorks: string;
  routeHint: string;
  drawMood: DrawMood;
}

export type TravelInfoSource = 'estimated' | 'directions';

export interface TravelInfo {
  participantId: string;
  participantName: string;
  distance: number;
  cost: number;
  duration: number;
  source: TravelInfoSource;
  tollFare?: number;
  taxiFare?: number;
  fuelPrice?: number;
}

export interface CandidateInsight {
  candidate: Candidate;
  travelInfo: TravelInfo[];
  averageDistance: number;
  averageDuration: number;
  maxDuration: number;
  allReachable: boolean;
  accessSummary: string;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
}

export interface ParticipantSettlement {
  participant: Participant;
  travelCost: number;
  shouldPay: number;
  paid: number;
  balance: number;
}

export interface DrawPlan {
  winner: CandidateInsight;
  finalists: CandidateInsight[];
  sequence: CandidateInsight[];
  fallbackNotice: string | null;
}
