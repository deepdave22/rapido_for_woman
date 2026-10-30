# Mobile release: Android and iOS

How the passenger app (**Saheli**) and the driver app (**Saheli Driver**) are built, signed,
tested and submitted to Google Play and the App Store. Both are native React Native apps
(Expo SDK 54, TypeScript), built in the cloud with EAS Build and submitted with EAS Submit.
The admin dashboard is a separate web app; the API is deployed separately (see DEPLOYMENT.md).

> **Status (2026-10-30).** All configuration in this repository is done and checked locally
> (see [What has been verified](#what-has-been-verified)). **No `.aab` or `.ipa` has been
> built yet, and nothing has been submitted, published or approved.** Building needs an Expo
> account, and submitting needs Google Play and Apple developer accounts, which only the owner
> can create. Steps marked **(owner)** need you.

## What is configured

| Item                     | Passenger                                                                           | Driver                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Android package / iOS ID | `in.saheli.passenger`                                                               | `in.saheli.driver`                                                             |
| Icon, adaptive icon      | `apps/passenger/assets/` (berry)                                                    | `apps/driver/assets/` (saffron)                                                |
| Android 13 themed icon   | `monochrome-icon.png`                                                               | `monochrome-icon.png`                                                          |
| Splash screen            | `expo-splash-screen`, berry background                                              | `expo-splash-screen`, saffron background                                       |
| Location                 | While in use only; background location blocked                                      | While in use **and background** (foreground service with visible notification) |
| Other Android permission | Internet, vibrate, notifications                                                    | Same, plus `FOREGROUND_SERVICE(_LOCATION)`                                     |
| iOS background modes     | None                                                                                | `location` only (the unused `fetch` mode is removed)                           |
| Push notifications       | `expo-notifications`, channel `rides`, notification icon                            | Same                                                                           |
| Deep links               | `saheli://ride/<id>`; optional `https://<APP_LINK_HOST>/ride/<id>`                  | `saheli-driver://…`                                                            |
| Account deletion         | In-app (Account → Delete account)                                                   | In-app (Account → Delete account)                                              |
| Export compliance        | `usesNonExemptEncryption: false` (HTTPS only)                                       | Same                                                                           |
| Build profiles           | `apps/passenger/eas.json`: `preview` (APK / ad hoc), `production` (AAB / App Store) | `apps/driver/eas.json`, the same                                               |

Release builds refuse to build unless `EXPO_PUBLIC_API_URL` is `https://…` and the EAS project
id is set (`app.config.ts`), so a store build can never point at a development server.

Icons and splash marks are original placeholders drawn by `scripts/generate-app-assets.mjs`.
Replace them, and the name "Saheli", once the brand and trademark search are settled
(LAUNCH_BLOCKERS). **Package names and bundle IDs cannot be changed after the first store
upload.** Decide them first: use a domain you control, reversed (e.g. `com.yourcompany.rider`).
To change them, edit `app.config.ts` in each app and `PASSENGER_APP_ID` in
`apps/api/src/health/app-links.controller.ts`.

## Accounts and services (owner)

| Account                 | Cost (2026)                  | Needed for                                             | Notes                                                                                                                                                  |
| ----------------------- | ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Expo (expo.dev)         | Free tier is enough to start | EAS Build, EAS Submit, push relay                      | Create an organisation for the company so builds and credentials are not tied to one person.                                                           |
| Google Play Console     | US$25 once                   | Android distribution                                   | Register as an **organisation** (needs a D-U-N-S number). New personal accounts must run a closed test with 12+ testers for 14 days before production. |
| Apple Developer Program | US$99 per year               | iOS distribution, TestFlight, APNs                     | Enrol as an **organisation** (needs a D-U-N-S number and legal entity).                                                                                |
| Firebase project        | Free                         | Android push (FCM)                                     | One project; add both Android apps.                                                                                                                    |
| A domain and website    | ~₹1,000 per year             | Privacy policy, support page, deletion page, app links | Both stores require a public privacy policy URL; Play requires a public account-deletion URL.                                                          |
| Production API on HTTPS | See DEPLOYMENT.md            | Every release build                                    | Not deployed yet.                                                                                                                                      |

## One-time setup

All commands run from the app folder (`apps/passenger` or `apps/driver`), once per app.
The EAS CLI version is pinned for reproducibility.

```bash
npx eas-cli@27.2.0 login                     # (owner) the Expo account or organisation
npx eas-cli@27.2.0 init                      # creates the EAS project and prints its id
```

1. **Project id.** Paste the printed id into `EAS_PROJECT_ID` in that app's `app.config.ts`
   (it is not a secret; commit it). If the project belongs to an organisation, set
   `EXPO_OWNER` to its name (in your shell and as an EAS environment variable).
2. **Environment variables**, per EAS environment (`preview` = staging API,
   `production` = live API). Release builds read these, not `.env`:

   ```bash
   npx eas-cli@27.2.0 env:create --environment production --name EXPO_PUBLIC_API_URL \
     --value https://api.YOUR-DOMAIN --visibility plaintext
   npx eas-cli@27.2.0 env:create --environment production --name GOOGLE_SERVICES_JSON \
     --type file --value ./google-services.json --visibility secret
   # Passenger only:
   npx eas-cli@27.2.0 env:create --environment production --name GOOGLE_MAPS_ANDROID_KEY \
     --value YOUR-RESTRICTED-KEY --visibility sensitive
   npx eas-cli@27.2.0 env:create --environment production --name APP_LINK_HOST \
     --value go.YOUR-DOMAIN --visibility plaintext   # optional, see Deep links
   ```

   Repeat with `--environment preview` and the staging values.

3. **Push notifications.**
   - Firebase console → add an Android app for each package → download its
     `google-services.json` (used above; never commit it, it is gitignored).
   - Firebase → Project settings → Service accounts → generate a key, then
     `npx eas-cli@27.2.0 credentials` → Android → production → Google Service Account →
     "Manage your FCM V1 service account key" → upload it.
   - iOS: EAS creates the APNs key during the first iOS build when you sign in to your
     Apple account (or `eas credentials` → iOS → Push Notifications).
   - API: set `PUSH_PROVIDER=expo`. If you turn on "Enhanced push security" in the Expo
     project, also set `EXPO_ACCESS_TOKEN`. With `PUSH_PROVIDER=none` pushes are recorded as
     `SKIPPED`, never as sent.
4. **Deep links (optional).** Custom schemes work with no setup. For HTTPS links that open
   the passenger app, choose a host (e.g. `go.YOUR-DOMAIN`) whose `/.well-known/` path is routed
   to the API, set `APP_LINK_HOST` as above, and set on the API:
   `ANDROID_APP_LINK_SHA256` (Play Console → Test and release → App integrity → App signing
   key certificate SHA-256, plus the upload key's, comma-separated) and `IOS_TEAM_ID`.
   The API then serves `assetlinks.json` and `apple-app-site-association`; until both are
   set it serves neither.

## Signing

- **Android.** On the first build EAS offers to generate the upload keystore and stores it.
  Download a backup at once (`eas credentials` → Android → Keystore → download) and keep it
  offline with the company's other secrets. Enrol in **Play App Signing** when creating the
  app (the default): Google keeps the app signing key, and the EAS key is only the upload key,
  so a lost upload key can be reset through Play support.
- **iOS.** On the first build EAS signs in to your Apple account and creates the
  distribution certificate and App Store provisioning profile (and registers the bundle ID).
  You can instead supply your own in `eas credentials`. Use an Apple ID with the Admin or
  App Manager role, or an App Store Connect API key.

## Building

```bash
cd apps/passenger                     # then the same in apps/driver
npx eas-cli@27.2.0 build --platform android --profile production   # → .aab for Google Play
npx eas-cli@27.2.0 build --platform ios --profile production       # → .ipa for App Store Connect
npx eas-cli@27.2.0 build --platform all --profile production       # both
```

- Artifacts are downloaded from the build page on expo.dev or listed with
  `eas build:list`. Build numbers (`versionCode`, `buildNumber`) are stored by EAS and bumped
  automatically on every production build. Bump the user-visible `version` in `app.config.ts`
  for each release.
- **Preview builds** (`--profile preview`) point at the staging API: an installable `.apk`
  for Android, and an ad hoc `.ipa` for iPhones registered with `eas device:create`.
  Use them for QA before anything goes to the stores.
- Remote push does not work in Expo Go; test push with preview or TestFlight builds.
- Local builds are possible (`eas build --local`), but need the Android SDK and JDK 17 on
  macOS or Linux, and macOS with Xcode for iOS. Windows cannot build iOS locally.

## Submitting

**Google Play**

1. (owner) Play Console → Create app (name, default language English (India), app, free).
2. The **first upload must be manual**: Test and release → Testing → Internal testing →
   create a release → upload the `.aab` from EAS. Google's API cannot create an app's first release.
3. After that: `npx eas-cli@27.2.0 submit --platform android --profile production`
   (uploads the latest build to the internal track as a draft). It needs a Google Cloud
   service account with release access in Play Console, uploaded once via `eas credentials`.

**App Store**

1. (owner) App Store Connect → Apps → New app (platform iOS, bundle ID from the build, SKU).
2. `npx eas-cli@27.2.0 submit --platform ios --profile production`. EAS uses an App Store
   Connect API key (it can create one for you). The build appears in TestFlight after Apple
   finishes processing it (usually 10-30 minutes). Export compliance is already answered
   by `usesNonExemptEncryption: false`.

## Testing before release

**TestFlight (iOS)**

- _Internal testing_: up to 100 members of your App Store Connect team; no review; builds
  are available as soon as processing finishes.
- _External testing_: up to 10,000 testers by email or public link; the first build of each
  version goes through Beta App Review. Fill in "Test information": what to test, a contact,
  and **sign-in details for the reviewer** (see the next point).
- **Reviewer access is an open decision.** Sign-in is by SMS OTP to an Indian number, so
  Apple's and Google's reviewers cannot sign in unaided. Options: a dedicated review phone
  number whose SMS the team relays during review, or a single allow-listed review number
  with a fixed code on a review-only environment. Neither is built; choose one with the
  security reviewer, because a fixed code in production is a backdoor if done carelessly.
  The driver app also needs an **approved** review driver account in that environment.

**Google Play**

- _Internal testing_: up to 100 testers by email list; available within minutes; no review.
- _Closed testing_: by email lists or Google Groups. Personal developer accounts created after
  November 2023 must keep 12+ testers in a closed test for 14 days before applying for production.
- Check the _pre-launch report_ (automatic crawls on real devices) for crashes and
  accessibility issues on each upload.
- App content → **App access**: give the same reviewer sign-in instructions as for Apple.

Test both apps on low-end Android phones common among drivers (2-3 GB RAM, Android 10-14),
and the driver app with the screen off and the app swiped away while online.

## Store listings

Draft text, to be reviewed by counsel (the women-only positioning is legal question L1 in
LAUNCH_BLOCKERS) and by whoever owns the brand. Do not use another company's name or marks.

| Field                   | Passenger                                                                                                                  | Driver                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| App name (≤30)          | Saheli: Rides for Women                                                                                                    | Saheli Driver                                                |
| Short description (≤80) | Book bike, auto and cab rides with verified women drivers.                                                                 | Drive with Saheli. Ride requests for verified women drivers. |
| Category                | Play: Maps & Navigation. App Store: Travel                                                                                 | Play: Maps & Navigation. App Store: Navigation               |
| Content rating          | IARC questionnaire: no user-generated public content, shares location → typically rated 3+/Everyone with "Shares location" | Same                                                         |
| Target audience         | 18+                                                                                                                        | 18+                                                          |
| Ads                     | None                                                                                                                       | None                                                         |
| Required URLs           | Privacy policy, support, account deletion (Play)                                                                           | Same                                                         |

Full description (passenger), as a starting point: _"Saheli connects women passengers with
verified women drivers in your city. See the fare before you book, share your trip live with
people you trust, and confirm your ride with a PIN at pickup. Every driver's identity,
licence and vehicle documents are checked before she can go online. In an emergency, the SOS
button alerts our safety team; always call 112 if you are in danger."_ Only describe safety
features that are actually staffed and working at launch (RUNBOOK, LAUNCH_BLOCKERS O1).

## Screenshots and graphics

| Store       | Required                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Play | App icon 512 × 512 (`assets/store-icon-512.png`); feature graphic 1024 × 500 (to design); 2-8 phone screenshots, 9:16, each side 320-3840 px            |
| App Store   | 6.9-inch iPhone screenshots (1320 × 2868 or 1290 × 2796), 1-10 per language; no iPad set (`supportsTablet: false`). The 1024 icon comes from the build. |

Capture them from preview builds against staging with synthetic accounts, never real people's
names, numbers or addresses. Suggested set: sign-in; choose pickup and drop; fare options;
driver on the way (map, vehicle, PIN); safety screen; ride history. Driver: onboarding
checklist; online with an incoming request; ride in progress; earnings.

## Privacy disclosures

Answer Play's **Data safety** form and Apple's **App Privacy** questions from this table.
Neither app has ads, analytics SDKs or tracking across other companies' apps (Apple
"Tracking": **No**). All data is encrypted in transit (HTTPS). Users can delete their account
in the app; Play also needs the public deletion URL.

| Data                                      | Passenger                               | Driver              | Purpose                                  | Linked to user |
| ----------------------------------------- | --------------------------------------- | ------------------- | ---------------------------------------- | -------------- |
| Phone number                              | ✔                                       | ✔                   | Account, sign-in, ride contact           | Yes            |
| Name; email (optional)                    | ✔                                       | ✔                   | Account                                  | Yes            |
| Precise location, while using the app     | ✔                                       | ✔                   | Pickup, matching, live trip tracking     | Yes            |
| Precise location, **in the background**   | ✘ (blocked)                             | ✔ while online only | Ride requests, passenger's live tracking | Yes            |
| Photos / documents (ID, licence, vehicle) | ✘                                       | ✔                   | Driver verification                      | Yes            |
| Purchase history (rides, fares, payments) | ✔                                       | ✔ (trips, earnings) | App functionality, receipts, accounting  | Yes            |
| Payment card / UPI details                | ✘ handled by Razorpay, not stored by us | ✘                   | n/a                                      | n/a            |
| Trusted contacts' phone numbers           | ✔ (entered by the user)                 | ✘                   | Safety: trip sharing, SOS alerts         | Yes            |
| Support messages                          | ✔                                       | ✔                   | Customer support                         | Yes            |
| Device identifier (push token)            | ✔                                       | ✔                   | Notifications                            | Yes            |
| Crash and diagnostics                     | ✘ (none collected yet)                  | ✘                   | n/a                                      | n/a            |

Update this table, the store forms and the privacy policy together whenever the apps start
collecting something new (e.g. when crash reporting is added).

**iOS privacy manifest.** Expo SDK 54 modules ship their own `PrivacyInfo.xcprivacy` files
and EAS merges them. After the first iOS build, check App Store Connect's privacy report for
any missing "required reason" API declarations.

**Google Play declarations for the driver app** (Play Console → App content):

- _Location permissions_: explain that background location is used only while the driver is
  online, to send nearby ride requests and power the passenger's live tracking; attach a short
  video (YouTube link) showing the in-app disclosure, the system prompt, and the feature.
  The disclosure dialog is in `apps/driver/src/useLocationSharing.ts` and appears before the
  system prompt, as Play requires.
- _Foreground service_: type `location`, same justification and video.

The passenger app does not request background location (it is blocked in the manifest).

## Release checklist

1. Legal answers for L1-L3 and a privacy policy (LAUNCH_BLOCKERS).
2. Final app names, package names / bundle IDs and icons.
3. Production API deployed on HTTPS, with `PUSH_PROVIDER=expo` (DEPLOYMENT.md).
4. Accounts: Expo, Play Console, Apple Developer, Firebase (owner).
5. One-time setup above; build `preview`, QA on real devices; fix issues.
6. Build `production` for both platforms; submit to TestFlight and Play internal testing.
7. Reviewer access, store listings, screenshots, Data safety / App Privacy, location declarations.
8. Closed/external testing with real pilot users; then submit for review and staged rollout.

## What has been verified

Checked on Windows 11 on 2026-10-30, without any accounts:

- `tsc` typecheck of both apps and `mobile-core`; `expo-doctor` 18/18 checks pass for both apps.
- Release JavaScript bundles (Hermes) for **Android and iOS** for both apps, with
  `APP_VARIANT=production`.
- Release guards: a production config with an `http://` API URL or without the EAS project
  id fails to resolve.
- `expo prebuild` for Android: the generated `AndroidManifest.xml` contains only the
  permissions listed above (storage, audio and overlay permissions removed).
- iOS `Info.plist` and entitlements via `expo config --type introspect` (iOS projects
  cannot be generated on Windows): background mode `location` only for the driver, none for
  the passenger, push entitlement, associated domains when `APP_LINK_HOST` is set.
- Both `eas.json` files parse with EAS's own schema library (`@expo/eas-json`).
- API: push token endpoints, Expo push sender, ride-event pushes and the app-link files
  have unit and integration tests.

**Not verified:** a native compile (`gradlew` / Xcode), running on a device, background
location with the screen off, receiving a real push, the store review itself. All need the
accounts or a device.
