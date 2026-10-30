import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { DB, Database } from '../database/database.module';
import {
  incidentEvents,
  safetyIncidents,
  supportMessages,
  supportTickets,
  users,
} from '../database/schema';
import { ListQuery } from './admin-drivers';
import { CurrentStaff, StaffAuth, StaffPrincipal } from './staff-auth';

class NoteDto {
  @IsString()
  @Length(3, 2000)
  note: string;
}

class OptionalNoteDto {
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  note?: string;
}

class TicketReplyDto {
  @IsString()
  @Length(1, 4000)
  body: string;

  /** Internal notes are never shown to the user. */
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}

class TicketStatusDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'])
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_USER' | 'RESOLVED' | 'CLOSED';
}

type IncidentStatus = (typeof safetyIncidents.$inferSelect)['status'];

/** Allowed incident status moves for each staff action. */
const INCIDENT_FLOW: Record<string, { from: IncidentStatus[]; to: IncidentStatus }> = {
  acknowledge: { from: ['OPEN'], to: 'ACKNOWLEDGED' },
  respond: { from: ['OPEN', 'ACKNOWLEDGED'], to: 'RESPONDING' },
  resolve: { from: ['ACKNOWLEDGED', 'RESPONDING'], to: 'RESOLVED' },
  close: { from: ['RESOLVED'], to: 'CLOSED' },
};

