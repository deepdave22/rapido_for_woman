import { Module } from '@nestjs/common';
import { DispatchService } from '../dispatch/dispatch.service';
import { PricingService } from '../pricing/pricing.service';
import { PromotionsModule } from '../promotions/promotions.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { QuotesService } from './quotes.service';
import { RideStateService } from './ride-state.service';
import { RideViews } from './ride-views';
import { DriverRidesController, PassengerRidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [RealtimeModule, PromotionsModule],
  controllers: [PassengerRidesController, DriverRidesController],
  providers: [
    RideStateService,
    DispatchService,
    PricingService,
    QuotesService,
    RidesService,
    RideViews,
  ],
  exports: [RideStateService, DispatchService, RidesService, PricingService, RideViews],
})
export class RidesModule {}
