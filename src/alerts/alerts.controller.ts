import {
  Controller,
  Post,
  Body,
  Patch,
  Param,
  Get,
  UseGuards,
  UseInterceptors,
  Request,
  Query,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole, Severity, AlertStatus } from '@prisma/client';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody, ApiQuery } from '@nestjs/swagger';
import { IngestEventDto } from './dto/ingest-event.dto';
import { AssignAlertDto } from './dto/assign-alert.dto';
import { ResolveAlertDto } from './dto/resolve-alert.dto';
import { ReopenAlertDto } from './dto/reopen-alert.dto';
import { AddCommentDto } from './dto/add-comment.dto';

@ApiTags('Alerts Engine & Lifecycles')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  /**
   * External Event Webhook integration layer.
   * Access: Authenticated client/External integrations.
   */
  @Post('event')
  @ApiOperation({ summary: 'Ingest events from external inspection applications (Voice, Vision, Fleet)' })
  @ApiResponse({ status: 202, description: 'Event queued successfully' })
  ingestEvent(
    @Body() payload: IngestEventDto,
  ) {
    return this.alertsService.ingestEvent(payload);
  }

  @Patch(':id/assign')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantInterceptor)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reassign an alert to a specific worker, role, or team' })
  assign(
    @TenantId() companyId: string,
    @Param('id') alertId: string,
    @Request() req: any,
    @Body() data: AssignAlertDto,
  ) {
    return this.alertsService.assignAlert(companyId, alertId, req.user.id, data);
  }

  @Post(':id/takeover')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantInterceptor)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Take over an active defect alert' })
  takeover(
    @TenantId() companyId: string,
    @Param('id') alertId: string,
    @Request() req: any,
  ) {
    return this.alertsService.takeoverAlert(companyId, alertId, req.user.id);
  }

  @Post(':id/resolve')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantInterceptor)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resolve an active defect alert with notes, media uploads, or audio descriptions' })
  resolve(
    @TenantId() companyId: string,
    @Param('id') alertId: string,
    @Request() req: any,
    @Body() data: ResolveAlertDto,
  ) {
    return this.alertsService.resolveAlert(companyId, alertId, req.user.id, data);
  }

  @Post(':id/reopen')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantInterceptor)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reopen a previously resolved alert if defect is not fully fixed' })
  reopen(
    @TenantId() companyId: string,
    @Param('id') alertId: string,
    @Request() req: any,
    @Body() data: ReopenAlertDto,
  ) {
    return this.alertsService.reopenAlert(companyId, alertId, req.user.id, data.reason);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantInterceptor)
  @ApiBearerAuth()
  @ApiQuery({ name: 'status', enum: AlertStatus, required: false })
  @ApiQuery({ name: 'severity', enum: Severity, required: false })
  @ApiQuery({ name: 'assignedToUserId', type: String, required: false })
  @ApiQuery({ name: 'assignedToRole', enum: UserRole, required: false })
  @ApiQuery({ name: 'allVisible', type: Boolean, required: false })
  @ApiOperation({ summary: 'List alerts with optional filtering' })
  findAllAlerts(
    @TenantId() companyId: string,
    @Request() req: any,
    @Query('status') status?: AlertStatus,
    @Query('severity') severity?: Severity,
    @Query('assignedToUserId') assignedToUserId?: string,
    @Query('assignedToRole') assignedToRole?: UserRole,
    @Query('allVisible') allVisible?: string,
  ) {
    return this.alertsService.findAlerts(companyId, {
      status,
      severity,
      assignedToUserId,
      assignedToRole,
      allVisible: allVisible === 'true',
    }, req.user);
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantInterceptor)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get aggregated statistics for user dashboard visual charts' })
  getDashboard(@TenantId() companyId: string, @Request() req: any) {
    return this.alertsService.getDashboardTelemetry(companyId, req.user);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantInterceptor)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get details of a single alert' })
  findOneAlert(
    @TenantId() companyId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.alertsService.findOneAlert(companyId, id, req.user.id);
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantInterceptor)
  @ApiBearerAuth()
  @ApiBody({ type: AddCommentDto })
  @ApiOperation({ summary: 'Add a comment to an alert' })
  addComment(
    @TenantId() companyId: string,
    @Param('id') alertId: string,
    @Request() req: any,
    @Body() data: AddCommentDto,
  ) {
    return this.alertsService.addComment(companyId, alertId, req.user.id, data);
  }
}
