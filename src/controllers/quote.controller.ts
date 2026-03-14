import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Role } from 'generated/prisma/client';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { QuotesService } from 'src/domain/quotes/quotes.service';
import {
  AddQuoteItemDto,
  CreateQuoteDto,
  QuoteIdParamDto,
  QuoteItemIdParamDto,
  QuotePaymentProofIdParamDto,
  UpdateQuoteHeaderDto,
  UpdateQuoteItemDto,
} from './dto/quote.dto';

/**
 * QuoteController — handles all /quotes routes.
 *
 * Route declaration order (static before parameterized):
 *   1.  POST   /quotes
 *   2.  GET    /quotes
 *   3.  GET    /quotes/:id
 *   4.  PATCH  /quotes/:id
 *   5.  POST   /quotes/:id/items
 *   6.  PATCH  /quotes/:id/items/:itemId
 *   7.  DELETE /quotes/:id/items/:itemId
 *   8.  POST   /quotes/:id/submit
 *   9.  POST   /quotes/:id/payment-proof
 *  10.  DELETE /quotes/:id/payment-proof/:proofId
 *  11.  POST   /quotes/:id/approve
 *  12.  POST   /quotes/:id/cancel
 */
@Controller('quotes')
@UseGuards(RolesGuard)
export class QuoteController {
  private readonly logger = new Logger(QuoteController.name);

  constructor(private quotesService: QuotesService) {}

  // -------------------------------------------------------
  // QUOTE CRUD
  // -------------------------------------------------------