@ApiTags('admin: safety & support')
@Controller({ path: 'admin', version: '1' })
export class AdminSafetyController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Open incidents first, most severe and oldest first. */
  @StaffAuth('SAFETY', 'OPERATIONS')
  @Get('incidents')
  incidents(@Query() q: ListQuery) {
    return this.db
      .select({
        id: safetyIncidents.id,
        type: safetyIncidents.type,
        severity: safetyIncidents.severity,
        status: safetyIncidents.status,
        rideId: safetyIncidents.rideId,
        reporterRole: safetyIncidents.reporterRole,
        reviewAccount: sql<boolean>`(SELECT is_review_account FROM users WHERE id = ${safetyIncidents.reporterUserId})`,
        assignedStaffId: safetyIncidents.assignedStaffId,
        createdAt: safetyIncidents.createdAt,
        acknowledgedAt: safetyIncidents.acknowledgedAt,
      })
      .from(safetyIncidents)
      .where(
        q.status
          ? sql`${safetyIncidents.status} = ${q.status}`
          : inArray(safetyIncidents.status, ['OPEN', 'ACKNOWLEDGED', 'RESPONDING']),
      )
      .orderBy(
        sql`CASE ${safetyIncidents.severity} WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`,
        safetyIncidents.createdAt,
      )
      .limit(q.limit ?? 50)
      .offset(q.offset ?? 0);
  }

  /** Full case, including the reporter's phone for call-back. Every view is audited. */
  @StaffAuth('SAFETY')
  @Get('incidents/:id')
  async incident(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const [row] = await this.db
      .select({
        incident: safetyIncidents,
        name: users.fullName,
        phone: users.phoneE164,
        reviewAccount: users.isReviewAccount,
      })
      .from(safetyIncidents)
      .innerJoin(users, eq(users.id, safetyIncidents.reporterUserId))
      .where(eq(safetyIncidents.id, id));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Incident not found');
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.staffId,
      action: 'incident.viewed',
      entityType: 'safety_incident',
      entityId: id,
    });
    return {
      ...row.incident,
      reporter: {
        id: row.incident.reporterUserId,
        name: row.name,
        phone: row.phone,
        reviewAccount: row.reviewAccount,
      },
      timeline: await this.db
        .select()
        .from(incidentEvents)
        .where(eq(incidentEvents.incidentId, id))
        .orderBy(incidentEvents.id),
    };
  }

  /**
   * Status changes. `respond` requires a note saying what was actually done
   * (e.g. "Called passenger, driver stopped; police 112 called by agent"); only
   * then do the apps show that a response is under way.
   */
  @StaffAuth('SAFETY')
  @Post('incidents/:id/status/:action')
  @HttpCode(200)
  async act(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('action') action: keyof typeof INCIDENT_FLOW,
    @Body() dto: OptionalNoteDto,
  ) {
    const flow = INCIDENT_FLOW[action];
    if (!flow) throw new AppError(404, 'NOT_FOUND', 'Unknown incident action');
    if (
      (action === 'respond' || action === 'resolve') &&
      (!dto.note || dto.note.trim().length < 3)
    ) {
      throw new AppError(400, 'NOTE_REQUIRED', 'Describe what was done');
    }
    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(safetyIncidents)
        .set({
          status: flow.to,
          assignedStaffId: sql`COALESCE(${safetyIncidents.assignedStaffId}, ${staff.staffId}::uuid)`,
          ...(flow.to === 'ACKNOWLEDGED' ? { acknowledgedAt: now } : {}),
          ...(flow.to === 'RESPONDING'
            ? {
                responseInitiatedAt: now,
                acknowledgedAt: sql`COALESCE(${safetyIncidents.acknowledgedAt}, now())`,
              }
            : {}),
          ...(flow.to === 'RESOLVED'
            ? { resolvedAt: now, resolutionSummary: dto.note ?? null }
            : {}),
        })
        .where(and(eq(safetyIncidents.id, id), inArray(safetyIncidents.status, flow.from)))
        .returning();
      if (!row)
        throw new AppError(
          409,
          'INVALID_INCIDENT_TRANSITION',
          `Cannot ${action} this incident now`,
        );
      await tx.insert(incidentEvents).values({
        incidentId: id,
        staffUserId: staff.staffId,
        action: flow.to,
        note: dto.note ?? null,
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: staff.staffId,
          action: `incident.${action}`,
          entityType: 'safety_incident',
          entityId: id,
        },
        tx,
      );
      return row;
    });
    return { id, status: updated.status };
  }

  @StaffAuth('SAFETY')
  @Post('incidents/:id/notes')
  async note(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: NoteDto,
  ) {
    const [exists] = await this.db
      .select({ id: safetyIncidents.id })
      .from(safetyIncidents)
      .where(eq(safetyIncidents.id, id));
    if (!exists) throw new AppError(404, 'NOT_FOUND', 'Incident not found');
    await this.db
      .insert(incidentEvents)
      .values({ incidentId: id, staffUserId: staff.staffId, action: 'NOTE', note: dto.note });
    return { ok: true };
  }

  // ---------- support tickets ----------

  @StaffAuth('SUPPORT', 'SAFETY', 'OPERATIONS')
  @Get('tickets')
  tickets(@Query() q: ListQuery) {
    return this.db
      .select({
        id: supportTickets.id,
        category: supportTickets.category,
        priority: supportTickets.priority,
        status: supportTickets.status,
        subject: supportTickets.subject,
        rideId: supportTickets.rideId,
        assignedStaffId: supportTickets.assignedStaffId,
        createdAt: supportTickets.createdAt,
        updatedAt: supportTickets.updatedAt,
      })
      .from(supportTickets)
      .where(
        q.status
          ? sql`${supportTickets.status} = ${q.status}`
          : inArray(supportTickets.status, ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER']),
      )
      .orderBy(
        sql`CASE ${supportTickets.priority} WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END`,
        supportTickets.createdAt,
      )
      .limit(q.limit ?? 50)
      .offset(q.offset ?? 0);
  }

  @StaffAuth('SUPPORT', 'SAFETY', 'OPERATIONS')
  @Get('tickets/:id')
  async ticket(@Param('id', new ParseUUIDPipe()) id: string) {
    const [t] = await this.db.select().from(supportTickets).where(eq(supportTickets.id, id));
    if (!t) throw new AppError(404, 'NOT_FOUND', 'Ticket not found');
    return {
      ...t,
      messages: await this.db
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.ticketId, id))
        .orderBy(supportMessages.id),
    };
  }

  @StaffAuth('SUPPORT', 'SAFETY')
  @Post('tickets/:id/messages')
  async reply(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TicketReplyDto,
  ) {
    const [t] = await this.db
      .select({ status: supportTickets.status })
      .from(supportTickets)
      .where(eq(supportTickets.id, id));
    if (!t) throw new AppError(404, 'NOT_FOUND', 'Ticket not found');
    await this.db.insert(supportMessages).values({
      ticketId: id,
      authorStaffId: staff.staffId,
      body: dto.body,
      internalNote: dto.internal ?? false,
    });
    if (!dto.internal) {
      await this.db
        .update(supportTickets)
        .set({
          status: 'WAITING_ON_USER',
          assignedStaffId: sql`COALESCE(${supportTickets.assignedStaffId}, ${staff.staffId}::uuid)`,
        })
        .where(eq(supportTickets.id, id));
    }
    return this.ticket(id);
  }

  @StaffAuth('SUPPORT', 'SAFETY')
  @Post('tickets/:id/status')
  @HttpCode(200)
  async setStatus(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TicketStatusDto,
  ) {
    const [t] = await this.db
      .update(supportTickets)
      .set({ status: dto.status, resolvedAt: dto.status === 'RESOLVED' ? new Date() : undefined })
      .where(eq(supportTickets.id, id))
      .returning({ id: supportTickets.id, status: supportTickets.status });
    if (!t) throw new AppError(404, 'NOT_FOUND', 'Ticket not found');
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.staffId,
      action: 'ticket.status_changed',
      entityType: 'support_ticket',
      entityId: id,
      metadata: { status: dto.status },
    });
    return t;
  }
}
