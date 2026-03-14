import { IsBoolean, IsOptional, IsString } from "class-validator";


export class CreateTenantDto {
    @IsString()
    companyName: string;

    @IsOptional()
    @IsBoolean()
    isVatRegistered?: boolean;

    @IsOptional()
    vatPercentage?: number;
}

export class UpdateTenantDto {
    @IsOptional()
    @IsString()
    companyName?: string;

    @IsOptional()
    @IsBoolean()
    isVatRegistered?: boolean;

    @IsOptional()
    vatPercentage?: number;
}


export class TenantGetDto {
    @IsOptional()
    @IsString()
    id: string;

}


export class TenantGetByNameDto {
    @IsOptional()
    @IsString()
    name: string;

}