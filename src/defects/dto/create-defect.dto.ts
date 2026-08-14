import { IsString, IsNotEmpty, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole, Severity } from '@prisma/client';
import { Transform } from 'class-transformer';

export class CreateDefectDto {
  @ApiProperty({ example: 'Brake System Fluid Leak', description: 'Name of the defect type' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Brake System', description: 'Category of the defect' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ enum: Severity, example: 'CRITICAL', description: 'Severity level' })
  @IsEnum(Severity)
  @IsNotEmpty()
  severity: Severity;

  @ApiProperty({ enum: UserRole, example: 'QUALITY_INSPECTOR', required: false, description: 'Default role assigned to fix this defect' })
  @Transform(({ value }) => {
    if (value === 'ADMIN' || value === 'Admin') return UserRole.COMPANY_ADMIN;
    if (value === 'MANAGER' || value === 'Manager') return UserRole.FACTORY_MANAGER;
    return value;
  })
  @IsEnum(UserRole)
  @IsOptional()
  defaultAssigneeRole?: UserRole;

  @ApiProperty({ example: true, required: false, description: 'Whether the vehicle owner can see this defect' })
  @IsBoolean()
  @IsOptional()
  ownerVisible?: boolean;

  @ApiProperty({ example: 'CRITICAL', required: false, description: 'Sound profile reference for notification' })
  @IsString()
  @IsOptional()
  soundProfile?: string;
}
