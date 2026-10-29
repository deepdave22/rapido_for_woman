import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class TrustedContactDto {
  @IsString()
  @Length(1, 60)
  name: string;

  @IsString()
  @Length(10, 20)
  phone: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  relationship?: string;
}

export class SosDto {
  /** Defaults to the caller's current ride. */
  @IsOptional()
  @IsUUID()
  rideId?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

export const REPORTABLE_TYPES = [
  'HARASSMENT',
  'ROUTE_DEVIATION',
  'UNSAFE_DRIVING',
  'VEHICLE_MISMATCH',
  'OTHER',
] as const;

export class ReportIncidentDto {
  @IsIn(REPORTABLE_TYPES)
  type: (typeof REPORTABLE_TYPES)[number];

  @IsOptional()
  @IsUUID()
  rideId?: string;

  @IsString()
  @Length(5, 2000)
  description: string;
}

export class RatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  comment?: string;
}

export const TICKET_CATEGORIES = [
  'RIDE_ISSUE',
  'PAYMENT',
  'LOST_ITEM',
  'ACCOUNT',
  'SAFETY',
  'APPEAL',
  'OTHER',
] as const;

export class CreateTicketDto {
  @IsIn(TICKET_CATEGORIES)
  category: (typeof TICKET_CATEGORIES)[number];

  @IsString()
  @Length(3, 120)
  subject: string;

  @IsString()
  @Length(5, 4000)
  message: string;

  @IsOptional()
  @IsUUID()
  rideId?: string;
}

export class TicketMessageDto {
  @IsString()
  @Length(1, 4000)
  body: string;
}
