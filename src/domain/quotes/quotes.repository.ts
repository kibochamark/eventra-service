import { Injectable } from '@nestjs/common';
import { ItemType, MovementType, QuoteStatus } from 'generated/prisma/client';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class QuotesRepository {
  constructor(private prisma: PrismaService) {}

  // -------------------------------------------------------
  // QUOTE NUMBER GENERATION
  // -------------------------------------------------------

  /**
   * Generates the next sequential quote number for a tenant.
   * Format: QT-1001, QT-1002, ...
   * Counting is tenant-scoped so each company starts at QT-1001.
   */
  async generateQuoteNumber(tenantId: string): Promise<string> {
    const count = await this.prisma.quote.count({ where: { tenantId } });
    return `QT-${1001 + count}`;
  }

  // -------------------------------------------------------
  // QUOTE CRUD
  // -------------------------------------------------------

  async createQuote(
    tenantId: string,
    data: {
      clientId: string;
      eventStartDate?: Date;
      eventEndDate?: Date;
      notes?: string;
    },
  ) {
    // Retry loop guards against concurrent requests generating the same quote number.
    //
    // Race: two requests call generateQuoteNumber at the same instant, both get the
    // same count, both produce QT-1006. The first INSERT succeeds; the second hits a
    // P2002 unique-constraint error. On retry the count has already incremented
    // (the first row is committed), so generateQuoteNumber returns QT-1007 and the
    // second request succeeds cleanly.
    //
    // The @unique constraint on quoteNumber is the true data-integrity guard.
    // This loop just turns a hard crash into a transparent auto-correction.
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const quoteNumber = await this.generateQuoteNumber(tenantId);

      try {
        return await this.prisma.quote.create({
          data: {
            quoteNumber,
            tenantId,
            clientId: data.clientId,
            eventStartDate: data.eventStartDate ?? null,
            eventEndDate: data.eventEndDate ?? null,
            notes: data.notes ?? null,
          },
          include: { client: true },
        });
      } catch (error) {
        // P2002 = unique constraint — another concurrent request took this number.
        // Re-count on the next iteration to get the correct next value.
        if (error?.code === 'P2002' && attempt < MAX_RETRIES - 1) continue;

        // Any other error, or we've exhausted retries — let it propagate
        throw error;
      }
    }
  }

  /**
   * Lists all quotes for a tenant.
   * Returns lightweight summary — items are not included (use findQuoteById for full detail).
   */
  async findQuotesByTenant(tenantId: string) {
    return await this.prisma.quote.findMany({
      where: { tenantId },
      orderBy: { id: 'desc' },
      include: {
        client: { select: { id: true, name: true, isCorporate: true } },
        _count: { select: { items: true } },
      },
    });
  }

  /**
   * Returns a single quote with all its items, client info, linked events,
   * and the tenant's VAT percentage (needed for price computation).
   */
  async findQuoteById(id: string, tenantId: string) {
    return await this.prisma.quote.findUnique({
      where: { id, tenantId },
      include: {
        client: true,
        items: {
          include: {
            asset: { select: { id: true, name: true, sku: true } },
          },
          orderBy: { id: 'asc' },
        },
        tenant: { select: { vatPercentage: true } },
        events: { select: { id: true, name: true, status: true } },
        serviceBucket: { include: { items: true } },
        paymentProofs: true,
      },
    });
  }

  async updateQuoteHeader(
    id: string,
    tenantId: string,
    data: {
      globalDiscount?: number;
      includeVat?: boolean;
      clientId?: string;
      eventStartDate?: Date;
      eventEndDate?: Date;
      notes?: string;
    },
  ) {
    return await this.prisma.quote.update({
      where: { id, tenantId },
      data,
      include: { client: true },
    });
  }

  async setQuoteStatus(
    id: string,
    tenantId: string,
    status: QuoteStatus,
    meta?: { approvedAt?: Date; approvedBy?: string },
  ) {
    return await this.prisma.quote.update({
      where: { id, tenantId },
      data: { status, ...meta },
    });
  }

  // -------------------------------------------------------
  // QUOTE ITEMS
  // -------------------------------------------------------

  async addQuoteItem(
    quoteId: string,
    data: {
      type: ItemType;
      description: string;
      assetId?: string;
      quantity: number;
      rate: number;       // price-locked at call time — never read from asset after this
      days?: number;
      discountAmount?: number;
    },
  ) {
    return await this.prisma.quoteItem.create({
      data: {
        quoteId,
        type: data.type,
        description: data.description,
        assetId: data.assetId ?? null,
        quantity: data.quantity,
        rate: data.rate,
        days: data.days ?? 1,
        discountAmount: data.discountAmount ?? 0,
      },
      include: {
        asset: { select: { id: true, name: true, sku: true } },
      },
    });
  }

  async findQuoteItemById(itemId: string, quoteId: string) {
    return await this.prisma.quoteItem.findFirst({
      where: { id: itemId, quoteId },
    });
  }

  async updateQuoteItem(
    itemId: string,
    quoteId: string,
    data: {
      description?: string;
      quantity?: number;
      days?: number;
      discountAmount?: number;
    },
  ) {
    return await this.prisma.quoteItem.update({
      where: { id: itemId },
      data,
      include: {
        asset: { select: { id: true, name: true, sku: true } },
      },
    });
  }

  async removeQuoteItem(itemId: string, quoteId: string) {
    // Scoped deletion — quoteId ensures an item from another quote cannot be deleted
    return await this.prisma.quoteItem.deleteMany({
      where: { id: itemId, quoteId },
    });
  }

  // -------------------------------------------------------
  // AVAILABILITY CONFLICT DETECTION
  // -------------------------------------------------------

  /**
   * Returns the total quantity of a specific asset already committed in APPROVED quotes
   * whose event date range overlaps with the requested [startDate, endDate].
   *
   * Two date ranges overlap when: start1 < end2 AND end1 > start2
   *
   * excludeQuoteId is used when re-checking availability for an existing quote item
   * so the quote itself is not counted as its own conflict.
   */
  async findConflictingBookings(
    assetId: string,
    startDate: Date,
    endDate: Date,
    excludeQuoteId?: string,
  ): Promise<number> {
    const conflicting = await this.prisma.quoteItem.findMany({
      where: {
        assetId,
        quoteId: excludeQuoteId ? { not: excludeQuoteId } : undefined,
        quote: {
          status: QuoteStatus.APPROVED,
          eventStartDate: { lt: endDate },   // quote starts before our end
          eventEndDate:   { gt: startDate }, // quote ends after our start
        },
      },
      select: { quantity: true },
    });

    return conflicting.reduce((sum, item) => sum + item.quantity, 0);
  }

  /**
   * Returns the total quantity of a specific asset tied up in PENDING_APPROVAL quotes
   * whose event date range overlaps with the requested [startDate, endDate].
   *
   * Used purely for soft-block warnings — does NOT block item creation.
   * Same overlap rule as findConflictingBookings: start1 < end2 AND end1 > start2.
   */
  async findPendingConflicts(
    assetId: string,
    startDate: Date,
    endDate: Date,
    excludeQuoteId?: string,
  ): Promise<number> {
    const pending = await this.prisma.quoteItem.findMany({
      where: {
        assetId,
        quoteId: excludeQuoteId ? { not: excludeQuoteId } : undefined,
        quote: {
          status: QuoteStatus.PENDING_APPROVAL,
          eventStartDate: { lt: endDate },
          eventEndDate:   { gt: startDate },
        },
      },
      select: { quantity: true },
    });

    return pending.reduce((sum, item) => sum + item.quantity, 0);
  }

  // -------------------------------------------------------
  // ASSET & CLIENT LOOKUPS (thin wrappers — scoped to tenant)
  // -------------------------------------------------------

  async findAssetById(assetId: string, tenantId: string) {
    return await this.prisma.asset.findUnique({
      where: { id: assetId, tenantId },
      select: {
        id: true,
        name: true,
        baseRentalRate: true,
        unitsAvailable: true,
      },
    });
  }

  async findClientById(clientId: string, tenantId: string) {
    return await this.prisma.client.findUnique({
      where: { id: clientId, tenantId },
      select: { id: true, name: true },
    });
  }

  // -------------------------------------------------------
  // APPROVAL — EVENT + SERVICE BUCKET CREATION
  // -------------------------------------------------------

  /**
   * Creates an Event row linked to the approved quote.
   * The event name defaults to "Event for {quoteNumber}" if not provided.
   */
  async createEvent(data: {
    tenantId: string;
    quoteId: string;
    quoteNumber: string;
    startDate: Date;
    endDate: Date;
    venue?: string;
  }) {
    return await this.prisma.event.create({
      data: {
        name: `Event for ${data.quoteNumber}`,
        tenantId: data.tenantId,
        startDate: data.startDate,
        endDate: data.endDate,
        venue: data.venue ?? null,
        quotes: { connect: { id: data.quoteId } },
      },
    });
  }

  /**
   * Creates a ServiceBucket with all SERVICE-type items snapshotted from the quote.
   * Called as part of the approval flow — runs inside a transaction in the service.
   */
  async createServiceBucket(
    eventId: string,
    quoteId: string,
    tenantId: string,
    serviceItems: Array<{
      description: string;
      quantity: number;
      rate: Prisma.Decimal;
      total: Prisma.Decimal;
    }>,
  ) {
    return await this.prisma.serviceBucket.create({
      data: {
        eventId,
        quoteId,
        tenantId,
        items: {
          create: serviceItems,
        },
      },
      include: { items: true },
    });
  }

  /**
   * Creates a single DISPATCH StockMovement for a rental item being approved.
   * Each item gets its own movement row so the audit trail is per-asset per-event.
   */
  async createDispatchMovement(data: {
    assetId: string;
    eventId: string;
    quantity: number;
    userId: string;
    quoteNumber: string;
  }) {
    return await this.prisma.stockMovement.create({
      data: {
        assetId: data.assetId,
        eventId: data.eventId,
        type: MovementType.DISPATCH,
        quantity: data.quantity,
        userId: data.userId,
        notes: `Auto-dispatch on quote approval — ${data.quoteNumber}`,
      },
    });
  }

  /**
   * Decrements unitsAvailable on an asset by the given quantity.
   * Called alongside createDispatchMovement — keeps the inventory buckets in sync.
   */
  async decrementAvailable(assetId: string, quantity: number) {
    return await this.prisma.asset.update({
      where: { id: assetId },
      data: { unitsAvailable: { decrement: quantity }, unitsOnSite: { increment: quantity } },
    });
  }

  // -------------------------------------------------------
  // PAYMENT PROOFS
  // -------------------------------------------------------

  async addPaymentProofs(
    quoteId: string,
    proofs: { imageUrl: string; publicId: string }[],
  ) {
    return await this.prisma.quotePaymentProof.createMany({
      data: proofs.map((p) => ({ quoteId, ...p })),
    });
  }

  async findPaymentProofById(proofId: string, quoteId: string) {
    return await this.prisma.quotePaymentProof.findFirst({
      where: { id: proofId, quoteId },
    });
  }

  async deletePaymentProof(proofId: string) {
    return await this.prisma.quotePaymentProof.delete({ where: { id: proofId } });
  }
}
