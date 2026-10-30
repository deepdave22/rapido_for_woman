# Launch blockers, external services, and known limitations

Nothing here is resolved by code alone. Each item needs a decision, an account, or
professional advice before a pilot.

## Legal and regulatory (need qualified Indian counsel)

| #   | Question                                                                                         | Why it blocks                                                                         |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| L1  | Is a women-only passenger **and** driver service lawful in each launch state, and on what basis? | Core business model. Must not be assumed.                                             |
| L2  | How may passenger eligibility be established? Self-declaration, document check, or other?        | `passenger_profiles.eligibility_status` exists. The method is deliberately undecided. |
| L3  | How may driver gender eligibility be verified with minimum data retained?                        | Sensitive personal data under the DPDP Act.                                           |
| L4  | Aggregator licensing under the Motor Vehicle Aggregator Guidelines 2020 and each state's rules   | Required to operate.                                                                  |
| L5  | Bike-taxi legality per state                                                                     | Varies by state and has been actively litigated.                                      |
| L6  | Commercial permits, insurance cover for passengers and drivers, and accident liability           | Required to carry passengers.                                                         |
| L7  | GST treatment and rate for each category, plus the aggregator's tax obligations                  | Fare tax rate is a placeholder (ADR-005).                                             |
| L8  | DPDP Act: notices, consent, retention periods, grievance officer, data-principal requests        | Personal data processing.                                                             |
| L9  | Background-check provider and what is lawful to collect                                          | Driver onboarding.                                                                    |

## Operational

| #   | Item                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | A **staffed 24×7 safety response team** with written procedures. SOS screens must state honestly what happens; no emergency-service integration exists.           |
| O2  | Integration with emergency services (for example 112) only after verifying what each state supports. Until then, the app must not claim authorities are notified. |
| O3  | Customer support staffing and SLAs.                                                                                                                               |
| O4  | Driver supply plan for each launch zone. Without it, every ride ends as NO_DRIVER_FOUND.                                                                          |

## External services and credentials

| Service                                                                         | Purpose                               | Status                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| SMS / OTP (e.g. MSG91, Twilio Verify, Gupshup)                                  | Login codes                           | **Not integrated.** `OTP_PROVIDER=msg91` fails startup on purpose. Requires DLT registration for Indian SMS (entity, header, template).        |
| Maps & routing (Google Maps Platform, Ola Maps, or MapmyIndia)                  | Geocoding, autocomplete, routes, ETAs | Not integrated (Phase 3). Needs billing, API keys, and a licence review for storing results.                                                   |
| Payment gateway (e.g. Razorpay)                                                 | UPI/card collection, refunds, payouts | Not integrated (Phase 4). Needs merchant KYC, webhook secret, and a decision on a payouts product.                                             |
| Push (Expo push service, relaying to FCM and APNs)                              | Ride notifications                    | **Code integrated** (`PUSH_PROVIDER=expo`, tested with a fake sender). Needs a Firebase project, FCM key and Apple account: MOBILE_RELEASE.md. |
| Identity / document verification (e.g. DigiLocker-based, licence/RC check APIs) | Driver verification                   | Not integrated. Provider choice depends on L3 and L9.                                                                                          |
| Object storage (S3-compatible, private bucket)                                  | Driver documents                      | Not integrated.                                                                                                                                |
| Hosting (managed Postgres with PostGIS, managed Redis, container platform)      | Staging and production                | Not provisioned. An Indian region is preferred for latency and data-localisation questions (L8).                                               |
| Error tracking (e.g. Sentry)                                                    | Monitoring                            | Not integrated.                                                                                                                                |
| Expo (EAS), Apple App Store and Google Play developer accounts                  | Builds and distribution               | Not created. Everything else for store builds is configured: MOBILE_RELEASE.md.                                                                |

## Known limitations (current code)

- **Mobile apps are not yet tested on devices, and no store build exists yet.** They
  typecheck, pass `expo-doctor`, and bundle for Android and iOS in CI. Native builds need an
  Expo account (MOBILE_RELEASE.md).
- Driver background location is implemented (foreground service with a visible
  notification, Play's prominent disclosure first) but untested on devices. It still needs
  Play's location and foreground-service declarations and App Review.
- Reviewers sign in with sandboxed review accounts (MOBILE_RELEASE.md, "Reviewer access").
  Outside Bengaluru they cannot complete a full ride, so a demo video is needed.
- Push "SENT" means the Expo push service accepted the message; delivery receipts are not
  polled yet.
- Map tiles on Android need `GOOGLE_MAPS_ANDROID_KEY`. Real routing and place search need
  `MAPS_PROVIDER=google`. The Google adapters are written to the documented APIs but have
  not been called with a live key.
- The S3 storage adapter is not written. `STORAGE_PROVIDER=s3` fails at startup by design.
- In-app online checkout is not built: the API creates gateway orders and processes signed
  webhooks, but the app cannot yet open Razorpay checkout. Cash rides work end to end.
- No SMS provider: SOS cannot actually message trusted contacts, and the app says so.
  Integrate a DLT-registered SMS provider before pilot (also needed for OTP).
- Refunds are absorbed by platform revenue; cancellation fees are treated as tax-inclusive.
  Both need finance and tax review (L7).
- The HTTP throttler keeps counters in memory per instance and is disabled in
  `NODE_ENV=test`. The OTP limits stored in the database still apply everywhere.
- Account deletion is available in both apps. Data export exists in the API (`GET /v1/me/export`) but has no screen in the apps yet.
- Admin dashboard has no QR code for TOTP enrolment or live map; staff must keep the incident
  queue open (it polls every 10 s). A paging/alerting integration for new SOS is needed before pilot.
- TOTP codes can be replayed within their 30-second window (no used-code tracking yet).
