import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { and, count, desc, eq } from 'drizzle-orm';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { AppError } from '../common/errors';
import { DB, Database } from '../database/database.module';
import { savedPlaces } from '../database/schema';
import { PLACES, PlacesProvider } from '../integrations/places';

class SearchQuery {
  @IsString()
  @Length(2, 100)
  q: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

class SavePlaceDto {
  @IsIn(['HOME', 'WORK', 'OTHER'])
  label: 'HOME' | 'WORK' | 'OTHER';

  @IsString()
  @Length(1, 60)
  name: string;

  @IsString()
  @Length(3, 300)
  address: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

const MAX_SAVED_PLACES = 20;

@ApiTags('places')
@ApiBearerAuth()
@Roles('PASSENGER')
@Controller({ path: 'places', version: '1' })
export class PlacesController {
  constructor(
    @Inject(PLACES) private readonly places: PlacesProvider,
    @Inject(DB) private readonly db: Database,
  ) {}

  /** Address search, done server-side so map API keys never ship in the app. */
  @Get('search')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  search(@Query() q: SearchQuery) {
    const near =
      q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    return this.places.search(q.q, near);
  }

  @Get('saved')
  async saved(@CurrentUser() user: AuthUser) {
    const rows = await this.db
      .select()
      .from(savedPlaces)
      .where(eq(savedPlaces.userId, user.userId))
      .orderBy(savedPlaces.label, desc(savedPlaces.updatedAt));
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      name: r.name,
      address: r.address,
      ...r.location,
    }));
  }

  /** HOME and WORK are replaced if they already exist. */
  @Post('saved')
  async save(@CurrentUser() user: AuthUser, @Body() dto: SavePlaceDto) {
    const values = {
      userId: user.userId,
      label: dto.label,
      name: dto.name,
      address: dto.address,
      location: { lat: dto.lat, lng: dto.lng },
    };
    if (dto.label !== 'OTHER') {
      await this.db
        .delete(savedPlaces)
        .where(and(eq(savedPlaces.userId, user.userId), eq(savedPlaces.label, dto.label)));
    } else {
      const [n] = await this.db
        .select({ n: count() })
        .from(savedPlaces)
        .where(eq(savedPlaces.userId, user.userId));
      if ((n?.n ?? 0) >= MAX_SAVED_PLACES) {
        throw new AppError(
          422,
          'TOO_MANY_SAVED_PLACES',
          `You can save up to ${MAX_SAVED_PLACES} places`,
        );
      }
    }
    const [row] = await this.db.insert(savedPlaces).values(values).returning();
    return {
      id: row!.id,
      label: row!.label,
      name: row!.name,
      address: row!.address,
      ...row!.location,
    };
  }

  @Delete('saved/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    const deleted = await this.db
      .delete(savedPlaces)
      .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, user.userId)))
      .returning({ id: savedPlaces.id });
    if (!deleted.length) throw new AppError(404, 'NOT_FOUND', 'Saved place not found');
  }
}
