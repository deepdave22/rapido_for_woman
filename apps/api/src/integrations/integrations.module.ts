import { Global, Module } from '@nestjs/common';
import { Env } from '../config/env';
import { createRoutingProvider, ROUTING } from './maps';
import { createPlacesProvider, PLACES } from './places';
import { createStorage, STORAGE } from './storage';

@Global()
@Module({
  providers: [
    { provide: ROUTING, inject: [Env], useFactory: createRoutingProvider },
    { provide: STORAGE, inject: [Env], useFactory: createStorage },
    { provide: PLACES, inject: [Env], useFactory: createPlacesProvider },
  ],
  exports: [ROUTING, STORAGE, PLACES],
})
export class IntegrationsModule {}
