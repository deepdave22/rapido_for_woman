import { Inject, Injectable } from '@nestjs/common';
import { DB, Database, Tx } from '../database/database.module';
import { auditLogs } from '../database/schema';

export interface AuditEntry {
  actorType: 'USER' | 'STAFF' | 'SYSTEM';
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  requestId?: string | null;
  /** Identifiers and enums only. Never names, phone numbers or document contents. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Pass `tx` to make the audit row commit or roll back with the change it describes. */
  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    await (tx ?? this.db).insert(auditLogs).values({
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ip: entry.ip ?? null,
      requestId: entry.requestId ?? null,
      metadata: entry.metadata ?? null,
    });
  }
}
