import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { DB, Database } from '../database/database.module';
import { rides, supportMessages, supportTickets } from '../database/schema';
import { CreateTicketDto } from './safety.dto';

const PRIORITY: Record<CreateTicketDto['category'], 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW'> = {
  SAFETY: 'URGENT',
  PAYMENT: 'HIGH',
  APPEAL: 'HIGH',
  RIDE_ISSUE: 'NORMAL',
  LOST_ITEM: 'NORMAL',
  ACCOUNT: 'NORMAL',
  OTHER: 'LOW',
};

@Injectable()
export class SupportService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async create(userId: string, dto: CreateTicketDto) {
    if (dto.rideId) {
      const [ride] = await this.db
        .select({ passengerId: rides.passengerId, driverId: rides.driverId })
        .from(rides)
        .where(eq(rides.id, dto.rideId));
      if (!ride || (ride.passengerId !== userId && ride.driverId !== userId)) {
        throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
      }
    }
    const id = await this.db.transaction(async (tx) => {
      const [ticket] = await tx
        .insert(supportTickets)
        .values({
          userId,
          rideId: dto.rideId ?? null,
          category: dto.category,
          priority: PRIORITY[dto.category],
          subject: dto.subject,
        })
        .returning({ id: supportTickets.id });
      await tx
        .insert(supportMessages)
        .values({ ticketId: ticket!.id, authorUserId: userId, body: dto.message });
      return ticket!.id;
    });
    return this.get(userId, id);
  }

  async list(userId: string) {
    return this.db
      .select({
        id: supportTickets.id,
        category: supportTickets.category,
        subject: supportTickets.subject,
        status: supportTickets.status,
        rideId: supportTickets.rideId,
        createdAt: supportTickets.createdAt,
        updatedAt: supportTickets.updatedAt,
      })
      .from(supportTickets)
      .where(eq(supportTickets.userId, userId))
      .orderBy(desc(supportTickets.updatedAt))
      .limit(50);
  }

  /** The user's view excludes internal staff notes. */
  async get(userId: string, id: string) {
    const [ticket] = await this.db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, id), eq(supportTickets.userId, userId)));
    if (!ticket) throw new AppError(404, 'NOT_FOUND', 'Ticket not found');
    const messages = await this.db
      .select({
        id: supportMessages.id,
        fromSupport: supportMessages.authorStaffId,
        body: supportMessages.body,
        createdAt: supportMessages.createdAt,
      })
      .from(supportMessages)
      .where(and(eq(supportMessages.ticketId, id), eq(supportMessages.internalNote, false)))
      .orderBy(supportMessages.id);
    return {
      id: ticket.id,
      category: ticket.category,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      rideId: ticket.rideId,
      createdAt: ticket.createdAt,
      messages: messages.map((m) => ({ ...m, fromSupport: m.fromSupport !== null })),
    };
  }

  async reply(userId: string, id: string, body: string) {
    const [ticket] = await this.db
      .select({ status: supportTickets.status })
      .from(supportTickets)
      .where(and(eq(supportTickets.id, id), eq(supportTickets.userId, userId)));
    if (!ticket) throw new AppError(404, 'NOT_FOUND', 'Ticket not found');
    if (ticket.status === 'CLOSED')
      throw new AppError(409, 'TICKET_CLOSED', 'This ticket is closed');
    await this.db.insert(supportMessages).values({ ticketId: id, authorUserId: userId, body });
    await this.db
      .update(supportTickets)
      .set({ status: 'OPEN' })
      .where(
        and(
          eq(supportTickets.id, id),
          inArray(supportTickets.status, ['WAITING_ON_USER', 'RESOLVED']),
        ),
      );
    return this.get(userId, id);
  }
}
