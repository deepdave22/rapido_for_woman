import { Body, Controller, Delete, HttpCode, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, Matches } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { NotificationsService } from './notifications.service';

/** Expo push tokens look like ExponentPushToken[xxxxxxxx]. */
const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

class RegisterPushTokenDto {
  @Matches(EXPO_PUSH_TOKEN, { message: 'token must be an Expo push token' })
  token: string;

  @IsIn(['ANDROID', 'IOS'])
  platform: 'ANDROID' | 'IOS';
}

class RemovePushTokenDto {
  @Matches(EXPO_PUSH_TOKEN, { message: 'token must be an Expo push token' })
  token: string;
}

@ApiTags('me')
@ApiBearerAuth()
@Controller({ path: 'me/push-token', version: '1' })
export class PushTokensController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Registers this device for ride notifications. Safe to repeat on every launch. */
  @Put()
  @HttpCode(204)
  async register(@CurrentUser() user: AuthUser, @Body() dto: RegisterPushTokenDto): Promise<void> {
    await this.notifications.registerToken(user, dto.token, dto.platform);
  }

  @Delete()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Body() dto: RemovePushTokenDto): Promise<void> {
    await this.notifications.removeToken(user, dto.token);
  }
}
