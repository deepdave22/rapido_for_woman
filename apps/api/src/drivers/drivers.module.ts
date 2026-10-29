import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { DriverEligibilityService } from './driver-eligibility.service';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({
  imports: [RealtimeModule],
  controllers: [DriversController],
  providers: [DriversService, DriverEligibilityService],
  exports: [DriverEligibilityService],
})
export class DriversModule {}
