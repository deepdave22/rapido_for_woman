import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';
import { SupportService } from './support.service';

@Module({
  controllers: [SafetyController],
  providers: [SafetyService, SupportService, NotificationsService],
  exports: [SafetyService, SupportService, NotificationsService],
})
export class SafetyModule {}
