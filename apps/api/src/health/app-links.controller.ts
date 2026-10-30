import { Controller, Get, Header, NotFoundException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.decorators';
import { Env } from '../config/env';

/** Must match android.package / ios.bundleIdentifier in apps/passenger/app.config.ts. */
const PASSENGER_APP_ID = 'in.saheli.passenger';
/** Paths the passenger app opens directly (expo-router route /ride/[id]). */
const PASSENGER_LINK_PATHS = ['/ride/*'];

/**
 * Verification files for Android App Links and iOS Universal Links. Served
 * only when the signing details are configured, so an unconfigured server
 * never claims links for an app it cannot vouch for.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller({ path: '.well-known', version: VERSION_NEUTRAL })
export class AppLinksController {
  constructor(private readonly env: Env) {}

  @Get('assetlinks.json')
  @Header('Cache-Control', 'public, max-age=3600')
  assetLinks() {
    if (!this.env.ANDROID_APP_LINK_SHA256) throw new NotFoundException();
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: PASSENGER_APP_ID,
          sha256_cert_fingerprints: this.env.ANDROID_APP_LINK_SHA256.split(','),
        },
      },
    ];
  }

  @Get('apple-app-site-association')
  @Header('Content-Type', 'application/json')
  @Header('Cache-Control', 'public, max-age=3600')
  appleAppSiteAssociation() {
    if (!this.env.IOS_TEAM_ID) throw new NotFoundException();
    return {
      applinks: {
        details: [
          {
            appIDs: [`${this.env.IOS_TEAM_ID}.${PASSENGER_APP_ID}`],
            components: PASSENGER_LINK_PATHS.map((path) => ({ '/': path })),
          },
        ],
      },
    };
  }
}
