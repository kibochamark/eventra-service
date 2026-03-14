import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Role } from 'generated/prisma/client';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { AssetsService } from 'src/domain/assets/assets.service';
import {
  AssetIdParamDto,
  CategoryIdParamDto,
  CreateAssetDto,
  CreateCategoryDto,
  ImageIdParamDto,
  MoveStockDto,
  MovementImageIdParamDto,
  UpdateAssetDto,
  UpdateMetadataDto,
} from './dto/asset.dto';

/**
 * AssetController — handles all /assets routes.
 *
 * ROUTE ORDERING IS IMPORTANT:
 *   NestJS matches routes in the order they are declared in the class.
 *   Static routes MUST be declared before parameterised routes.
 *
 * Declaration order:
 *   1.  POST   /assets/categories
 *   2.  GET    /assets/categories
 *   3.  DELETE /assets/categories/:id
 *   4.  POST   /assets
 *   5.  GET    /assets
 *   6.  PATCH  /assets/:id/metadata          (sub-paths before bare /:id)
 *   7.  POST   /assets/:id/move
 *   8.  DELETE /assets/:id/movements/:imageId
 *   9.  POST   /assets/:id/images
 *   10. DELETE /assets/:id/images/:imageId
 *   11. GET    /assets/:id
 *   12. PATCH  /assets/:id
 *   13. DELETE /assets/:id
 */
@Controller('assets')
@UseGuards(RolesGuard)
export class AssetController {
  private readonly logger = new Logger(AssetController.name);

  constructor(private assetsService: AssetsService) {}

  // -------------------------------------------------------
  // CATEGORY ROUTES  (declared first — see ordering note above)
  // -------------------------------------------------------

