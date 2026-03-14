import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ItemType, QuoteStatus, Role } from 'generated/prisma/client';
import { Prisma } from 'generated/prisma/client';
import { S3Service } from 'src/domain/GlobalServices/s3/s3.service';
import { QuotesRepository } from './quotes.repository';

// -------------------------------------------------------
// TYPE HELPERS
// -------------------------------------------------------

// Shape returned by findQuoteById — used in summary calculation
type FullQuote = NonNullable<Awaited<ReturnType<QuotesRepository['findQuoteById']>>>;
type QuoteItem = FullQuote['items'][number];

// Computed price breakdown attached to every quote response
export interface QuoteSummary {
  subtotal: string;          // Sum of all line totals before global discount
  discountAmount: string;    // The monetary value of the global discount
  discountedTotal: string;   // Subtotal after global discount
  vatAmount: string;         // VAT on the discounted total (0 if includeVat is false)
  grandTotal: string;        // Final amount the client pays
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private quotesRepo: QuotesRepository,
    private s3: S3Service,
  ) {}

  // -------------------------------------------------------
  // PURE PRICING FUNCTIONS (no I/O — safe for queue jobs)
  // -------------------------------------------------------

  /**
   * Calculates the total for a single line item.
   *
   * RENTAL:  (quantity × rate × days) − discountAmount
   * SALE:    (quantity × rate)         − discountAmount
   * SERVICE: (quantity × rate)         − discountAmount
   *
   * Uses Prisma.Decimal arithmetic to avoid floating-point drift.
   */
  private calcLineTotal(item: QuoteItem): Prisma.Decimal {
    const qty  = new Prisma.Decimal(item.quantity);
    const rate = new Prisma.Decimal(item.rate);
    const days = new Prisma.Decimal(item.days);
    const disc = new Prisma.Decimal(item.discountAmount);

    const gross =
      item.type === ItemType.RENTAL
        ? qty.mul(rate).mul(days)  // rental: price × days
        : qty.mul(rate);           // service / sale: price once

    const lineTotal = gross.sub(disc);
    // A line discount cannot make a line go below 0
    return lineTotal.lessThan(0) ? new Prisma.Decimal(0) : lineTotal;
  }

  /**
   * Sums all line totals to produce the event subtotal (Step B).
   */
  private calcSubtotal(items: QuoteItem[]): Prisma.Decimal {
    return items.reduce(
      (acc, item) => acc.add(this.calcLineTotal(item)),
      new Prisma.Decimal(0),
    );
  }

  /**
   * Applies the global percentage discount to the subtotal (Step C).
   * globalDiscount is stored as a percentage (e.g. 10 = 10%).
   */
  private calcDiscountedTotal(
    subtotal: Prisma.Decimal,
    globalDiscount: Prisma.Decimal,
  ): Prisma.Decimal {
    const discountFraction = globalDiscount.div(100);
    const discountAmount   = subtotal.mul(discountFraction);
    return subtotal.sub(discountAmount);
  }

  /**
   * Computes the VAT amount on the already-discounted total (Step D).
   * vatPercentage is stored as a percentage (e.g. 16 = 16%).
   */
  private calcVat(
    discountedTotal: Prisma.Decimal,
    vatPercentage: Prisma.Decimal,
  ): Prisma.Decimal {
    return discountedTotal.mul(vatPercentage.div(100));
  }

  /**
   * Builds the complete QuoteSummary for a full quote.
   * Called before returning any quote response so the client always
   * sees up-to-date computed totals alongside the raw data.
   */
  private buildSummary(quote: FullQuote): QuoteSummary {
    const subtotal        = this.calcSubtotal(quote.items);
    const discountedTotal = this.calcDiscountedTotal(subtotal, quote.globalDiscount);
    const discountAmount  = subtotal.sub(discountedTotal);

    const vatPct    = new Prisma.Decimal(quote.tenant.vatPercentage);
    const vatAmount = quote.includeVat ? this.calcVat(discountedTotal, vatPct) : new Prisma.Decimal(0);
    const grandTotal = discountedTotal.add(vatAmount);

    return {
      subtotal:        subtotal.toFixed(2),
      discountAmount:  discountAmount.toFixed(2),
      discountedTotal: discountedTotal.toFixed(2),
      vatAmount:       vatAmount.toFixed(2),
      grandTotal:      grandTotal.toFixed(2),
    };
  }

  // -------------------------------------------------------
  // AVAILABILITY CHECK (queue-safe — single-purpose)
  // -------------------------------------------------------

  /**
   * Checks whether enough units of an asset are free for the requested date range.
   *
   * Two-tier result:
   *   isAvailable  — hard check against APPROVED quotes only. False = 400 error.
   *   warning      — soft signal when PENDING quotes exist on the same dates.
   *                  Item is still added; warning is returned to the caller.
   *
   * Both DB queries run in parallel (Promise.all) to keep latency low.
   */
  private async checkAvailability(
    assetId: string,
    tenantId: string,
    quantityRequested: number,
    startDate: Date,
    endDate: Date,
    excludeQuoteId?: string,
  ): Promise<{
    isAvailable: boolean;
    available: number;
    requested: number;
    pendingReserved: number;
    warning: string | null;
  }> {
    const asset = await this.quotesRepo.findAssetById(assetId, tenantId);
    if (!asset) {
      return {
        isAvailable: false,
        available: 0,
        requested: quantityRequested,
        pendingReserved: 0,
        warning: null,
      };
    }

    // Run both conflict queries in parallel — one DB round-trip instead of two
    const [alreadyReserved, pendingReserved] = await Promise.all([
      this.quotesRepo.findConflictingBookings(assetId, startDate, endDate, excludeQuoteId),
      this.quotesRepo.findPendingConflicts(assetId, startDate, endDate, excludeQuoteId),
    ]);

    const available   = asset.unitsAvailable - alreadyReserved;
    const isAvailable = available >= quantityRequested;

    // Build a human-readable warning when pending quotes are consuming stock
    // on the same dates — the admin should be aware before approving.
    let warning: string | null = null;
    if (pendingReserved > 0) {
      warning =
        `Only ${available} unit(s) of "${asset.name}" are confirmed available on these dates. ` +
        `${pendingReserved} more are tied up in pending quotes and may be allocated soon.`;
    }

    return { isAvailable, available, requested: quantityRequested, pendingReserved, warning };
  }

  // -------------------------------------------------------
  // QUOTE MANAGEMENT
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
    try {
      // Validate the client belongs to this tenant
      const client = await this.quotesRepo.findClientById(data.clientId, tenantId);
      if (!client) {
        return new BadRequestException(
          `Client with id "${data.clientId}" was not found`,
        );
      }

      return await this.quotesRepo.createQuote(tenantId, data);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async getQuotes(tenantId: string) {
    try {
      return await this.quotesRepo.findQuotesByTenant(tenantId);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async getQuoteById(id: string, tenantId: string) {
    try {
      const quote = await this.quotesRepo.findQuoteById(id, tenantId);
      if (!quote) {
        return new NotFoundException(`Quote with id "${id}" was not found`);
      }
      // Attach computed totals to the response
      return { ...quote, summary: this.buildSummary(quote) };
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  /**
   * Updates top-level quote fields.
   * ADMIN only — role check is enforced in the controller but also
   * guarded here so the service cannot be called incorrectly.
   * Quote must be in DRAFT or PENDING_APPROVAL to allow changes.
   */
  async updateQuoteHeader(
    id: string,
    tenantId: string,
    role: Role,
    data: {
      globalDiscount?: number;
      includeVat?: boolean;
      clientId?: string;
      eventStartDate?: Date;
      eventEndDate?: Date;
      notes?: string;
    },
  ) {
    try {
      if (role !== Role.ADMIN) {
        return new ForbiddenException(
          'Only admins can update quote-level settings',
        );
      }

      const quote = await this.quotesRepo.findQuoteById(id, tenantId);
      if (!quote) {
        return new NotFoundException(`Quote with id "${id}" was not found`);
      }

      const editableStatuses: QuoteStatus[] = [
        QuoteStatus.DRAFT,
        QuoteStatus.PENDING_APPROVAL,
      ];
      if (!editableStatuses.includes(quote.status)) {
        return new BadRequestException(
          `Cannot edit a quote with status "${quote.status}"`,
        );
      }

      if (data.clientId) {
        const client = await this.quotesRepo.findClientById(data.clientId, tenantId);
        if (!client) {
          return new BadRequestException(
            `Client with id "${data.clientId}" was not found`,
          );
        }
      }

      return await this.quotesRepo.updateQuoteHeader(id, tenantId, data);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  // -------------------------------------------------------
  // LINE ITEMS
  // -------------------------------------------------------

  /**
   * Adds a line item to a DRAFT quote.
   *
   * For RENTAL and SALE items:
   *   - The asset must belong to the tenant
   *   - The rate is price-locked from asset.baseRentalRate at this exact moment
   *   - Availability is checked against other APPROVED quotes in the date range
   *
   * For SERVICE items:
   *   - assetId is optional (e.g. "Transport Fee" has no asset)
   *   - No availability check needed
   *   - Caller provides the rate directly
   */
  async addItem(
    quoteId: string,
    tenantId: string,
    role: Role,
    itemData: {
      type: ItemType;
      description: string;
      assetId?: string;
      quantity: number;
      days?: number;
      discountAmount?: number;
      rate?: number; // Only ADMIN can set a custom rate; STAFF always gets asset.baseRentalRate
    },
  ) {
    try {
      const quote = await this.quotesRepo.findQuoteById(quoteId, tenantId);
      if (!quote) {
        return new NotFoundException(`Quote with id "${quoteId}" was not found`);
      }

      if (quote.status !== QuoteStatus.DRAFT) {
        return new BadRequestException(
          'Items can only be added to DRAFT quotes',
        );
      }

      let lockedRate: number;
      let availabilityWarning: string | null = null;

      if (itemData.type === ItemType.SERVICE) {
        // Service items: use the provided rate (admin sets this)
        if (role !== Role.ADMIN) {
          return new ForbiddenException(
            'Only admins can add service line items',
          );
        }
        if (!itemData.rate) {
          return new BadRequestException('rate is required for SERVICE items');
        }
        lockedRate = itemData.rate;
      } else {
        // RENTAL / SALE: price-lock from the asset's current baseRentalRate
        if (!itemData.assetId) {
          return new BadRequestException(
            'assetId is required for RENTAL and SALE items',
          );
        }

        const asset = await this.quotesRepo.findAssetById(
          itemData.assetId,
          tenantId,
        );
        if (!asset) {
          return new BadRequestException(
            `Asset with id "${itemData.assetId}" was not found`,
          );
        }

        // Price lock: snapshot the rate right now. Future price changes to the
        // asset do not affect this quote line.
        lockedRate = asset.baseRentalRate;

        // Availability check: only if the quote has event dates
        if (quote.eventStartDate && quote.eventEndDate) {
          const availabilityResult = await this.checkAvailability(
            itemData.assetId,
            tenantId,
            itemData.quantity,
            quote.eventStartDate,
            quote.eventEndDate,
            quoteId,
          );

          if (!availabilityResult.isAvailable) {
            return new BadRequestException(
              `Not enough units available for "${asset.name}" on the selected dates. ` +
              `Available: ${availabilityResult.available}, requested: ${itemData.quantity}`,
            );
          }

          // Carry the soft warning through to the response
          availabilityWarning = availabilityResult.warning;
        }
      }

      // STAFF cannot set discounts
      const discountAmount =
        role === Role.ADMIN ? (itemData.discountAmount ?? 0) : 0;

      const item = await this.quotesRepo.addQuoteItem(quoteId, {
        type: itemData.type,
        description: itemData.description,
        assetId: itemData.assetId,
        quantity: itemData.quantity,
        rate: lockedRate,
        days: itemData.days ?? 1,
        discountAmount,
      });

      // warning is null when there are no pending conflicts — always present in the response
      return { item, warning: availabilityWarning };
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  /**
   * Updates a quote line item.
   *
   * Role restrictions:
   *   STAFF can change: description, quantity, days
   *   ADMIN can change: description, quantity, days, discountAmount
   *
   * rate is NEVER editable after item creation (price-lock rule).
   */
  async updateItem(
    quoteId: string,
    itemId: string,
    tenantId: string,
    role: Role,
    data: {
      description?: string;
      quantity?: number;
      days?: number;
      discountAmount?: number;
    },
  ) {
    try {
      const quote = await this.quotesRepo.findQuoteById(quoteId, tenantId);
      if (!quote) {
        return new NotFoundException(`Quote with id "${quoteId}" was not found`);
      }

      if (quote.status !== QuoteStatus.DRAFT) {
        return new BadRequestException(
          'Items can only be edited on DRAFT quotes',
        );
      }

      const item = await this.quotesRepo.findQuoteItemById(itemId, quoteId);
      if (!item) {
        return new NotFoundException(
          `Item with id "${itemId}" was not found on this quote`,
        );
      }

      // Build the update payload respecting role restrictions
      const updateData: {
        description?: string;
        quantity?: number;
        days?: number;
        discountAmount?: number;
      } = {};

      if (data.description !== undefined) updateData.description = data.description;
      if (data.quantity    !== undefined) updateData.quantity    = data.quantity;
      if (data.days        !== undefined) updateData.days        = data.days;

      // Only ADMIN can touch the line discount
      if (data.discountAmount !== undefined) {
        if (role !== Role.ADMIN) {
          return new ForbiddenException(
            'Only admins can modify line discounts',
          );
        }
        updateData.discountAmount = data.discountAmount;
      }

      return await this.quotesRepo.updateQuoteItem(itemId, quoteId, updateData);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async removeItem(quoteId: string, itemId: string, tenantId: string) {
    try {
      const quote = await this.quotesRepo.findQuoteById(quoteId, tenantId);
      if (!quote) {
        return new NotFoundException(`Quote with id "${quoteId}" was not found`);
      }

      if (quote.status !== QuoteStatus.DRAFT) {
        return new BadRequestException(
          'Items can only be removed from DRAFT quotes',
        );
      }

      await this.quotesRepo.removeQuoteItem(itemId, quoteId);
      return { message: 'Item removed' };
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  // -------------------------------------------------------
  // STATUS TRANSITIONS
  // -------------------------------------------------------

  /**
   * Moves a quote from DRAFT → PENDING_APPROVAL.
   * Requires at least one line item before submitting.
   */
  async submitForApproval(quoteId: string, tenantId: string) {
    try {
      const quote = await this.quotesRepo.findQuoteById(quoteId, tenantId);
      if (!quote) {
        return new NotFoundException(`Quote with id "${quoteId}" was not found`);
      }

      if (quote.status !== QuoteStatus.DRAFT) {
        return new BadRequestException(
          `Quote is already in "${quote.status}" status`,
        );
      }

      if (quote.items.length === 0) {
        return new BadRequestException(
          'A quote must have at least one line item before it can be submitted',
        );
      }

      return await this.quotesRepo.setQuoteStatus(
        quoteId,
        tenantId,
        QuoteStatus.PENDING_APPROVAL,
      );
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  /**
   * Approves a quote — the most complex operation in the system.
   *
   * Queue-safe steps (each is a discrete function call):
   *   1. Validate quote is in PENDING_APPROVAL
   *   2. Validate event dates exist (required to create an Event)
   *   3. Create the Event (main bucket)
   *   4. For each RENTAL/SALE item:
   *      a. Create a DISPATCH StockMovement
   *      b. Decrement unitsAvailable on the asset
   *   5. Create ServiceBucket with all SERVICE items
   *   6. Update quote status to APPROVED with timestamp
   *
   * Steps 3–6 run sequentially. If any step fails, partial state is logged
   * and the error is returned — the admin can retry.
   * In a production queue setup these steps would be individual jobs with
   * compensating transactions, but the single-function design here makes
   * that refactor straightforward.
   */
  async approveQuote(quoteId: string, tenantId: string, userId: string) {
    try {
      const quote = await this.quotesRepo.findQuoteById(quoteId, tenantId);
      if (!quote) {
        return new NotFoundException(`Quote with id "${quoteId}" was not found`);
      }

      if (quote.status !== QuoteStatus.PENDING_APPROVAL) {
        return new BadRequestException(
          `Only quotes in PENDING_APPROVAL status can be approved. Current status: "${quote.status}"`,
        );
      }

      if (!quote.eventStartDate || !quote.eventEndDate) {
        return new BadRequestException(
          'Quote must have eventStartDate and eventEndDate set before it can be approved',
        );
      }

      // Step 3 — Create the Event (main bucket)
      const event = await this.quotesRepo.createEvent({
        tenantId,
        quoteId,
        quoteNumber: quote.quoteNumber,
        startDate: quote.eventStartDate,
        endDate: quote.eventEndDate,
      });
      this.logger.log(
        `Approval: Event ${event.id} created for quote ${quote.quoteNumber}`,
      );

      // Step 4 — Reserve rental assets (DISPATCH movements)
      const rentalItems = quote.items.filter(
        (i) => i.type === ItemType.RENTAL || i.type === ItemType.SALE,
      );

      for (const item of rentalItems) {
        if (!item.assetId) continue; // safety guard

        await this.quotesRepo.createDispatchMovement({
          assetId: item.assetId,
          eventId: event.id,
          quantity: item.quantity,
          userId,
          quoteNumber: quote.quoteNumber,
        });

        await this.quotesRepo.decrementAvailable(item.assetId, item.quantity);

        this.logger.log(
          `Approval: Dispatched ${item.quantity}x asset ${item.assetId} for event ${event.id}`,
        );
      }

      // Step 5 — Create ServiceBucket from SERVICE items
      const serviceItems = quote.items
        .filter((i) => i.type === ItemType.SERVICE)
        .map((i) => ({
          description: i.description,
          quantity:    i.quantity,
          rate:        i.rate,
          total:       this.calcLineTotal(i),
        }));

      if (serviceItems.length > 0) {
        await this.quotesRepo.createServiceBucket(
          event.id,
          quoteId,
          tenantId,
          serviceItems,
        );
        this.logger.log(
          `Approval: ServiceBucket created with ${serviceItems.length} item(s) for event ${event.id}`,
        );
      }

      // Step 6 — Mark quote as APPROVED
      const approvedQuote = await this.quotesRepo.setQuoteStatus(
        quoteId,
        tenantId,
        QuoteStatus.APPROVED,
        { approvedAt: new Date(), approvedBy: userId },
      );

      return { quote: approvedQuote, event };
    } catch (error) {
      this.logger.error(
        `Approval failed for quote ${quoteId}: ${error?.message}`,
      );
      return new BadRequestException(error);
    }
  }

  /**
   * Cancels a quote.
   * ADMIN only — enforced in controller.
   */
  async cancelQuote(quoteId: string, tenantId: string) {
    try {
      const quote = await this.quotesRepo.findQuoteById(quoteId, tenantId);
      if (!quote) {
        return new NotFoundException(`Quote with id "${quoteId}" was not found`);
      }

      const cancellableStatuses: QuoteStatus[] = [
        QuoteStatus.DRAFT,
        QuoteStatus.PENDING_APPROVAL,
      ];
      if (!cancellableStatuses.includes(quote.status)) {
        return new BadRequestException(
          `Cannot cancel a quote with status "${quote.status}"`,
        );
      }

      return await this.quotesRepo.setQuoteStatus(
        quoteId,
        tenantId,
        QuoteStatus.CANCELLED,
      );
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  // -------------------------------------------------------
  // PAYMENT PROOF
  // -------------------------------------------------------

  /**
   * Uploads payment proof images and attaches them to the quote.
   *
   * Flow:
   *   1. Verify quote belongs to tenant
   *   2. Reject if CANCELLED
   *   3. Upload files to Cloudinary
   *   4. Write QuotePaymentProof rows
   *   5. On DB failure → rollback all uploads
   */
  async addPaymentProof(
    quoteId: string,
    tenantId: string,
    files: Express.Multer.File[],
  ) {
    const uploadedPublicIds: string[] = [];

    try {
      const quote = await this.quotesRepo.findQuoteById(quoteId, tenantId);
      if (!quote) {
        return new NotFoundException(`Quote with id "${quoteId}" was not found`);
      }

      if (quote.status === QuoteStatus.CANCELLED) {
        return new BadRequestException(
          'Cannot upload payment proof to a cancelled quote',
        );
      }

      const results = await this.s3.uploadMultipleFiles(files, 'payment-proofs');
      const proofs: { imageUrl: string; publicId: string }[] = [];

      for (const result of results) {
        uploadedPublicIds.push(result.public_id);
        proofs.push({ imageUrl: result.secure_url, publicId: result.public_id });
      }

      await this.quotesRepo.addPaymentProofs(quoteId, proofs);

      return proofs;
    } catch (error) {
      if (uploadedPublicIds.length > 0) {
        this.logger.warn(
          `DB write failed — rolling back ${uploadedPublicIds.length} payment proof uploads`,
        );
        await Promise.all(
          uploadedPublicIds.map((pid) =>
            this.s3
              .deleteFile(pid)
              .catch((e) =>
                this.logger.error(
                  `Cloudinary rollback failed for ${pid}: ${e.message}`,
                ),
              ),
          ),
        );
      }
      return new BadRequestException(error);
    }
  }

  /**
   * Deletes a single payment proof image from a quote.
   *
   * Flow:
   *   1. Verify quote belongs to tenant
   *   2. Fetch the proof row to get publicId
   *   3. Delete the DB row
   *   4. Delete from Cloudinary best-effort
   */
  async deletePaymentProof(quoteId: string, proofId: string, tenantId: string) {
    try {
      const quote = await this.quotesRepo.findQuoteById(quoteId, tenantId);
      if (!quote) {
        return new NotFoundException(`Quote with id "${quoteId}" was not found`);
      }

      const proof = await this.quotesRepo.findPaymentProofById(proofId, quoteId);
      if (!proof) {
        return new NotFoundException(
          `Payment proof with id "${proofId}" was not found`,
        );
      }

      await this.quotesRepo.deletePaymentProof(proofId);

      await this.s3.deleteFile(proof.publicId).catch((e) =>
        this.logger.error(
          `Cloudinary cleanup failed for payment proof ${proofId}: ${e.message}`,
        ),
      );

      return { message: 'Payment proof deleted successfully' };
    } catch (error) {
      return new BadRequestException(error);
    }
  }
}
