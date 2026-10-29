import type {
  ClientApp,
  DriverRide,
  LocationFix,
  Me,
  Offer,
  Onboarding,
  OtpChallenge,
  PassengerRide,
  Place,
  PlaceResult,
  QuoteResponse,
  SavedPlace,
  SessionView,
  TokenResponse,
  Tokens,
  UploadFile,
  VehicleInput,
} from './types';

/** An error returned by the API, with its stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface TokenStore {
  get(): Promise<Tokens | null>;
  set(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export interface ClientOptions {
  baseUrl: string;
  app: ClientApp;
  tokens: TokenStore;
  /** Must return a fresh unique key per call (e.g. expo-crypto randomUUID). */
  newIdempotencyKey: () => string;
  /** Called when the session can no longer be refreshed; the app should show sign-in. */
  onSignedOut?: () => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  idempotencyKey?: string;
  query?: Record<string, string | number | undefined>;
}

const NETWORK_ERROR = 'NETWORK_ERROR';

/**
 * Thin typed wrapper over the REST API. Refreshes the access token once on
 * expiry, sharing one in-flight refresh between concurrent requests (the
 * server treats parallel refreshes of one token as theft).
 */
export class SaheliClient {
  private refreshing: Promise<boolean> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ClientOptions) {
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
  }

  // ---------- auth ----------

  requestOtp(phone: string): Promise<OtpChallenge> {
    return this.request('/v1/auth/otp/request', { method: 'POST', body: { phone }, auth: false });
  }

  async verifyOtp(challengeId: string, code: string, deviceName?: string): Promise<TokenResponse> {
    const res = await this.request<TokenResponse>('/v1/auth/otp/verify', {
      method: 'POST',
      body: { challengeId, code, app: this.opts.app, deviceName },
      auth: false,
    });
    await this.opts.tokens.set({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    return res;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/v1/auth/logout', { method: 'POST' });
    } finally {
      await this.opts.tokens.clear();
    }
  }

  sessions(): Promise<SessionView[]> {
    return this.request('/v1/auth/sessions');
  }

  revokeSession(id: string): Promise<void> {
    return this.request(`/v1/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** The current access token, for authenticating the realtime socket. */
  async accessToken(): Promise<string | null> {
    return (await this.opts.tokens.get())?.accessToken ?? null;
  }

  // ---------- profile ----------

  me(): Promise<Me> {
    return this.request('/v1/me');
  }

  updateMe(changes: {
    fullName?: string;
    email?: string;
    preferredLanguage?: string;
  }): Promise<Me> {
    return this.request('/v1/me', { method: 'PATCH', body: changes });
  }

  acceptTerms(termsVersion: string): Promise<Me> {
    return this.request('/v1/me/terms', { method: 'POST', body: { termsVersion } });
  }

  // ---------- places ----------

  searchPlaces(q: string, near?: { lat: number; lng: number }): Promise<PlaceResult[]> {
    return this.request('/v1/places/search', { query: { q, lat: near?.lat, lng: near?.lng } });
  }

  savedPlaces(): Promise<SavedPlace[]> {
    return this.request('/v1/places/saved');
  }

  savePlace(place: Omit<SavedPlace, 'id'>): Promise<SavedPlace> {
    return this.request('/v1/places/saved', { method: 'POST', body: place });
  }

  deleteSavedPlace(id: string): Promise<void> {
    return this.request(`/v1/places/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ---------- passenger rides ----------

  quote(pickup: Place, dropoff: Place, promoCode?: string): Promise<QuoteResponse> {
    return this.request('/v1/rides/quotes', {
      method: 'POST',
      body: { pickup, dropoff, promoCode },
    });
  }

  /** Pass the same `idempotencyKey` when retrying the same booking after a network error. */
  book(
    quoteId: string,
    paymentMethod: 'CASH' | 'ONLINE',
    idempotencyKey?: string,
  ): Promise<PassengerRide> {
    return this.request('/v1/rides', {
      method: 'POST',
      body: { quoteId, paymentMethod },
      idempotencyKey: idempotencyKey ?? this.opts.newIdempotencyKey(),
    });
  }

  async activeRide(): Promise<PassengerRide | null> {
    return (await this.request<{ ride: PassengerRide | null }>('/v1/rides/active')).ride;
  }

  ride(id: string): Promise<PassengerRide> {
    return this.request(`/v1/rides/${encodeURIComponent(id)}`);
  }

  rideHistory(before?: string): Promise<PassengerRide[]> {
    return this.request('/v1/rides', { query: { limit: 20, before } });
  }

  cancelRide(id: string, reason: string): Promise<PassengerRide> {
    return this.request(`/v1/rides/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: { reason },
    });
  }

  // ---------- driver ----------

  onboarding(): Promise<Onboarding> {
    return this.request('/v1/driver/onboarding');
  }

  saveVehicle(vehicle: VehicleInput): Promise<unknown> {
    return this.request('/v1/driver/vehicle', { method: 'PUT', body: vehicle });
  }

  uploadDocument(type: string, file: UploadFile, expiresOn?: string): Promise<unknown> {
    const form = new FormData();
    form.append('type', type);
    if (expiresOn) form.append('expiresOn', expiresOn);
    form.append('file', file as Blob);
    return this.request('/v1/driver/documents', { method: 'POST', body: form });
  }

  submitForReview(): Promise<Onboarding> {
    return this.request('/v1/driver/submit', { method: 'POST' });
  }

  setOnline(online: boolean): Promise<{ online: boolean }> {
    return this.request('/v1/driver/availability', { method: 'POST', body: { online } });
  }

  sendLocation(fix: LocationFix): Promise<{ accepted: boolean }> {
    return this.request('/v1/driver/location', { method: 'POST', body: fix });
  }

  async currentOffer(): Promise<Offer | null> {
    return (await this.request<{ offer: Offer | null }>('/v1/driver/offers/current')).offer;
  }

  acceptOffer(offerId: string): Promise<DriverRide> {
    return this.request(`/v1/driver/offers/${encodeURIComponent(offerId)}/accept`, {
      method: 'POST',
    });
  }

  rejectOffer(offerId: string): Promise<void> {
    return this.request(`/v1/driver/offers/${encodeURIComponent(offerId)}/reject`, {
      method: 'POST',
    });
  }

  async driverActiveRide(): Promise<DriverRide | null> {
    return (await this.request<{ ride: DriverRide | null }>('/v1/driver/rides/active')).ride;
  }

  driverRideHistory(before?: string): Promise<DriverRide[]> {
    return this.request('/v1/driver/rides', { query: { limit: 20, before } });
  }

  driverRideAction(
    rideId: string,
    action: 'arriving' | 'arrived' | 'start' | 'complete',
  ): Promise<DriverRide> {
    return this.request(`/v1/driver/rides/${encodeURIComponent(rideId)}/${action}`, {
      method: 'POST',
    });
  }

  verifyPin(rideId: string, pin: string): Promise<DriverRide> {
    return this.request(`/v1/driver/rides/${encodeURIComponent(rideId)}/verify-pin`, {
      method: 'POST',
      body: { pin },
    });
  }

  driverCancel(rideId: string, reason: string): Promise<{ rideId: string; status: 'SEARCHING' }> {
    return this.request(`/v1/driver/rides/${encodeURIComponent(rideId)}/cancel`, {
      method: 'POST',
      body: { reason },
    });
  }

  // ---------- transport ----------

  /** Escape hatch for endpoints without a typed method yet. */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const res = await this.send(path, options);
    if (res.status === 401 && options.auth !== false) {
      const body = await this.readBody(res);
      const code = (body as { error?: { code?: string } })?.error?.code;
      if (code === 'ACCESS_TOKEN_INVALID' && (await this.refresh())) {
        return this.parse<T>(await this.send(path, options));
      }
      throw this.toError(res, body);
    }
    return this.parse<T>(res);
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    if (options.auth !== false) {
      const tokens = await this.opts.tokens.get();
      if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
    }
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    const query = Object.entries(options.query ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}${path}${query ? `?${query}` : ''}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15_000);
    try {
      return await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(0, NETWORK_ERROR, 'No connection. Check your internet and try again');
    } finally {
      clearTimeout(timer);
    }
  }

  private refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const tokens = await this.opts.tokens.get();
        if (!tokens) return false;
        const res = await this.send('/v1/auth/refresh', {
          method: 'POST',
          body: { refreshToken: tokens.refreshToken },
          auth: false,
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            await this.opts.tokens.clear();
            this.opts.onSignedOut?.();
          }
          return false;
        }
        const next = (await res.json()) as TokenResponse;
        await this.opts.tokens.set({
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
        });
        return true;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async parse<T>(res: Response): Promise<T> {
    const body = await this.readBody(res);
    if (!res.ok) {
      if (res.status === 401) {
        await this.opts.tokens.clear();
        this.opts.onSignedOut?.();
      }
      throw this.toError(res, body);
    }
    return body as T;
  }

  private async readBody(res: Response): Promise<unknown> {
    if (res.status === 204) return undefined;
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private toError(res: Response, body: unknown): ApiError {
    const err = (
      body as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } }
    )?.error;
    return new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? 'Something went wrong. Please try again.',
      err?.details,
      err?.requestId,
    );
  }
}
