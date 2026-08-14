import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertStatus, UserRole, Severity, NotificationChannel } from '@prisma/client';

@Injectable()
export class EscalationService implements OnModuleInit {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // Run the check every 60 seconds (1 minute interval)
    setInterval(async () => {
      try {
        await this.processEscalations();
      } catch (err) {
        this.logger.error('Error running periodic escalations:', err);
      }
    }, 60000);
  }

  /**
   * Periodically check for overdue alerts and trigger escalation workflows.
   * Can be invoked by a cron scheduler task in main app module.
   */
  async processEscalations() {
    const now = new Date();

    // Query active alerts requiring immediate escalation
    const overdueAlerts = await this.prisma.alert.findMany({
      where: {
        status: { not: AlertStatus.RESOLVED },
        nextEscalationAt: { lte: now },
      },
      include: {
        defect: true,
      },
    });

    if (overdueAlerts.length === 0) {
      return;
    }

    this.logger.log(`Found ${overdueAlerts.length} overdue alerts. Processing escalations...`);

    for (const alert of overdueAlerts) {
      try {
        await this.escalateAlert(alert);
      } catch (err) {
        this.logger.error(`Failed to escalate alert ${alert.id}:`, err.stack);
      }
    }
  }

  private async escalateAlert(alert: any) {
    const nextStep = alert.escalationStep + 1;
    const currentRole = alert.assignedToRole;

    // Define standard SLA escalation target hierarchy mapping Play rules
    let nextRole: UserRole = UserRole.SUPERVISOR;
    let incrementMin = 60; // default next check in 60 mins

    if (alert.severity === Severity.EMERGENCY) incrementMin = 15;
    else if (alert.severity === Severity.CRITICAL) incrementMin = 30;
    else if (alert.severity === Severity.HIGH) incrementMin = 120;
    else if (alert.severity === Severity.MEDIUM) incrementMin = 720;
    else if (alert.severity === Severity.LOW) incrementMin = 1440;
    else incrementMin = 4320;

    // Upward severity-based tier escalation hierarchy
    if (currentRole === UserRole.WORKER || currentRole === UserRole.QUALITY_INSPECTOR || currentRole === UserRole.SERVICE_ENGINEER) {
      nextRole = UserRole.SUPERVISOR;
    } else if (currentRole === UserRole.SUPERVISOR) {
      nextRole = UserRole.COMPANY_ADMIN;
    } else if (currentRole === UserRole.COMPANY_ADMIN) {
      nextRole = UserRole.SUPER_ADMIN;
    } else {
      nextRole = UserRole.SUPER_ADMIN;
    }

    // Apply database-configured overrides if present
    const overrideRule = await this.prisma.escalationRule.findFirst({
      where: {
        companyId: alert.companyId,
        severity: alert.severity,
        escalateToRole: nextRole,
        isActive: true,
      },
    });

    if (overrideRule) {
      incrementMin = overrideRule.escalateAfterDays * 24 * 60;
    }

    let nextEscalationAt = new Date(Date.now() + incrementMin * 60 * 1000);

    let nextUserId: string | null = null;
    let nextUserRole: UserRole = nextRole;

    let definitionChain: string[] = [];
    let escalationTimeoutMin = incrementMin;

    if (alert.alertDefinitionId) {
      const def = await this.prisma.alertDefinition.findUnique({
        where: { id: alert.alertDefinitionId },
      });
      if (def && def.escalationChain?.length > 0) {
        definitionChain = def.escalationChain;
        if (def.escalationTimeout) {
          escalationTimeoutMin = def.escalationTimeout;
        }
      }
    }

    if (definitionChain.length > 0) {
      const nextChainIndex = alert.escalationStep;
      
      if (nextChainIndex < definitionChain.length) {
        const nextTarget = definitionChain[nextChainIndex];
        
        if (nextTarget.startsWith('ROLE:')) {
          const targetRoleStr = nextTarget.substring(5).toUpperCase();
          nextUserRole = targetRoleStr as UserRole;
          nextUserId = null;
        } else {
          const nextUser = await this.prisma.user.findUnique({
            where: { id: nextTarget },
          });
          if (nextUser) {
            nextUserId = nextUser.id;
            nextUserRole = nextUser.role;
          } else {
            nextUserRole = nextRole;
            nextUserId = null;
          }
        }
        incrementMin = escalationTimeoutMin;
        nextEscalationAt = new Date(Date.now() + incrementMin * 60 * 1000);
      } else {
        nextUserRole = UserRole.COMPANY_ADMIN;
        nextUserId = null;
        incrementMin = escalationTimeoutMin;
        nextEscalationAt = new Date(Date.now() + incrementMin * 60 * 1000);
      }
    } else {
      const escalationRules = await this.prisma.escalationRule.findMany({
        where: {
          companyId: alert.companyId,
          severity: alert.severity,
          isActive: true,
        },
        orderBy: { escalateAfterDays: 'asc' },
      });

      if (escalationRules.length > 0) {
        const ruleIndex = Math.min(alert.escalationStep, escalationRules.length - 1);
        const rule = escalationRules[ruleIndex];
        nextUserRole = rule.escalateToRole;
        nextUserId = null;
        incrementMin = rule.escalateAfterDays * 24 * 60;
        nextEscalationAt = new Date(Date.now() + incrementMin * 60 * 1000);
      } else {
        const overrideRule = await this.prisma.escalationRule.findFirst({
          where: {
            companyId: alert.companyId,
            severity: alert.severity,
            escalateToRole: nextRole,
            isActive: true,
          },
        });

        if (overrideRule) {
          incrementMin = overrideRule.escalateAfterDays * 24 * 60;
        }
        nextEscalationAt = new Date(Date.now() + incrementMin * 60 * 1000);

        if (alert.assignedToUserId) {
          let candidateUsers = await this.prisma.user.findMany({
            where: {
              companyId: alert.companyId,
              isActive: true,
              role: nextRole,
            },
            orderBy: { id: 'asc' },
          });

          if (candidateUsers.length === 0) {
            candidateUsers = await this.prisma.user.findMany({
              where: {
                companyId: alert.companyId,
                isActive: true,
                role: { notIn: ['SUPER_ADMIN', 'COMPANY_ADMIN'] },
              },
              orderBy: { id: 'asc' },
            });
          }

          if (candidateUsers.length > 0) {
            const currentIndex = candidateUsers.findIndex((u) => u.id === alert.assignedToUserId);
            const nextUser = candidateUsers[(currentIndex + 1) % candidateUsers.length];
            nextUserId = nextUser.id;
            nextUserRole = nextUser.role;
          }
        }
      }
    }

    let prevUserName = alert.assignedToUserId || 'N/A';
    let nextUserName = nextUserId || 'N/A';

    if (alert.assignedToUserId) {
      const u = await this.prisma.user.findUnique({
        where: { id: alert.assignedToUserId },
        select: { name: true },
      });
      if (u) prevUserName = u.name;
    }

    if (nextUserId) {
      const u = await this.prisma.user.findUnique({
        where: { id: nextUserId },
        select: { name: true },
      });
      if (u) nextUserName = u.name;
    }

    await this.prisma.$transaction(async (tx) => {
      // Update Alert Step
      await tx.alert.update({
        where: { id: alert.id },
        data: {
          assignedToRole: nextUserRole,
          assignedToUserId: nextUserId,
          escalationStep: nextStep,
          nextEscalationAt,
        },
      });

      // Deactivate current active assignments
      await tx.alertAssignment.updateMany({
        where: { alertId: alert.id, status: 'OPEN' },
        data: { status: 'ESCALATED' },
      });

      // Create new active assignment
      if (nextUserId) {
        await tx.alertAssignment.create({
          data: {
            alertId: alert.id,
            severity: alert.severity,
            assignedToId: nextUserId,
            assignedAt: new Date(),
            notifiedAt: new Date(),
            seenAt: null,
            reminderCount: 0,
            escalationLevel: nextStep,
            status: 'OPEN',
          },
        });
      }

      // Record in Escalation History
      await tx.escalationHistory.create({
        data: {
          alertId: alert.id,
          steppedFromRole: currentRole,
          steppedToRole: nextUserRole,
          notes: `Escalated due to response SLA timeout (${incrementMin} mins).`,
        },
      });

      // Log in audit timeline
      const details = nextUserId
        ? `SYSTEM REASSIGNMENT: User ${prevUserName} did not take over the alert. Reassigned to next user: ${nextUserName} (${nextUserRole}).`
        : `SYSTEM ESCALATION: Overdue. Escalated assignment from role ${currentRole} to role ${nextUserRole}.`;
      await tx.defectResolutionTimeline.create({
        data: {
          alertId: alert.id,
          actionType: 'ESCALATED',
          details,
        },
      });
    });

    // Notify Real-Time room dashboard (targeted)
    this.realtime.broadcastAlert(alert.companyId, 'ALERT_ESCALATED', {
      alertId: alert.id,
      steppedFromRole: currentRole,
      steppedToRole: nextUserRole,
      assignedToUserId: nextUserId,
      assignedToRole: nextUserRole,
    });

    this.realtime.broadcastAlert(alert.companyId, 'ALERT_ASSIGNED', {
      alertId: alert.id,
      assignedToUserId: nextUserId,
      assignedToRole: nextUserRole,
      prevAssignedToUserId: alert.assignedToUserId,
      prevAssignedToRole: alert.assignedToRole,
      title: `Alert Escalated: ${alert.defect?.name || 'Alert'}`,
      message: `Overdue alert for VIN ${alert.vin || 'N/A'} has been escalated/reassigned.`,
    });

    // Determine user IDs to notify
    let notifyUserIds: string[] = [];
    if (nextUserId) {
      notifyUserIds.push(nextUserId);
    } else {
      const targetMembers = await this.prisma.user.findMany({
        where: { companyId: alert.companyId, role: nextUserRole, isActive: true },
      });
      notifyUserIds = targetMembers.map((m) => m.id);
    }

    // Enqueue notifications for target members
    for (const userId of notifyUserIds) {
      await this.notifications.enqueueNotification({
        companyId: alert.companyId,
        userId,
        alertId: alert.id,
        title: `ESCALATED ALERT: ${alert.defect?.name || 'Alert'}`,
        message: `Overdue alert for VIN ${alert.vin || 'N/A'} escalated to you (${nextUserRole}).`,
        channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
      });
    }

    // Send warning notification to all admins in the company
    const admins = await this.prisma.user.findMany({
      where: {
        companyId: alert.companyId,
        isActive: true,
        role: { in: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
      },
    });

    const assigneeDesc = nextUserId ? `User ID ${nextUserId}` : `role ${nextUserRole}`;
    for (const admin of admins) {
      await this.notifications.enqueueNotification({
        companyId: alert.companyId,
        userId: admin.id,
        alertId: alert.id,
        title: `ADMIN WARNING: Unresolved Alert Escalated`,
        message: `Alert for VIN ${alert.vin || 'N/A'} was not taken over by the assignee and has been escalated to ${assigneeDesc}.`,
        channels: [NotificationChannel.PUSH, NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      });
    }
  }
}
