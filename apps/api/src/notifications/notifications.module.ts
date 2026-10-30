import { Global, Module } from '@nestjs/common';
import { Env } from '../config/env';
import { NotificationsService } from './notifications.service';
import { createPushSender, PUSH_SENDER } from './push-sender';
import { PushTokensController } from './push-tokens.controller';

@Global()
@Module({
  controllers: [PushTokensController],
  providers: [
    NotificationsService,
    { provide: PUSH_SENDER, inject: [Env], useFactory: createPushSender },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
