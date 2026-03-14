import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsPositive,
  IsEnum,
  IsObject,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { MovementType } from 'generated/prisma/client';

// -------------------------------------------------------
// Category DTOs
// -------------------------------------------------------

/**
 * Body for POST /assets/categories
 * Supports multipart/form-data so an optional image file can accompany the request.
 * parentId is optional — omit for root categories, provide to create a sub-category.
 */
export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

export class CategoryIdParamDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

// -------------------------------------------------------
// Asset DTOs
// -------------------------------------------------------

/**
 * Body for POST /assets
 * When sent as multipart/form-data (for image upload), numeric fields
 * arrive as strings. @Transform converts them back to integers before
 * class-validator runs, so @IsInt() passes correctly.
 */
export class CreateAssetDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  // Multipart sends numbers as strings — @Transform parses them
  @Transform(({ value }) => (value !== undefined ? parseInt(value, 10) : value))
  @IsInt()
  @IsPositive()
  totalStock: number;

  // Stored as Int (e.g. KES cents) — do not send a float
  @Transform(({ value }) => (value !== undefined ? parseInt(value, 10) : value))
  @IsInt()
  @IsPositive()
  baseRentalRate: number;
}

/**
 * Body for PATCH /assets/:id
 * All fields optional — only provided fields are updated.
 * totalStock is excluded — stock changes go through POST /assets/:id/move.
 */
export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined ? parseInt(value, 10) : value))
  @IsInt()
  @IsPositive()
  baseRentalRate?: number;
}

/**
 * Body for PATCH /assets/:id/metadata
 * Replaces the entire metadata object — send the full desired state.
 */
export class UpdateMetadataDto {
  @IsObject()
  metadata: Record<string, unknown>;
}

// -------------------------------------------------------
// Stock Movement DTO
// -------------------------------------------------------

/**
 * Body for POST /assets/:id/move
 * quantity must be >= 1. type must be a valid MovementType enum value.
 */
export class MoveStockDto {
  @IsEnum(MovementType)
  type: MovementType;

  @Transform(({ value }) => (value !== undefined ? parseInt(value, 10) : value))
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// -------------------------------------------------------
// Param DTOs
// -------------------------------------------------------

export class AssetIdParamDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

/** Params for DELETE /assets/:id/images/:imageId */
export class ImageIdParamDto {
  @IsString()
  @IsNotEmpty()
  id: string; // assetId

  @IsString()
  @IsNotEmpty()
  imageId: string; // AssetImage id
}

/** Params for DELETE /assets/:id/movements/:imageId */
export class MovementImageIdParamDto {
  @IsString()
  @IsNotEmpty()
  id: string; // assetId

  @IsString()
  @IsNotEmpty()
  imageId: string; // StockMovementImage id
}
