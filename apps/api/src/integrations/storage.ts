import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Env } from '../config/env';

export const STORAGE = Symbol('STORAGE');

/** Private object storage. Keys are server-generated; never derived from user input. */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

/** Development only: writes files under STORAGE_LOCAL_DIR. Refused in staging/production. */
export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Storage key escapes the storage root');
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { mode: 0o600 });
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }
}

export function createStorage(env: Env): ObjectStorage {
  if (env.STORAGE_PROVIDER === 's3') {
    // Fail at startup rather than accept uploads with nowhere safe to put them.
    throw new Error('STORAGE_PROVIDER=s3 is not implemented yet; see docs/LAUNCH_BLOCKERS.md');
  }
  return new LocalDiskStorage(env.STORAGE_LOCAL_DIR);
}

/** Identifies file types from their first bytes; the client-declared type is not trusted. */
export function sniffMimeType(buf: Buffer): 'image/jpeg' | 'image/png' | 'application/pdf' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  return null;
}