  /**
   * POST /quotes
   * Creates a new DRAFT quote for a client.
   * Quote number is auto-generated (QT-1001, QT-1002, …).
   * Both roles can create quotes — staff build quotes for clients,
   * admin reviews and approves them.
   */
  @Post()
  @Roles(Role.ADMIN, Role.STAFF)
  async createQuote(@Body() body: CreateQuoteDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Creating quote for client ${body.clientId}`);
    return await this.quotesService.createQuote(tenantId, {
      clientId: body.clientId,
      eventStartDate: body.eventStartDate ? new Date(body.eventStartDate) : undefined,
      eventEndDate: body.eventEndDate ? new Date(body.eventEndDate) : undefined,
      notes: body.notes,
    });
  }

  /**
   * GET /quotes
   * Lists all quotes for the tenant with client info and item count.
   */
  @Get()
  @Roles(Role.ADMIN, Role.STAFF)
  async getQuotes(@Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Listing quotes for tenant ${tenantId}`);
    return await this.quotesService.getQuotes(tenantId);
  }

  /**
   * GET /quotes/:id
   * Returns a single quote with all items and computed totals
   * (subtotal, discountedTotal, vatAmount, grandTotal).
   */
  @Get(':id')
  @Roles(Role.ADMIN, Role.STAFF)
  async getQuote(@Param() param: QuoteIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Fetching quote ${param.id}`);
    const result = await this.quotesService.getQuoteById(param.id, tenantId);
    if (result instanceof NotFoundException) throw result;
    return result;
  }

  /**
   * PATCH /quotes/:id
   * Updates top-level quote settings: globalDiscount, includeVat, clientId, event dates.
   * ADMIN only — staff cannot change financial settings.
   * Quote must be in DRAFT or PENDING_APPROVAL status.
   */
  @Patch(':id')
  @Roles(Role.ADMIN)
  async updateQuoteHeader(
    @Param() param: QuoteIdParamDto,
    @Body() body: UpdateQuoteHeaderDto,
    @Req() req: any,
  ) {
    const { tenantId, role } = req.user as any;
    this.logger.log(`Updating quote header ${param.id}`);
    const result = await this.quotesService.updateQuoteHeader(
      param.id,
      tenantId,
      role as Role,
      {
        ...body,
        eventStartDate: body.eventStartDate ? new Date(body.eventStartDate) : undefined,
        eventEndDate: body.eventEndDate ? new Date(body.eventEndDate) : undefined,
      },
    );
    if (result instanceof NotFoundException) throw result;
    if (result instanceof ForbiddenException) throw result;
    return result;
  }

  // -------------------------------------------------------
  // LINE ITEMS  (sub-paths declared before bare /:id routes)
  // -------------------------------------------------------

  /**
   * POST /quotes/:id/items
   * Adds a line item to a DRAFT quote.
   *
   * For RENTAL/SALE items:
   *   - Provide assetId — rate is automatically price-locked from the asset
   *   - Availability is checked against other APPROVED quotes in the date range
   *
   * For SERVICE items:
   *   - Provide rate directly (no asset required)
   *   - ADMIN only
   */
  @Post(':id/items')
  @Roles(Role.ADMIN, Role.STAFF)
  async addItem(
    @Param() param: QuoteIdParamDto,
    @Body() body: AddQuoteItemDto,
    @Req() req: any,
  ) {
    const { tenantId, role } = req.user as any;
    this.logger.log(
      `Adding ${body.type} item to quote ${param.id}: "${body.description}"`,
    );
    const result = await this.quotesService.addItem(
      param.id,
      tenantId,
      role as Role,
      body,
    );
    if (result instanceof NotFoundException) throw result;
    if (result instanceof ForbiddenException) throw result;
    return result;
  }

  /**
   * PATCH /quotes/:id/items/:itemId
   * Updates a line item on a DRAFT quote.
   * Staff: description, quantity, days only.
   * Admin: + discountAmount.
   * rate is never editable (price-lock rule).
   */
  @Patch(':id/items/:itemId')
  @Roles(Role.ADMIN, Role.STAFF)
  async updateItem(
    @Param() param: QuoteItemIdParamDto,
    @Body() body: UpdateQuoteItemDto,
    @Req() req: any,
  ) {
    const { tenantId, role } = req.user as any;
    this.logger.log(`Updating item ${param.itemId} on quote ${param.id}`);
    const result = await this.quotesService.updateItem(
      param.id,
      param.itemId,
      tenantId,
      role as Role,
      body,
    );
    if (result instanceof NotFoundException) throw result;
    if (result instanceof ForbiddenException) throw result;
    return result;
  }

  /**
   * DELETE /quotes/:id/items/:itemId
   * Removes a line item from a DRAFT quote.
   */
  @Delete(':id/items/:itemId')
  @Roles(Role.ADMIN, Role.STAFF)
  async removeItem(@Param() param: QuoteItemIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Removing item ${param.itemId} from quote ${param.id}`);
    const result = await this.quotesService.removeItem(
      param.id,
      param.itemId,
      tenantId,
    );
    if (result instanceof NotFoundException) throw result;
    return result;
  }

  // -------------------------------------------------------
  // STATUS TRANSITIONS
  // -------------------------------------------------------

  /**
   * POST /quotes/:id/submit
   * Moves a quote from DRAFT → PENDING_APPROVAL.
   * Both roles can submit — staff build and submit, admin approves.
   * Requires at least one line item.
   */
  @Post(':id/submit')
  @Roles(Role.ADMIN, Role.STAFF)
  async submitForApproval(@Param() param: QuoteIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Submitting quote ${param.id} for approval`);
    const result = await this.quotesService.submitForApproval(param.id, tenantId);
    if (result instanceof NotFoundException) throw result;
    return result;
  }

  /**
   * POST /quotes/:id/payment-proof
   * Uploads one or more payment proof images (M-Pesa receipts, bank slips)
   * and attaches them to the quote.
   * Field name in the multipart form: "images".
   */
  @Post(':id/payment-proof')
  @Roles(Role.ADMIN, Role.STAFF)
  @UseInterceptors(FilesInterceptor('images'))
  async addPaymentProof(
    @Param() param: QuoteIdParamDto,
    @Req() req: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(
      `Uploading ${files?.length ?? 0} payment proof image(s) to quote ${param.id}`,
    );
    const result = await this.quotesService.addPaymentProof(
      param.id,
      tenantId,
      files,
    );
    if (result instanceof NotFoundException) throw result;
    return result;
  }

  /**
   * DELETE /quotes/:id/payment-proof/:proofId
   * Deletes a single payment proof image from a quote.
   * Removes both the DB row and the Cloudinary file.
   * ADMIN only.
   */
  @Delete(':id/payment-proof/:proofId')
  @Roles(Role.ADMIN)
  async deletePaymentProof(
    @Param() param: QuotePaymentProofIdParamDto,
    @Req() req: any,
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(
      `Deleting payment proof ${param.proofId} from quote ${param.id}`,
    );
    const result = await this.quotesService.deletePaymentProof(
      param.id,
      param.proofId,
      tenantId,
    );
    if (result instanceof NotFoundException) throw result;
    return result;
  }

  /**
   * POST /quotes/:id/approve
   * Approves the quote and triggers the full approval flow:
   *   - Creates the Event (main bucket)
   *   - Creates DISPATCH StockMovements for all RENTAL/SALE items
   *   - Creates ServiceBucket for all SERVICE items
   *   - Locks quote status to APPROVED
   * ADMIN only.
   */
  @Post(':id/approve')
  @Roles(Role.ADMIN)
  async approveQuote(@Param() param: QuoteIdParamDto, @Req() req: any) {
    const { tenantId, id: userId } = req.user as any;
    this.logger.log(`Admin ${userId} approving quote ${param.id}`);
    const result = await this.quotesService.approveQuote(
      param.id,
      tenantId,
      userId,
    );
    if (result instanceof NotFoundException) throw result;
    if (result instanceof BadRequestException) throw result;
    return result;
  }

  /**
   * POST /quotes/:id/cancel
   * Cancels a DRAFT or PENDING_APPROVAL quote.
   * ADMIN only — cannot cancel an already-APPROVED quote via this endpoint.
   */
  @Post(':id/cancel')
  @Roles(Role.ADMIN)
  async cancelQuote(@Param() param: QuoteIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Cancelling quote ${param.id}`);
    const result = await this.quotesService.cancelQuote(param.id, tenantId);
    if (result instanceof NotFoundException) throw result;
    return result;
  }
}
