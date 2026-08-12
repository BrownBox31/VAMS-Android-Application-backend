import { Controller, Post, Body, Get, Delete, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { DefectsService } from './defects.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole, Severity } from '@prisma/client';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { CreateDefectDto } from './dto/create-defect.dto';

@ApiTags('Defect Master Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
@Controller('defects')
export class DefectsController {
  constructor(private readonly defectsService: DefectsService) {}

  @Post()
  @Roles(UserRole.COMPANY_ADMIN, UserRole.FACTORY_MANAGER)
  @ApiOperation({ summary: 'Register a new defect inside the Defect Master catalog' })
  create(
    @TenantId() companyId: string,
    @Body() data: CreateDefectDto,
  ) {
    return this.defectsService.create(companyId, data);
  }

  @Post('sync-python')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.FACTORY_MANAGER)
  @ApiOperation({ summary: 'Sync cleaned defect terms from the Python backend data directory into the company defect master catalog' })
  syncPython(
    @TenantId() companyId: string,
  ) {
    return this.defectsService.syncPythonDefects(companyId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all active defect types for the company' })
  findAll(@TenantId() companyId: string) {
    return this.defectsService.findAll(companyId);
  }

  @Delete(':id')
  @Roles(UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Deactivate a defect type' })
  deactivate(@TenantId() companyId: string, @Param('id') id: string) {
    return this.defectsService.deactivate(companyId, id);
  }
}
