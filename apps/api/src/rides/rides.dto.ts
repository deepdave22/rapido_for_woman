import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PlaceDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @IsString()
  @Length(3, 300)
  address: string;
}

export class QuoteRequestDto {
  @ValidateNested()
  @Type(() => PlaceDto)
  pickup: PlaceDto;

  @ValidateNested()
  @Type(() => PlaceDto)
  dropoff: PlaceDto;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{3,20}$/)
  promoCode?: string;
}

export class BookRideDto {
  @IsUUID()
  quoteId: string;

  @IsIn(['CASH', 'ONLINE'])
  paymentMethod: 'CASH' | 'ONLINE';
}

export class CancelRideDto {
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class VerifyPinDto {
  @Matches(/^\d{4}$/, { message: 'pin must be 4 digits' })
  pin: string;
}

export class HistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Return rides requested before this ISO time (cursor pagination). */
  @IsOptional()
  @IsString()
  before?: string;
}
