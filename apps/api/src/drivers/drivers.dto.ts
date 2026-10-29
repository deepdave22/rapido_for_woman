import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const DOCUMENT_TYPES = [
  'PROFILE_PHOTO',
  'IDENTITY_PROOF',
  'DRIVING_LICENCE',
  'VEHICLE_RC',
  'VEHICLE_INSURANCE',
  'VEHICLE_PERMIT',
  'VEHICLE_FITNESS',
  'POLLUTION_CERTIFICATE',
] as const;

export class UpsertVehicleDto {
  @IsIn(['BIKE', 'AUTO', 'CAB'])
  categoryCode: string;

  /** Indian registration, e.g. "KA01AB1234" (spaces and dashes are removed). */
  @IsString()
  @Matches(/^[A-Za-z]{2}[\s-]?\d{1,2}[\s-]?[A-Za-z]{0,3}[\s-]?\d{1,4}$/, {
    message: 'registrationNumber is not a valid Indian registration number',
  })
  registrationNumber: string;

  @IsString()
  @Length(2, 40)
  make: string;

  @IsString()
  @Length(1, 40)
  model: string;

  @IsString()
  @Length(2, 30)
  colour: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1990)
  @Max(2100)
  manufactureYear?: number;
}

export class UploadDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  type: (typeof DOCUMENT_TYPES)[number];

  /** Expiry printed on the document (YYYY-MM-DD), where it has one. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiresOn?: string;
}

export class SetAvailabilityDto {
  @IsBoolean()
  online: boolean;
}

export class LocationUpdateDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  /** GPS accuracy radius in metres as reported by the device. */
  @IsNumber()
  @Min(0)
  @Max(10000)
  accuracyM: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  headingDeg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(70)
  speedMps?: number;

  /** Device time the fix was taken. */
  @IsISO8601({ strict: true })
  recordedAt: string;
}
