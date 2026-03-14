import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ItemType } from 'generated/prisma/client';
import { IsNotPastDate } from 'src/common/validators/is-not-past-date.validator';

export class CreateQuoteDto {
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsNotPastDate()
  @IsDateString()
  @IsOptional()
  eventStartDate?: string;

  @IsNotPastDate()
  @IsDateString()
  @IsOptional()
  eventEndDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateQuoteHeaderDto {
  @Transform(({ value }) => (value !== undefined ? parseFloat(value) : value))
  @IsNumber()
  @Min(0)
  @IsOptional()
  globalDiscount?: number;

  @IsBoolean()
  @IsOptional()
  includeVat?: boolean;

  @IsString()
  @IsOptional()
  clientId?: string;

  @IsNotPastDate()
  @IsDateString()
  @IsOptional()
  eventStartDate?: string;

  @IsNotPastDate()
  @IsDateString()
  @IsOptional()
  eventEndDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AddQuoteItemDto {
  @IsEnum(ItemType)
  type: ItemType;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  assetId?: string;

  @Transform(({ value }) => (value !== undefined ? parseInt(value, 10) : value))
  @IsNumber()
  @Min(1)
  quantity: number;

  // days is only meaningful for RENTAL items; defaults to 1 in the repo layer
  @Transform(({ value }) => (value !== undefined ? parseInt(value, 10) : value))
  @IsNumber()
  @Min(1)
  @IsOptional()
  days?: number;

  // Only settable by ADMIN — service layer enforces this
  @Transform(({ value }) => (value !== undefined ? parseFloat(value) : value))
  @IsNumber()
  @Min(0)
  @IsOptional()
  discountAmount?: number;

  // Required for SERVICE items; ignored for RENTAL/SALE (rate is price-locked from asset)
  @Transform(({ value }) => (value !== undefined ? parseFloat(value) : value))
  @IsNumber()
  @Min(0)
  @IsOptional()
  rate?: number;
}

export class UpdateQuoteItemDto {
  @IsString()
  @IsOptional()
  description?: string;

  @Transform(({ value }) => (value !== undefined ? parseInt(value, 10) : value))
  @IsNumber()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @Transform(({ value }) => (value !== undefined ? parseInt(value, 10) : value))
  @IsNumber()
  @Min(1)
  @IsOptional()
  days?: number;

  // Only settable by ADMIN — service layer enforces this
  @Transform(({ value }) => (value !== undefined ? parseFloat(value) : value))
  @IsNumber()
  @Min(0)
  @IsOptional()
  discountAmount?: number;
}

export class QuoteIdParamDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class QuoteItemIdParamDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  itemId: string;
}

/** Params for DELETE /quotes/:id/payment-proof/:proofId */
export class QuotePaymentProofIdParamDto {
  @IsString()
  @IsNotEmpty()
  id: string; // quoteId

  @IsString()
  @IsNotEmpty()
  proofId: string; // QuotePaymentProof id
}
