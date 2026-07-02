export interface Coordinates {
  lat: number;
  lng: number;
}

export type AiProvider = 'upstage' | 'openai';

export interface RuntimeAiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type LocationSource = 'station' | 'current' | 'address' | 'map';
export type ParticipantGender = 'female' | 'male' | 'other' | 'unspecified';

export interface Participant {
  id: string;
  name: string;
  avatarUrl?: string | null;
  location: string;
  coordinates: Coordinates;
  maxTravelTime: number;
  travelMode?: TravelMode;
  gender?: ParticipantGender;
  locationSource?: LocationSource;
  savedFriendId?: string;
  createdBy?: string | null;
}

export interface RoomMemberSummary {
  id: string;
  roomId: string;
  name: string;
  createdBy?: string | null;
}

export interface SavedFriend {
  id: string;
  name: string;
  location: string;
  coordinates: Coordinates;
  maxTravelTime: number;
  travelMode?: TravelMode;
  gender?: ParticipantGender;
  locationSource?: LocationSource;
}

export interface MeetingRoom {
  id: string;
  code: string;
  ownerId: string | null;
  drawControllerId: string | null;
  drawReadyIds: string[];
  redrawVotes: string[];
  redrawRequestedAt: string | null;
  selectedCategory: MeetCategoryKey;
  selectionMode: SelectionModeKey;
  thrillLevel: ThrillLevel;
  selectedCandidate: Candidate | null;
  selectedRouteSnapshot?: WinnerRouteSnapshot | null;
  status: 'planning' | 'decided';
  createdAt: string;
  updatedAt: string;
  members?: RoomMemberSummary[];
  memberCount?: number;
}

export type MeetCategoryKey =
  | 'dining'
  | 'cafe'
  | 'drink'
  | 'date'
  | 'culture'
  | 'activity';

export interface MeetCategory {
  key: MeetCategoryKey;
  label: string;
  cue: string;
  accent: string;
  beats: [string, string, string];
}

export type SelectionModeKey = 'balance' | 'hotplace' | 'neighborhood';

export type CandidateScopeKey = 'standard' | 'wide' | 'max';

export interface SelectionMode {
  key: SelectionModeKey;
  label: string;
  shortLabel: string;
  description: string;
  accent: string;
}

export type ThrillLevel = 1 | 2 | 3 | 4 | 5;

export interface ThrillStage {
  level: ThrillLevel;
  label: string;
  shortLabel: string;
  description: string;
  accent: string;
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
  categories: MeetCategoryKey[];
}

export type NearbyPlaceCategory = 'restaurant' | 'cafe' | 'activity' | 'landmark';

export interface NearbyPlace {
  id: string;
  name: string;
  category: NearbyPlaceCategory;
  label: string;
  query: string;
  description: string;
  categoryPath: string;
  address: string;
  roadAddress: string;
  link: string;
  coordinates: Coordinates | null;
}

export interface NearbyPlaceSection {
  key: NearbyPlaceCategory;
  label: string;
  query: string;
  items: NearbyPlace[];
}

export type TravelInfoSource = 'estimated' | 'directions' | 'transit';
export type TravelMode = 'transit' | 'car';
export type RouteSnapshotStatus = 'ready' | 'partial' | 'error';

export interface TravelRouteStep {
  type: 'walk' | 'bus' | 'subway' | 'car';
  label: string;
  duration: number;
  distance?: number;
  from?: string;
  to?: string;
  stationCount?: number;
}

export interface TravelInfo {
  participantId: string;
  participantName: string;
  distance: number;
  cost: number;
  duration: number;
  source: TravelInfoSource;
  mode?: TravelMode;
  tollFare?: number;
  taxiFare?: number;
  fuelPrice?: number;
  transferCount?: number;
  walkDistance?: number;
  routeSummary?: string;
  routeSteps?: TravelRouteStep[];
  routePath?: Coordinates[];
  firstStartStation?: string;
  lastEndStation?: string;
}

export interface WinnerRouteSnapshot {
  winnerId: string;
  participantSignature: string;
  transitServicePeriod: 'day' | 'night';
  capturedAt: string;
  transitTravelInfo: TravelInfo[];
  carTravelInfo: TravelInfo[];
  transitStatus: RouteSnapshotStatus;
  carStatus: RouteSnapshotStatus;
  transitError: string | null;
  carError: string | null;
}

export interface CandidateInsight {
  candidate: Candidate;
  travelInfo: TravelInfo[];
  routeVerification?: {
    liveRouteCount: number;
    totalRouteCount: number;
    status: 'verified' | 'partial' | 'estimated';
  };
  averageDistance: number;
  averageDuration: number;
  maxDuration: number;
  spreadDuration: number;
  allReachable: boolean;
  accessSummary: string;
  categoryMatched: boolean;
  centerDistance: number;
  axisDistance: number;
  nearestParticipantName: string;
  nearestDuration: number;
  farthestParticipantName: string;
  farthestDuration: number;
}

export interface DrawPlan {
  winner: CandidateInsight;
  finalists: CandidateInsight[];
  sequence: CandidateInsight[];
  fallbackNotice: string | null;
}

export interface DrawProof {
  variantLabel: string;
  choiceLabel: string;
  lockCode: string;
}

export type VenueCategoryKey = 'restaurant' | 'cafe' | 'activity';

export interface VenueOption {
  id: string;
  category: VenueCategoryKey;
  areaId: string;
  name: string;
  subtitle: string;
  description: string;
  tags: string[];
  walkMinutes: number;
}
