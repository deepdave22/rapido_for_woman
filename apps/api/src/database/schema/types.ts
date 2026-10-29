import { customType, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Parses a PostGIS EWKB point as returned by node-postgres (hex string).
 * Layout: byte order (1) | type (4, with SRID flag) | [srid (4)] | x (8) | y (8).
 */
export function parseEwkbPoint(hex: string): LatLng {
  const buf = Buffer.from(hex, 'hex');
  const le = buf.readUInt8(0) === 1;
  const type = le ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  const hasSrid = (type & 0x20000000) !== 0;
  if ((type & 0xff) !== 1) throw new Error('Expected a POINT geometry');
  const offset = hasSrid ? 9 : 5;
  const x = le ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
  const y = le ? buf.readDoubleLE(offset + 8) : buf.readDoubleBE(offset + 8);
  return { lng: x, lat: y };
}

/** geography(Point, 4326). Distances computed on it are in metres. */
export const geographyPoint = customType<{ data: LatLng; driverData: string }>({
  dataType() {
    return 'geography(point, 4326)';
  },
  toDriver(value: LatLng) {
    return sql`ST_SetSRID(ST_MakePoint(${value.lng}, ${value.lat}), 4326)::geography`;
  },
  fromDriver(value: string): LatLng {
    return parseEwkbPoint(value);
  },
});

/** geography(MultiPolygon, 4326) for service-zone boundaries; written via raw SQL. */
export const geographyMultiPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(multipolygon, 4326)';
  },
});

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
