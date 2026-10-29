import { Logger } from '@nestjs/common';
import { AppError } from '../common/errors';
import { Env } from '../config/env';

export const PLACES = Symbol('PLACES');

export interface PlaceResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface PlacesProvider {
  /** Search near a point (bias, not a hard filter). */
  search(query: string, near?: { lat: number; lng: number }): Promise<PlaceResult[]>;
}

/**
 * Development only: a fixed list of real Bengaluru landmarks so the apps can be
 * exercised without a maps account. Results are marked "(dev)" in the name.
 */
const DEV_GAZETTEER: PlaceResult[] = [
  { name: 'MG Road Metro Station', address: 'MG Road, Bengaluru', lat: 12.9756, lng: 77.6066 },
  { name: 'Koramangala 5th Block', address: 'Koramangala, Bengaluru', lat: 12.9352, lng: 77.6245 },
  {
    name: 'Indiranagar 100 Feet Road',
    address: 'Indiranagar, Bengaluru',
    lat: 12.9719,
    lng: 77.6412,
  },
  {
    name: 'Majestic Bus Station',
    address: 'Kempegowda Bus Station, Bengaluru',
    lat: 12.9774,
    lng: 77.5713,
  },
  { name: 'Jayanagar 4th Block', address: 'Jayanagar, Bengaluru', lat: 12.925, lng: 77.5838 },
  { name: 'Whitefield ITPL', address: 'Whitefield, Bengaluru', lat: 12.9866, lng: 77.7366 },
  {
    name: 'Electronic City Phase 1',
    address: 'Electronic City, Bengaluru',
    lat: 12.8452,
    lng: 77.6602,
  },
  {
    name: 'Malleshwaram 8th Cross',
    address: 'Malleshwaram, Bengaluru',
    lat: 13.0035,
    lng: 77.5709,
  },
  { name: 'HSR Layout Sector 1', address: 'HSR Layout, Bengaluru', lat: 12.9116, lng: 77.6474 },
  { name: 'Hebbal Flyover', address: 'Hebbal, Bengaluru', lat: 13.0358, lng: 77.597 },
];

export class DevGazetteerPlaces implements PlacesProvider {
  async search(query: string): Promise<PlaceResult[]> {
    const q = query.trim().toLowerCase();
    return DEV_GAZETTEER.filter(
      (p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
    )
      .slice(0, 8)
      .map((p) => ({ ...p, name: `${p.name} (dev)` }));
  }
}

interface GoogleTextSearchResponse {
  places?: {
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  }[];
}

/** Google Places API (New) Text Search, biased to the caller's area, India only. */
export class GooglePlaces implements PlacesProvider {
  private readonly logger = new Logger('GooglePlaces');

  constructor(private readonly apiKey: string) {}

  async search(query: string, near?: { lat: number; lng: number }): Promise<PlaceResult[]> {
    let res: Response;
    try {
      res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
        },
        body: JSON.stringify({
          textQuery: query,
          regionCode: 'IN',
          maxResultCount: 8,
          ...(near && {
            locationBias: {
              circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30000 },
            },
          }),
        }),
        signal: AbortSignal.timeout(4000),
      });
    } catch (err) {
      this.logger.error({ err }, 'Places request failed');
      throw new AppError(503, 'PLACES_UNAVAILABLE', 'Search is unavailable. Please try again');
    }
    if (!res.ok) {
      this.logger.error({ status: res.status }, 'Places returned an error');
      throw new AppError(503, 'PLACES_UNAVAILABLE', 'Search is unavailable. Please try again');
    }
    const body = (await res.json()) as GoogleTextSearchResponse;
    return (body.places ?? [])
      .filter((p) => p.location?.latitude !== undefined && p.location?.longitude !== undefined)
      .map((p) => ({
        name: p.displayName?.text ?? p.formattedAddress ?? 'Unnamed place',
        address: p.formattedAddress ?? '',
        lat: p.location!.latitude!,
        lng: p.location!.longitude!,
      }));
  }
}

export function createPlacesProvider(env: Env): PlacesProvider {
  return env.MAPS_PROVIDER === 'google'
    ? new GooglePlaces(env.GOOGLE_MAPS_API_KEY!)
    : new DevGazetteerPlaces();
}
