import { Injectable } from '@nestjs/common';
import { MovementType, Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class AssetsRepository {
  constructor(private prisma: PrismaService) {}

  // -------------------------------------------------------
  // CATEGORIES
  // -------------------------------------------------------

  /**
   * Creates a category for the tenant.
   * parentId is optional — omit for root categories, provide for sub-categories.
   * imageUrl/imagePublicId are optional — populated when a file is uploaded to Cloudinary.
   * The DB @@unique([name, tenantId]) constraint prevents duplicate names per tenant.
   * Caller must ensure parentId (if provided) belongs to the same tenant.
   */
  async createCategory(
    tenantId: string,
    name: string,
    parentId?: string,
    imageUrl?: string,
    imagePublicId?: string,
  ) {
    return await this.prisma.category.create({
      data: {
        name,
        tenantId,
        parentId: parentId ?? null,
        imageUrl: imageUrl ?? null,
        imagePublicId: imagePublicId ?? null,
      },
      include: {
        parent: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Deletes a category.
   * tenantId in the where clause prevents cross-tenant deletes.
   * Will throw P2003 if the category has linked assets or sub-categories — service handles this.
   */
  async deleteCategory(id: string, tenantId: string) {
    return await this.prisma.category.delete({ where: { id, tenantId } });
  }

  /**
   * Returns the category tree for a tenant.
   * Only root categories (parentId IS NULL) are fetched at the top level;
   * each root includes its subCategories nested one level deep.
   * This gives the UI a ready-to-render tree without extra queries.
   */
  async findCategoriesByTenant(tenantId: string) {
    return await this.prisma.category.findMany({
      where: { tenantId, parentId: null }, // root categories only
      include: {
        subCategories: {
          include: {
            subCategories: true, // support one more level (grandchildren)
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Finds a single category by id, scoped to the tenant.
   * Used to validate that a parentId belongs to the same tenant before creating a sub-category.
   */
  async findCategoryById(id: string, tenantId: string) {
    return await this.prisma.category.findUnique({
      where: { id, tenantId },
    });
  }

  // -------------------------------------------------------
  // ASSETS
  // -------------------------------------------------------

  /**
   * Creates a new asset.
   * unitsAvailable is initialised to totalStock — a brand-new asset has had
   * no movements, so every unit is available.
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
  ) {
    return await this.prisma.asset.create({
      data: {
        ...data,
        tenantId,
        unitsAvailable: data.totalStock, // start fully available
        metadata: data.metadata as Prisma.InputJsonValue,
      },
      include: {
        category: {
          include: { parent: { select: { id: true, name: true } } },
        },
      },
    });
  }

  /**
   * Lists all assets for the tenant with their bucket counts and category info.
   * The three buckets (unitsAvailable, unitsOnSite, unitsInRepair) are stored
   * columns updated by the /move endpoint, so this is a single fast query.
   */
  async findAllByTenant(tenantId: string) {
    return await this.prisma.asset.findMany({
      where: { tenantId },
      include: {
        category: {
          include: { parent: { select: { id: true, name: true } } },
        },
        images: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Fetches a single asset scoped to the tenant.
   * Returns null if the asset does not exist or belongs to another tenant.
   * Using findUnique (not findUniqueOrThrow) so the service can return a
   * clean 404 rather than letting a raw Prisma error bubble up.
   * Includes the 20 most recent stock movements for a movement history panel.
   */
  async findById(id: string, tenantId: string) {
    return await this.prisma.asset.findUnique({
      where: { id, tenantId }, // tenantId in where is the firewall
      include: {
        category: {
          include: { parent: { select: { id: true, name: true } } },
        },
        images: true,
        stockMovements: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { images: true },
        },
      },
    });
  }

  /**
   * Updates mutable asset fields.
   * tenantId in the where clause prevents cross-tenant writes.
   * Prisma ignores undefined values, so only provided fields are updated.
   */
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
    return await this.prisma.asset.update({
      where: { id, tenantId },
      data: {
        ...data,
        metadata: data.metadata as Prisma.InputJsonValue | undefined,
      } as Prisma.AssetUncheckedUpdateInput,
      include: {
        category: {
          include: { parent: { select: { id: true, name: true } } },
        },
      },
    });
  }

  /**
   * Replaces the metadata object entirely.
   * A dedicated method keeps intent clear — the caller is replacing,
   * not merging, the metadata.
   */
  async updateMetadata(
    id: string,
    tenantId: string,
    metadata: Record<string, unknown>,
  ) {
    return await this.prisma.asset.update({
      where: { id, tenantId },
      data: { metadata: metadata as Prisma.InputJsonValue },
      select: { id: true, name: true, metadata: true },
    });
  }

  /**
   * Deletes an asset.
   * tenantId in the where clause prevents cross-tenant deletes.
   * Will throw P2003 if the asset has related QuoteItems — the service handles this.
   */
  async deleteAsset(id: string, tenantId: string) {
    return await this.prisma.asset.delete({
      where: { id, tenantId },
    });
  }

  // -------------------------------------------------------
  // STOCK MOVEMENT
  // -------------------------------------------------------

  /**
   * Atomically records a stock movement AND updates the three inventory buckets.
   *
   * Why a transaction?
   *   If the StockMovement insert succeeds but the Asset bucket update fails,
   *   the movement log would show a change that never actually happened.
   *   A transaction guarantees both operations succeed or both roll back.
   *
   * bucketDelta encodes the signed change for each bucket:
   *   positive → increment, negative → decrement, 0 → no change.
   * Using increment(delta) avoids a read-then-write race condition compared
   * to fetching the current value and writing currentValue + delta.
   *
   * NOTE: The calling service MUST validate that resulting bucket values
   * won't go below zero BEFORE calling this method, since Prisma does not
   * enforce a >= 0 constraint on these columns at the DB level.
   */
  async recordMovement(
    assetId: string,
    tenantId: string,
    userId: string,
    movement: {
      type: MovementType;
      quantity: number;
      eventId?: string;
      notes?: string;
    },
    bucketDelta: {
      unitsAvailableDelta: number;
      unitsOnSiteDelta: number;
      unitsInRepairDelta: number;
    },
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // Step 1 — Create the audit trail record
      const stockMovement = await tx.stockMovement.create({
        data: {
          assetId,
          type: movement.type,
          quantity: movement.quantity,
          eventId: movement.eventId ?? null,
          notes: movement.notes ?? null,
          userId,
        },
      });

      // Step 2 — Apply bucket changes in the same transaction.
      // increment(negative number) effectively decrements.
      const updatedAsset = await tx.asset.update({
        where: { id: assetId, tenantId },
        data: {
          unitsAvailable: { increment: bucketDelta.unitsAvailableDelta },
          unitsOnSite: { increment: bucketDelta.unitsOnSiteDelta },
          unitsInRepair: { increment: bucketDelta.unitsInRepairDelta },
        },
        select: {
          id: true,
          name: true,
          unitsAvailable: true,
          unitsOnSite: true,
          unitsInRepair: true,
        },
      });

      return { stockMovement, updatedAsset };
    });
  }

  // -------------------------------------------------------
  // ASSET IMAGES
  // -------------------------------------------------------

  /**
   * Inserts multiple AssetImage rows for the given asset in one query.
   * Called after successful Cloudinary uploads — never before.
   */
  async addAssetImages(
    assetId: string,
    images: { imageUrl: string; publicId: string }[],
  ) {
    return await this.prisma.assetImage.createMany({
      data: images.map((img) => ({ assetId, ...img })),
    });
  }

  /**
   * Finds a single AssetImage scoped to the asset.
   * Returns null if the imageId doesn't exist or doesn't belong to the asset.
   * Used to fetch publicId before Cloudinary deletion.
   */
  async findAssetImageById(imageId: string, assetId: string) {
    return await this.prisma.assetImage.findFirst({
      where: { id: imageId, assetId },
    });
  }

  /**
   * Deletes a single AssetImage row by its own id.
   * Caller must delete the Cloudinary file after this succeeds.
   */
  async deleteAssetImage(imageId: string) {
    return await this.prisma.assetImage.delete({ where: { id: imageId } });
  }

  // -------------------------------------------------------
  // STOCK MOVEMENT IMAGES
  // -------------------------------------------------------

  async addMovementImages(
    stockMovementId: string,
    images: { imageUrl: string; publicId: string }[],
  ) {
    return await this.prisma.stockMovementImage.createMany({
      data: images.map((img) => ({ stockMovementId, ...img })),
    });
  }

  async findMovementImageById(imageId: string) {
    return await this.prisma.stockMovementImage.findUnique({
      where: { id: imageId },
    });
  }

  async deleteMovementImage(imageId: string) {
    return await this.prisma.stockMovementImage.delete({
      where: { id: imageId },
    });
  }
}
