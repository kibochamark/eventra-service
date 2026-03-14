import {
  IsArray,
  IsString,
  ArrayNotEmpty,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsEnum,
  MinLength,
} from 'class-validator';
import { Role } from 'generated/prisma/client';

export class UserIdParamDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}

export class UpdateUserInfoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class UpdateRoleDto {
  @IsEnum(Role)
  role: Role;
}

export class SetPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword: string;
}

// Legacy aliases kept so existing imports don't break
export class GetUserDto {
  @IsString()
  userId: string;
}

export class GetUserByTenant {
  @IsString()
  tenant: string;
}

export class RevokeUsersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  readonly usersids: string[];
}

export class UpdateUserInfo {
  @IsOptional()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  email: string;
}
