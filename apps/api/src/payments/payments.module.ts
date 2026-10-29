import { Module } from '@nestjs/common';
import { Env } from '../config/env';
import { RidesModule } from '../rides/rides.module';
import { EarningsService } from './earnings.service';
import { LedgerService } from './ledger.service';
import { createPaymentProvider, PAYMENT_PROVIDER } from './payment-provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [RidesModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    EarningsService,
    LedgerService,
    { provide: PAYMENT_PROVIDER, inject: [Env], useFactory: createPaymentProvider },
  ],
  exports: [PaymentsService, EarningsService],
})
export class PaymentsModule {}
