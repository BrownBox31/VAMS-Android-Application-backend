import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';

export class AssignAlertDto {
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

  @ApiProperty({ example: 'Assembly Line B', required: false, description: 'Department to assign the alert to' })
  @IsString()
  @IsOptional()
  assignedToDepartment?: string;

  @ApiProperty({ example: 'Hydraulics Team', required: false, description: 'Team to assign the alert to' })
  @IsString()
  @IsOptional()
  assignedToTeam?: string;

  @ApiProperty({ example: 'Reassigned to John Doe for urgent line inspection.', required: false, description: 'Assignment notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}
