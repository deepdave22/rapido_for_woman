import { Module } from '@nestjs/common';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';
import { SupportService } from './support.service';

@Module({
  controllers: [SafetyController],
  providers: [SafetyService, SupportService],
  exports: [SafetyService, SupportService],
})
export class SafetyModule {}
