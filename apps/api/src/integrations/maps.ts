import { Logger } from '@nestjs/common';
import { haversineMeters, LatLng } from '@saheli/domain';
import { AppError } from '../common/errors';
import { Env } from '../config/env';

export const ROUTING = Symbol('ROUTING');

export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
  /** Recorded on every quote so estimates can be audited. */
  provider: string;
}

export interface RoutingProvider {
  route(from: LatLng, to: LatLng): Promise<RouteEstimate>;
}

/**
 * Development only: straight-line distance × 1.35 road factor at 20 km/h city
 * speed. Quotes produced this way are tagged `estimate-dev`, and staging and
 * production refuse to start with this provider.
 */
export class EstimateRoutingProvider implements RoutingProvider {
  static readonly ROAD_FACTOR = 1.35;
  static readonly SPEED_MPS = 20_000 / 3600;

  async route(from: LatLng, to: LatLng): Promise<RouteEstimate> {
    const distanceMeters = Math.round(
      haversineMeters(from, to) * EstimateRoutingProvider.ROAD_FACTOR,
    );
    return {
      distanceMeters,
      durationSeconds: Math.round(distanceMeters / EstimateRoutingProvider.SPEED_MPS),
      provider: 'estimate-dev',
    };
  }
}

interface GoogleRoutesResponse {
  routes?: { distanceMeters?: number; duration?: string }[];
}

/** Google Maps Platform Routes API (computeRoutes), traffic-aware. */
export class GoogleRoutingProvider implements RoutingProvider {
  private readonly logger = new Logger('GoogleRoutingProvider');

  constructor(private readonly apiKey: string) {}

  async route(from: LatLng, to: LatLng): Promise<RouteEstimate> {
    const waypoint = (p: LatLng) => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    });
    let res: Response;
    try {
      res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: waypoint(from),
          destination: waypoint(to),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        }),
        signal: AbortSignal.timeout(4000),
      });
    } catch (err) {
      this.logger.error({ err }, 'Routes API request failed');
      throw new AppError(
        503,
        'ROUTING_UNAVAILABLE',
        'Could not calculate the route. Please try again',
      );
    }
    if (!res.ok) {
      this.logger.error({ status: res.status }, 'Routes API returned an error');
      throw new AppError(
        503,
        'ROUTING_UNAVAILABLE',
        'Could not calculate the route. Please try again',
      );
    }
    const body = (await res.json()) as GoogleRoutesResponse;
    const route = body.routes?.[0];
    const seconds = route?.duration ? Number.parseInt(route.duration, 10) : NaN;
    if (!route?.distanceMeters || !Number.isFinite(seconds)) {
      throw new AppError(422, 'NO_ROUTE', 'No drivable route was found between these points');
    }
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: seconds,
      provider: 'google-routes',
    };
  }
}

export function createRoutingProvider(env: Env): RoutingProvider {
  return env.MAPS_PROVIDER === 'google'
    ? new GoogleRoutingProvider(env.GOOGLE_MAPS_API_KEY!)
    : new EstimateRoutingProvider();
}
