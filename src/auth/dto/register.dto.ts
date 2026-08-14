import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @ApiProperty({ example: 'John Doe', description: 'The full name of the user' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'john.doe@example.com', description: 'The email address of the user' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'password123', description: 'The password for the user account (min 6 characters)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'Tata Motors', description: 'The Company ID (UUID) or Name' })
  @IsString()
  @IsNotEmpty()
  companyId: string;

  @ApiProperty({
    example: 'WORKER',
    enum: UserRole,
    description: 'System role for the user',
    required: false,
    default: 'WORKER',
  })
  @Transform(({ value }) => {
    if (value === 'ADMIN' || value === 'Admin') return UserRole.COMPANY_ADMIN;
    if (value === 'MANAGER' || value === 'Manager') return UserRole.FACTORY_MANAGER;
    return value;
  })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;
}

export class RegisterResponseDto {
  @ApiProperty({ example: 'd3b07384-d113-4956-a5cc-96dd4fcf05a6' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

  @ApiProperty({ example: 'WORKER', enum: UserRole })
  role: UserRole;

  @ApiProperty({ example: 'a9f24dcd-5954-47e2-a0b4-6a053cbf094a' })
  companyId: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2026-07-02T14:09:59.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-07-02T14:09:59.000Z' })
  updatedAt: Date;
}
