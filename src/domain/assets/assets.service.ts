import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MovementType } from 'generated/prisma/client';
import { S3Service } from 'src/domain/GlobalServices/s3/s3.service';
import { AssetsRepository } from './assets.repository';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private assetsRepo: AssetsRepository,
    private s3: S3Service,
  ) {}

  // -------------------------------------------------------
  // CATEGORIES
  // -------------------------------------------------------

  /**
   * Creates a root category or a sub-category with an optional image.
   *
   * Flow when a file is provided:
   *   1. Upload to Cloudinary → get { secure_url, public_id }
   *   2. Write the category row with imageUrl + imagePublicId
   *   3. If the DB write fails → delete the Cloudinary file (rollback)
   *
   * If no file is provided the category is created without an image.
   */
  async createCategory(
    tenantId: string,
    name: string,
    parentId?: string,
    file?: Express.Multer.File,
  ) {
    let uploadedPublicId: string | undefined;

    try {
      // Tenant firewall: validate the parent belongs to the same tenant
      if (parentId) {
        const parent = await this.assetsRepo.findCategoryById(
          parentId,
          tenantId,
        );
        if (!parent) {
          return new BadRequestException(
            `Parent category with id "${parentId}" was not found`,
          );
        }
      }

      let imageUrl: string | undefined;
      let imagePublicId: string | undefined;

      if (file) {
        const uploaded = await this.s3.uploadFile(file, 'categories');
        imageUrl = uploaded.secure_url;
        imagePublicId = uploaded.public_id;
        uploadedPublicId = uploaded.public_id; // keep for rollback
      }

      return await this.assetsRepo.createCategory(
        tenantId,
        name,
        parentId,
        imageUrl,
        imagePublicId,
      );
    } catch (error) {
      // Rollback Cloudinary upload if DB write failed
      if (uploadedPublicId) {
        this.logger.warn(
          `DB write failed after Cloudinary upload — deleting orphaned file ${uploadedPublicId}`,
        );
        await this.s3.deleteFile(uploadedPublicId).catch((e) =>
          this.logger.error(`Cloudinary rollback failed: ${e.message}`),
        );
      }

      if (error?.code === 'P2002') {
        return new BadRequestException(
          `Category "${name}" already exists for this tenant`,
        );
      }
      return new BadRequestException(error);
    }
  }

  async getCategories(tenantId: string) {
    try {
      return await this.assetsRepo.findCategoriesByTenant(tenantId);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  /**
   * Deletes a category and cleans up its Cloudinary image.
   *
   * Flow:
   *   1. Fetch category to get imagePublicId
   *   2. Delete the DB row
   *   3. If imagePublicId existed → delete from Cloudinary (best-effort)
   */
  async deleteCategory(id: string, tenantId: string) {
    try {
      const category = await this.assetsRepo.findCategoryById(id, tenantId);
      if (!category) {
        return new NotFoundException(`Category with id "${id}" was not found`);
      }

      await this.assetsRepo.deleteCategory(id, tenantId);

      if (category.imagePublicId) {
        await this.s3.deleteFile(category.imagePublicId).catch((e) =>
          this.logger.error(
            `Cloudinary cleanup failed for category ${id}: ${e.message}`,
          ),
        );
      }

      return { message: 'Category deleted successfully' };
    } catch (error) {
      if (error?.code === 'P2003') {
        return new BadRequestException(
          'Cannot delete a category that has assets or sub-categories linked to it',
        );
      }
      return new BadRequestException(error);
    }
  }

  // -------------------------------------------------------
  // ASSETS
  // -------------------------------------------------------

  /**
   * Creates a new asset with optional images.
   *
   * Flow when files are provided:
   *   1. Upload all files to Cloudinary in parallel
   *   2. Write the asset row
   *   3. Write AssetImage rows
   *   4. If DB write fails → delete all uploaded Cloudinary files
   */
  async createAsset(
    tenantId: string,
    data: {
      name: string;
      sku?: string;
      categoryId: string;
      metadata?: Record<string, unknown>;
      totalStock: number;
      baseRentalRate: number;
    },
    files?: Express.Multer.File[],
  ) {
    const uploadedPublicIds: string[] = [];

    try {
      // Upload images first (before DB write) so we have the URLs ready
      const uploadedImages: { imageUrl: string; publicId: string }[] = [];

      if (files && files.length > 0) {
        const results = await this.s3.uploadMultipleFiles(files, 'assets');
        for (const result of results) {
          uploadedPublicIds.push(result.public_id);
          uploadedImages.push({
            imageUrl: result.secure_url,
            publicId: result.public_id,
          });
        }
      }

      const asset = await this.assetsRepo.createAsset(tenantId, data);

      console.log('Created asset with ID:', asset.id);

      if (uploadedImages.length > 0) {
        await this.assetsRepo.addAssetImages(asset.id, uploadedImages);
      }

      // Return the asset with images included
      return await this.assetsRepo.findById(asset.id, tenantId);
    } catch (error) {
      // Rollback all Cloudinary uploads if DB write failed
      if (uploadedPublicIds.length > 0) {
        this.logger.warn(
          `DB write failed — rolling back ${uploadedPublicIds.length} Cloudinary uploads`,
        );
        await Promise.all(
          uploadedPublicIds.map((pid) =>
            this.s3
              .deleteFile(pid)
              .catch((e) =>
                this.logger.error(`Cloudinary rollback failed for ${pid}: ${e.message}`),
              ),
          ),
        );
      }

      if (error?.code === 'P2003') {
        return new BadRequestException(
          'The provided categoryId does not exist or belongs to another tenant',
        );
      }
      return new BadRequestException(error);
    }
  }

  async getAssets(tenantId: string) {
    try {
      return await this.assetsRepo.findAllByTenant(tenantId);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async getAssetById(id: string, tenantId: string) {
    try {
      const asset = await this.assetsRepo.findById(id, tenantId);

      if (!asset) {
        return new NotFoundException(`Asset with id "${id}" was not found`);
      }

      return asset;
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async updateAsset(
    id: string,
    tenantId: string,
    data: {
      name?: string;
      sku?: string;
      categoryId?: string;
      metadata?: Record<string, unknown>;
      baseRentalRate?: number;
    },
  ) {
    try {
      return await this.assetsRepo.updateAsset(id, tenantId, data);
    } catch (error) {
      if (error?.code === 'P2025') {
        return new NotFoundException(`Asset with id "${id}" was not found`);
      }
      if (error?.code === 'P2003') {
        return new BadRequestException(
          'The provided categoryId does not exist',
        );
      }
      return new BadRequestException(error);
    }
  }

  async updateMetadata(
    id: string,
    tenantId: string,
    metadata: Record<string, unknown>,
  ) {
    try {
      return await this.assetsRepo.updateMetadata(id, tenantId, metadata);
    } catch (error) {
      if (error?.code === 'P2025') {
        return new NotFoundException(`Asset with id "${id}" was not found`);
      }
      return new BadRequestException(error);
    }
  }

  /**
   * Deletes an asset and cleans up all its Cloudinary images.
   *
   * Flow:
   *   1. Fetch asset (with images) to get publicIds
   *   2. Delete the DB row (cascade deletes AssetImage rows)
   *   3. Delete each Cloudinary file best-effort (log errors but don't fail)
   */
  async deleteAsset(id: string, tenantId: string) {
    try {
      const asset = await this.assetsRepo.findById(id, tenantId);
      if (!asset) {
        return new NotFoundException(`Asset with id "${id}" was not found`);
      }

      const publicIds = asset.images.map((img) => img.publicId);

      await this.assetsRepo.deleteAsset(id, tenantId);

      // Best-effort Cloudinary cleanup — don't fail the request if S3 is flaky
      await Promise.all(
        publicIds.map((pid) =>
          this.s3
            .deleteFile(pid)
            .catch((e) =>
              this.logger.error(
                `Cloudinary cleanup failed for asset ${id}, publicId ${pid}: ${e.message}`,
              ),
            ),
        ),
      );

      return { message: 'Asset deleted successfully' };
    } catch (error) {
      if (error?.code === 'P2025') {
        return new NotFoundException(`Asset with id "${id}" was not found`);
      }
      if (error?.code === 'P2003') {
        return new BadRequestException(
          'Cannot delete an asset that is referenced in one or more quotes',
        );
      }
      return new BadRequestException(error);
    }
  }

  // -------------------------------------------------------
  // ASSET IMAGES
  // -------------------------------------------------------

  /**
   * Uploads one or more images and attaches them to the asset.
   *
   * Flow:
   *   1. Verify the asset belongs to the tenant
   *   2. Upload files to Cloudinary
   *   3. Write AssetImage rows
   *   4. On DB failure → rollback all uploads
   */
  async addImages(
    assetId: string,
    tenantId: string,
    files: Express.Multer.File[],
  ) {
    const uploadedPublicIds: string[] = [];

    try {
      const asset = await this.assetsRepo.findById(assetId, tenantId);
      if (!asset) {
        return new NotFoundException(`Asset with id "${assetId}" was not found`);
      }

      const results = await this.s3.uploadMultipleFiles(files, 'assets');
      const images: { imageUrl: string; publicId: string }[] = [];

      for (const result of results) {
        uploadedPublicIds.push(result.public_id);
        images.push({ imageUrl: result.secure_url, publicId: result.public_id });
      }

      await this.assetsRepo.addAssetImages(assetId, images);

      return images;
    } catch (error) {
      if (uploadedPublicIds.length > 0) {
        this.logger.warn(
          `DB write failed — rolling back ${uploadedPublicIds.length} Cloudinary uploads`,
        );
        await Promise.all(
          uploadedPublicIds.map((pid) =>
            this.s3
              .deleteFile(pid)
              .catch((e) =>
                this.logger.error(`Cloudinary rollback failed for ${pid}: ${e.message}`),
              ),
          ),
        );
      }
      return new BadRequestException(error);
    }
  }

  /**
   * Deletes a single image from an asset.
   *
   * Flow:
   *   1. Verify the asset belongs to the tenant
   *   2. Fetch the image row to get publicId
   *   3. Delete the DB row
   *   4. Delete from Cloudinary best-effort
   */
  async deleteImage(assetId: string, imageId: string, tenantId: string) {
    try {
      const asset = await this.assetsRepo.findById(assetId, tenantId);
      if (!asset) {
        return new NotFoundException(`Asset with id "${assetId}" was not found`);
      }

      const image = await this.assetsRepo.findAssetImageById(imageId, assetId);
      if (!image) {
        return new NotFoundException(`Image with id "${imageId}" was not found`);
      }

      await this.assetsRepo.deleteAssetImage(imageId);

      await this.s3.deleteFile(image.publicId).catch((e) =>
        this.logger.error(
          `Cloudinary cleanup failed for image ${imageId}: ${e.message}`,
        ),
      );

      return { message: 'Image deleted successfully' };
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  // -------------------------------------------------------
  // STOCK MOVEMENT
  // -------------------------------------------------------

  /**
   * Validates a stock movement and atomically updates the asset's inventory buckets.
   *
   * Flow:
   *   1. Fetch current asset state (also validates tenantId ownership).
   *   2. Compute bucket deltas from the MovementType.
   *   3. Pre-flight validation: apply deltas in memory and check nothing goes < 0.
   *   4. Persist via the repository transaction.
   */
  async moveStock(
    assetId: string,
    tenantId: string,
    userId: string,
    movement: {
      type: MovementType;
      quantity: number;
      eventId?: string;
      notes?: string;
    },
    files?: Express.Multer.File[],
  ) {
    const uploadedPublicIds: string[] = [];

    try {
      const asset = await this.assetsRepo.findById(assetId, tenantId);

      if (!asset) {
        return new NotFoundException(
          `Asset with id "${assetId}" was not found`,
        );
      }

      const { quantity, type } = movement;

      let unitsAvailableDelta = 0;
      let unitsOnSiteDelta = 0;
      let unitsInRepairDelta = 0;

      switch (type) {
        case MovementType.DISPATCH:
          unitsAvailableDelta = -quantity;
          unitsOnSiteDelta = +quantity;
          break;

        case MovementType.RETURN:
          unitsAvailableDelta = +quantity;
          unitsOnSiteDelta = -quantity;
          break;

        case MovementType.REPAIR_IN:
          unitsAvailableDelta = -quantity;
          unitsInRepairDelta = +quantity;
          break;

        case MovementType.REPAIR_OUT:
          unitsAvailableDelta = +quantity;
          unitsInRepairDelta = -quantity;
          break;

        case MovementType.LOSS:
          unitsAvailableDelta = -quantity;
          break;
      }

      const resultingAvailable = asset.unitsAvailable + unitsAvailableDelta;
      const resultingOnSite = asset.unitsOnSite + unitsOnSiteDelta;
      const resultingInRepair = asset.unitsInRepair + unitsInRepairDelta;

      if (resultingAvailable < 0) {
        return new BadRequestException(
          `Not enough available units. Have: ${asset.unitsAvailable}, requested: ${quantity}`,
        );
      }
      if (resultingOnSite < 0) {
        return new BadRequestException(
          `Cannot return more units than are on site. On site: ${asset.unitsOnSite}, requested: ${quantity}`,
        );
      }
      if (resultingInRepair < 0) {
        return new BadRequestException(
          `Cannot release more units from repair than are currently in repair. In repair: ${asset.unitsInRepair}, requested: ${quantity}`,
        );
      }

      // Upload condition photos before DB write
      const uploadedImages: { imageUrl: string; publicId: string }[] = [];
      if (files && files.length > 0) {
        const results = await this.s3.uploadMultipleFiles(
          files,
          'condition-photos',
        );
        for (const result of results) {
          uploadedPublicIds.push(result.public_id);
          uploadedImages.push({
            imageUrl: result.secure_url,
            publicId: result.public_id,
          });
        }
      }

      const result = await this.assetsRepo.recordMovement(
        assetId,
        tenantId,
        userId,
        movement,
        { unitsAvailableDelta, unitsOnSiteDelta, unitsInRepairDelta },
      );

      if (uploadedImages.length > 0) {
        await this.assetsRepo.addMovementImages(
          result.stockMovement.id,
          uploadedImages,
        );
      }

      return result;
    } catch (error) {
      if (uploadedPublicIds.length > 0) {
        this.logger.warn(
          `DB write failed — rolling back ${uploadedPublicIds.length} condition photo uploads`,
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
   * Deletes a single condition photo from a stock movement.
   *
   * Flow:
   *   1. Verify the asset belongs to the tenant (firewall)
   *   2. Fetch the image row to get publicId
   *   3. Delete the DB row
   *   4. Delete from Cloudinary best-effort
   */
  async deleteMovementImage(assetId: string, imageId: string, tenantId: string) {
    try {
      const asset = await this.assetsRepo.findById(assetId, tenantId);
      if (!asset) {
        return new NotFoundException(`Asset with id "${assetId}" was not found`);
      }

      const image = await this.assetsRepo.findMovementImageById(imageId);
      if (!image) {
        return new NotFoundException(
          `Movement image with id "${imageId}" was not found`,
        );
      }

      await this.assetsRepo.deleteMovementImage(imageId);

      await this.s3.deleteFile(image.publicId).catch((e) =>
        this.logger.error(
          `Cloudinary cleanup failed for movement image ${imageId}: ${e.message}`,
        ),
      );

      return { message: 'Condition photo deleted successfully' };
    } catch (error) {
      return new BadRequestException(error);
    }
  }
}
