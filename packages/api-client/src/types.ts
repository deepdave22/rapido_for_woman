import type { FareBreakdown, RideStatus } from '@saheli/domain';

export type ClientApp = 'PASSENGER' | 'DRIVER';

export interface Place {
  lat: number;
  lng: number;
  address: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenResponse extends Tokens {
  accessTokenExpiresInSeconds: number;
  isNewUser: boolean;
  user: { id: string; roles: string[] };
}

export interface OtpChallenge {
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface Me {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  preferredLanguage: string;
  roles: string[];
  passenger: { eligibilityStatus: string; termsAccepted: boolean } | null;
  driver: { status: string } | null;
  currentTermsVersion: string;
}

export interface SessionView {
  id: string;
  app: ClientApp;
  deviceName: string | null;
  lastUsedAt: string;
  current: boolean;
}

export interface QuoteOption {
  quoteId: string;
  categoryCode: 'BIKE' | 'AUTO' | 'CAB';
  displayName: string;
  seats: number;
  totalPaise: number;
  breakdown: FareBreakdown;
  expiresAt: string;
  driversNearby: boolean;
  pickupEtaSeconds: number | null;
}

export interface QuoteResponse {
  zone: { id: string; city: string };
  route: { distanceMeters: number; durationSeconds: number; provider: string };
  promo: { code: string; applied: boolean } | null;
  options: QuoteOption[];
}

interface RideBase {
  id: string;
  status: RideStatus;
  version: number;
  categoryCode: string;
  pickup: Place;
  dropoff: Place;
  quotedTotalPaise: number;
  finalTotalPaise: number | null;
  finalBreakdown: FareBreakdown | null;
  paymentMethod: 'CASH' | 'ONLINE';
  paymentStatus: string;
  cancelledBy: string | null;
  cancellationReason: string | null;
  cancellationFeePaise: number;
  requestedAt: string;
  driverAssignedAt: string | null;
  driverArrivedAt: string | null;
  pickupVerifiedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface PassengerRide extends RideBase {
  pickupPin: string | null;
  driver: {
    firstName: string | null;
    verified: boolean;
    rating: number | null;
    ratingCount: number;
    vehicle: { registrationNumber: string; make: string; model: string; colour: string } | null;
    location: { lat: number; lng: number; recordedAt: string } | null;
  } | null;
}

export interface DriverRide extends RideBase {
  passenger: { firstName: string | null };
  pickupPinAttempts: number;
}

export interface Offer {
  id: string;
  rideId: string;
  expiresAt: string;
  pickupDistanceMeters: number;
  pickup: { lat: number; lng: number };
  pickupAddress: string;
  dropoff: { lat: number; lng: number };
  dropoffAddress: string;
  categoryCode: string;
  tripDistanceMeters: number;
  estimatedEarningPaise: number;
  passengerFirstName: string | null;
}

export interface Onboarding {
  status: 'ONBOARDING' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  statusReason: string | null;
  vehicle: {
    id: string;
    categoryCode: string;
    registrationNumber: string;
    make: string;
    model: string;
    colour: string;
    status: string;
  } | null;
  documents: {
    id: string;
    type: string;
    status: string;
    expiresOn: string | null;
    rejectionReason: string | null;
  }[];
  requiredDocuments: string[];
  missingDocuments: string[];
  checks: { check: string; status: string }[];
  canSubmit: boolean;
}

export interface VehicleInput {
  categoryCode: 'BIKE' | 'AUTO' | 'CAB';
  registrationNumber: string;
  make: string;
  model: string;
  colour: string;
  manufactureYear?: number;
}

export interface LocationFix {
  lat: number;
  lng: number;
  accuracyM: number;
  headingDeg?: number;
  speedMps?: number;
  recordedAt: string;
}

/** A file to upload. On React Native, pass the `{ uri, name, type }` object FormData expects. */
export type UploadFile = Blob | { uri: string; name: string; type: string };

export interface PlaceResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface SavedPlace extends PlaceResult {
  id: string;
  label: 'HOME' | 'WORK' | 'OTHER';
}
