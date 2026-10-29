import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { PaymentsModule } from '../payments/payments.module';
import { MaintenanceService } from './maintenance.service';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [DriversModule, PaymentsModule],
  controllers: [PrivacyController],
  providers: [MaintenanceService, PrivacyService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