  /**
   * POST /assets/categories
   * Creates a root category or a sub-category.
   * Accepts multipart/form-data so an optional image can be uploaded.
   * ADMIN only.
   */
  @Post('categories')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('image'))
  async createCategory(
    @Body() body: CreateCategoryDto,
    @Req() req: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(`Creating category "${body.name}" for tenant ${tenantId}`);
    return await this.assetsService.createCategory(
      tenantId,
      body.name,
      body.parentId,
      file,
    );
  }

  /**
   * GET /assets/categories
   * Returns the full category tree for the tenant (root categories with nested subCategories).
   */
  @Get('categories')
  @Roles(Role.ADMIN, Role.STAFF)
  async getCategories(@Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Listing categories for tenant ${tenantId}`);
    return await this.assetsService.getCategories(tenantId);
  }

  /**
   * DELETE /assets/categories/:id
   * Deletes a category and cleans up its Cloudinary image.
   * Returns 400 if the category has assets or sub-categories linked to it.
   * ADMIN only.
   */
  @Delete('categories/:id')
  @Roles(Role.ADMIN)
  async deleteCategory(@Param() param: CategoryIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Deleting category ${param.id} for tenant ${tenantId}`);
    const result = await this.assetsService.deleteCategory(param.id, tenantId);
    if (result instanceof HttpException) throw result;
    return result;
  }

  // -------------------------------------------------------
  // ASSET ROUTES (no path params)
  // -------------------------------------------------------

  /**
   * POST /assets
   * Registers a new asset. Accepts multipart/form-data for optional images.
   * unitsAvailable is auto-set to totalStock on creation.
   * ADMIN only.
   */
  @Post()
  @Roles(Role.ADMIN)
  @UseInterceptors(FilesInterceptor('images'))
  async createAsset(
    @Body() body: CreateAssetDto,
    @Req() req: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(`Creating asset "${body.name}" for tenant ${tenantId}`);
    const result = await this.assetsService.createAsset(tenantId, body, files);
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * GET /assets
   * Returns all assets for the tenant with current inventory bucket counts.
   * This is the Inventory Dashboard view.
   */
  @Get()
  @Roles(Role.ADMIN, Role.STAFF)
  async getAssets(@Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Listing inventory for tenant ${tenantId}`);
    return await this.assetsService.getAssets(tenantId);
  }

  // -------------------------------------------------------
  // ASSET ROUTES (with sub-paths — declared before bare /:id)
  // -------------------------------------------------------

  /**
   * PATCH /assets/:id/metadata
   * Replaces the entire metadata object for an asset.
   * Send the full desired state — this is a replace, not a merge.
   * ADMIN only.
   */
  @Patch(':id/metadata')
  @Roles(Role.ADMIN)
  async updateMetadata(
    @Param() param: AssetIdParamDto,
    @Body() body: UpdateMetadataDto,
    @Req() req: any,
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(`Updating metadata for asset ${param.id}`);
    const result = await this.assetsService.updateMetadata(
      param.id,
      tenantId,
      body.metadata,
    );
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * POST /assets/:id/move
   * Logs a stock movement and atomically updates the three inventory buckets.
   *
   * Movement types and their bucket effects:
   *   DISPATCH   → available ↓  onSite ↑
   *   RETURN     → available ↑  onSite ↓
   *   REPAIR_IN  → available ↓  inRepair ↑
   *   REPAIR_OUT → available ↑  inRepair ↓
   *   LOSS       → available ↓  (permanent, totalStock unchanged)
   */
  @Post(':id/move')
  @Roles(Role.ADMIN, Role.STAFF)
  @UseInterceptors(FilesInterceptor('images'))
  async moveStock(
    @Param() param: AssetIdParamDto,
    @Body() body: MoveStockDto,
    @Req() req: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const { tenantId, id: userId } = req.user as any;
    this.logger.log(
      `Stock movement: ${body.type} x${body.quantity} on asset ${param.id} by user ${userId}`,
    );
    const result = await this.assetsService.moveStock(
      param.id,
      tenantId,
      userId,
      body,
      files,
    );
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * DELETE /assets/:id/movements/:imageId
   * Deletes a single condition photo from a stock movement.
   * ADMIN only.
   */
  @Delete(':id/movements/:imageId')
  @Roles(Role.ADMIN)
  async deleteMovementImage(
    @Param() param: MovementImageIdParamDto,
    @Req() req: any,
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(
      `Deleting movement image ${param.imageId} from asset ${param.id}`,
    );
    const result = await this.assetsService.deleteMovementImage(
      param.id,
      param.imageId,
      tenantId,
    );
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * POST /assets/:id/images
   * Uploads one or more images and attaches them to the asset.
   * Field name in the multipart form: "images".
   * ADMIN only.
   */
  @Post(':id/images')
  @Roles(Role.ADMIN)
  @UseInterceptors(FilesInterceptor('images'))
  async addImages(
    @Param() param: AssetIdParamDto,
    @Req() req: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(
      `Uploading ${files?.length ?? 0} image(s) to asset ${param.id}`,
    );
    const result = await this.assetsService.addImages(
      param.id,
      tenantId,
      files,
    );
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * DELETE /assets/:id/images/:imageId
   * Deletes a single image from an asset.
   * Removes both the DB row and the Cloudinary file.
   * ADMIN only.
   */
  @Delete(':id/images/:imageId')
  @Roles(Role.ADMIN)
  async deleteImage(@Param() param: ImageIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Deleting image ${param.imageId} from asset ${param.id}`);
    const result = await this.assetsService.deleteImage(
      param.id,
      param.imageId,
      tenantId,
    );
    if (result instanceof HttpException) throw result;
    return result;
  }

  // -------------------------------------------------------
  // ASSET ROUTES (bare /:id — declared last)
  // -------------------------------------------------------

  /**
   * GET /assets/:id
   * Returns a single asset with category info, images, and the 20 most recent stock movements.
   * Returns 404 if the asset does not exist or belongs to another tenant.
   */
  @Get(':id')
  @Roles(Role.ADMIN, Role.STAFF)
  async getAsset(@Param() param: AssetIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Fetching asset ${param.id} for tenant ${tenantId}`);
    const result = await this.assetsService.getAssetById(param.id, tenantId);
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * PATCH /assets/:id
   * Partially updates an asset's name, SKU, category, metadata, or base rental rate.
   * totalStock is intentionally excluded — use POST /assets/:id/move for stock changes.
   * ADMIN only.
   */
  @Patch(':id')
  @Roles(Role.ADMIN)
  async updateAsset(
    @Param() param: AssetIdParamDto,
    @Body() body: UpdateAssetDto,
    @Req() req: any,
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(`Updating asset ${param.id} for tenant ${tenantId}`);
    const result = await this.assetsService.updateAsset(
      param.id,
      tenantId,
      body,
    );
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * DELETE /assets/:id
   * Permanently removes an asset and all its Cloudinary images.
   * Returns 400 if the asset is referenced in any quote (FK constraint).
   * ADMIN only.
   */
  @Delete(':id')
  @Roles(Role.ADMIN)
  async deleteAsset(@Param() param: AssetIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Deleting asset ${param.id} for tenant ${tenantId}`);
    const result = await this.assetsService.deleteAsset(param.id, tenantId);
    if (result instanceof HttpException) throw result;
    return result;
  }
}
