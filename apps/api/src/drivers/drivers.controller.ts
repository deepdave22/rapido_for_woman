import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { clientInfo } from '../auth/auth.controller';
import { AuthenticatedRequest, AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import {
  LocationUpdateDto,
  SetAvailabilityDto,
  UploadDocumentDto,
  UpsertVehicleDto,
} from './drivers.dto';
import { DriversService } from './drivers.service';

@ApiTags('driver')
@ApiBearerAuth()
@Roles('DRIVER')
@Controller({ path: 'driver', version: '1' })
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  /** Onboarding checklist: vehicle, documents, verification checks, and whether it can be submitted. */
  @Get('onboarding')
  onboarding(@CurrentUser() user: AuthUser) {
    return this.drivers.onboarding(user.userId);
  }

  @Put('vehicle')
  upsertVehicle(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertVehicleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.drivers.upsertVehicle(user.userId, dto, clientInfo(req));
  }

  /** Multipart upload (field `file`). JPEG, PNG or PDF, at most 10 MB; type checked from content. */
  @Post('documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 + 1, files: 1 } }),
  )
  uploadDocument(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.drivers.uploadDocument(user.userId, dto, file, clientInfo(req));
  }

  @Post('submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Req() req: AuthenticatedRequest) {
    return this.drivers.submitForReview(user.userId, clientInfo(req));
  }

  /** Going online requires an approved, fully verified driver and vehicle. */
  @Post('availability')
  @HttpCode(200)
  setAvailability(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetAvailabilityDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.drivers.setAvailability(user.userId, dto.online, clientInfo(req));
  }

  /** GPS fix while online. Returns `accepted: false` when thinned (too soon after the last). */
  @Post('location')
  @HttpCode(202)
  location(@CurrentUser() user: AuthUser, @Body() dto: LocationUpdateDto) {
    return this.drivers.updateLocation(user.userId, dto);
  }
}
