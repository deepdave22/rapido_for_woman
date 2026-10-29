import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { RidesModule } from '../rides/rides.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminDriversController, AdminDriversService } from './admin-drivers';
import { AdminFinanceController } from './admin-finance';
import { AdminOpsController } from './admin-ops';
import { AdminSafetyController } from './admin-safety';
import { StaffAuthService, StaffGuard } from './staff-auth';

@Module({
  imports: [RidesModule, PaymentsModule],
  controllers: [
    AdminAuthController,
    AdminDriversController,
    AdminOpsController,
    AdminSafetyController,
    AdminFinanceController,
  ],
  providers: [StaffAuthService, StaffGuard, AdminDriversService],
})
export class AdminModule {}
