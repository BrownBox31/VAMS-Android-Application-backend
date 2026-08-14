import { IsString, IsNotEmpty, IsOptional, IsEnum, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole, Severity } from '@prisma/client';
import { Transform } from 'class-transformer';

export class IngestEventDto {
  @ApiProperty({ example: 'voice-inspection', description: 'Source system of the event' })
  @IsString()
  @IsNotEmpty()
  source: string;

  @ApiProperty({ example: 'DEFECT_CREATED', description: 'Type of the event' })
  @IsString()
  @IsNotEmpty()
  event_type: string;

  @ApiProperty({ example: 'b812efd9-a412-4011-9a99-b1d5e3cdae01', description: 'Tenant company ID' })
  @IsString()
  @IsNotEmpty()
  companyId: string;

  @ApiProperty({ example: 'MALXW35848DJ29103', required: false, description: 'Vehicle Identification Number' })
  @IsString()
  @IsOptional()
  vin?: string;

  @ApiProperty({ example: 'Brake System Fluid Leak', required: false, description: 'Defect description matching catalog' })
  @IsString()
  @IsOptional()
  defectName?: string;

  @ApiProperty({ example: 'Urgent Announcement', required: false, description: 'Title of the broadcast' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ example: 'a56fbdbe-2bd4-4ad6-9380-602933e1f3ec', required: false, description: 'Reference ID to the definition rule template' })
  @IsString()
  @IsOptional()
  alertDefinitionId?: string;

  @ApiProperty({ example: 'Dispatched custom instruction', required: false, description: 'Custom dispatcher instructions' })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiProperty({ example: 'd50a29e4-bcde-4211-8fa1-71ca36df201a', required: false, description: 'ID of the user to assign the alert to' })
  @IsString()
  @IsOptional()
  assignedToUserId?: string;

  @ApiProperty({ enum: UserRole, example: 'WORKER', required: false, description: 'Role to assign the alert to' })
  @Transform(({ value }) => {
    if (value === 'ADMIN' || value === 'Admin') return UserRole.COMPANY_ADMIN;
    if (value === 'MANAGER' || value === 'Manager') return UserRole.FACTORY_MANAGER;
    return value;
  })
  @IsEnum(UserRole)
  @IsOptional()
  assignedToRole?: UserRole;

  @ApiProperty({ enum: Severity, example: 'MEDIUM', required: false, description: 'Severity level override' })
  @IsEnum(Severity)
  @IsOptional()
  severity?: Severity;

  @ApiProperty({ example: 'a56fbdbe-2bd4-4ad6-9380-602933e1f3ec', required: false, description: 'Reference ID to the created alert record' })
  @IsString()
  @IsOptional()
  alertId?: string;

  @ApiProperty({ example: ['user-uuid-1'], required: false, description: 'IDs of specific users to target for broadcast' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetUserIds?: string[];

  @ApiProperty({ enum: UserRole, isArray: true, example: ['WORKER'], required: false, description: 'Roles to target for broadcast' })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  @IsOptional()
  targetRoles?: UserRole[];

  @ApiProperty({ example: true, required: false, description: 'Flag indicating whether SLA escalation loop has completed' })
  @IsOptional()
  loopCompleted?: boolean;
}
