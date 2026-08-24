import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertStatus, UserRole, Severity, NotificationChannel } from '@prisma/client';

@Injectable()
export class EscalationService implements OnModuleInit {
  private readonly logger = new Logger(EscalationService.name);
  private isProcessing = false;
  private processingAlertIds = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // Run the check every 1 second (1000ms interval) for immediate escalation
    setInterval(async () => {
      try {
        await this.processEscalations();
      } catch (err) {
        this.logger.error('Error running periodic escalations:', err);
      }
    }, 1000);
  }

  /**
   * Periodically check for overdue alerts and trigger escalation workflows.
   * Can be invoked by a cron scheduler task in main app module.
   */
  async processEscalations() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    try {
      const now = new Date();

      // Query active alerts requiring immediate escalation (excluding RESOLVED and BREACHED)
      const overdueAlerts = await this.prisma.alert.findMany({
        where: {
          status: { in: [AlertStatus.OPEN, AlertStatus.REOPENED] },
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
        if (this.processingAlertIds.has(alert.id)) {
          continue;
        }
        this.processingAlertIds.add(alert.id);
        try {
          await this.escalateAlert(alert);
        } catch (err) {
          this.logger.error(`Failed to escalate alert ${alert.id}:`, err.stack);
        } finally {
          this.processingAlertIds.delete(alert.id);
        }
      }
    } finally {
      this.isProcessing = false;
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

    // Upward severity-based tier escalation hierarchy (used as standard fallback reference)
    if (currentRole === UserRole.WORKER || currentRole === UserRole.QUALITY_INSPECTOR || currentRole === UserRole.SERVICE_ENGINEER) {
      nextRole = UserRole.SUPERVISOR;
    } else if (currentRole === UserRole.SUPERVISOR) {
      nextRole = UserRole.COMPANY_ADMIN;
    } else {
      nextRole = UserRole.SUPER_ADMIN;
    }

    // Apply database-configured overrides if present
    const overrideRule = await this.prisma.escalationRule.findFirst({
      where: {
        companyId: alert.companyId,
        severity: alert.severity,
        isActive: true,
      },
    });

    if (overrideRule) {
      incrementMin = overrideRule.escalateAfterDays * 24 * 60;
    }

    let nextEscalationAt = new Date(Date.now() + incrementMin * 60 * 1000);

    let nextUserId: string | null = null;
    let nextUserRole: UserRole | null = null;

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

    let isBreached = false;
    let breachedReason = '';

    if (definitionChain.length > 0) {
      const nextChainIndex = alert.escalationStep;
      
      if (nextChainIndex < definitionChain.length) {
        const nextTarget = definitionChain[nextChainIndex];
        let resolved = false;
        
        if (nextTarget.startsWith('ROLE:') || nextTarget.startsWith('role_')) {
          const prefixLen = nextTarget.startsWith('ROLE:') ? 5 : 5;
          const targetRoleStr = nextTarget.substring(prefixLen).toUpperCase();
          if (Object.values(UserRole).includes(targetRoleStr as any)) {
            nextUserRole = targetRoleStr as UserRole;
            nextUserId = null;
            resolved = true;
          }
        } else if (Object.values(UserRole).includes(nextTarget.toUpperCase() as any)) {
          nextUserRole = nextTarget.toUpperCase() as UserRole;
          nextUserId = null;
          resolved = true;
        } else {
          const nextUser = await this.prisma.user.findUnique({
            where: { id: nextTarget },
          });
          if (nextUser) {
            nextUserId = nextUser.id;
            nextUserRole = nextUser.role;
            resolved = true;
          }
        }

        if (resolved) {
          incrementMin = escalationTimeoutMin;
          nextEscalationAt = new Date(Date.now() + incrementMin * 60 * 1000);
        } else {
          isBreached = true;
          breachedReason = `SYSTEM BREACH: Escalation target could not be resolved: ${nextTarget}`;
        }
      } else {
        isBreached = true;
        breachedReason = 'SYSTEM BREACH: Reached end of custom escalation chain.';
      }
    } else {
      // Use DefaultSeverityChain (EscalationRule table)
      const escalationRules = await this.prisma.escalationRule.findMany({
        where: {
          companyId: alert.companyId,
          severity: alert.severity,
          isActive: true,
        },
        orderBy: { escalateAfterDays: 'asc' },
      });

      if (escalationRules.length > 0) {
        const ruleIndex = alert.escalationStep;
        if (ruleIndex < escalationRules.length) {
          const rule = escalationRules[ruleIndex];
          nextUserRole = rule.escalateToRole;
          nextUserId = null;
          incrementMin = rule.escalateAfterDays * 24 * 60;
          nextEscalationAt = new Date(Date.now() + incrementMin * 60 * 1000);
        } else {
          isBreached = true;
          breachedReason = 'SYSTEM BREACH: Reached end of default severity escalation chain.';
        }
      } else {
        // No default severity chain configured at all!
        isBreached = true;
        breachedReason = 'SYSTEM BREACH: No DefaultSeverityChain configured for this severity.';
      }
    }

    // Ensure escalation climbs to the next role tier to prevent infinite loop or staying in the same role (only if not using custom escalation chain)
    if (!isBreached && definitionChain.length === 0 && nextUserRole === currentRole) {
      if (currentRole === UserRole.WORKER || currentRole === UserRole.QUALITY_INSPECTOR || currentRole === UserRole.SERVICE_ENGINEER) {
        nextUserRole = UserRole.SUPERVISOR;
      } else if (currentRole === UserRole.SUPERVISOR) {
        nextUserRole = UserRole.COMPANY_ADMIN;
      } else {
        nextUserRole = UserRole.SUPER_ADMIN;
      }
      nextUserId = null; // Clear nextUserId so it assigns to the new role generally first
    }

    let candidateUsers: any[] = [];

    if (!isBreached) {
      // Query active candidate users of the resolved target escalation role
      candidateUsers = await this.prisma.user.findMany({
        where: {
          companyId: alert.companyId,
          isActive: true,
          role: nextUserRole as UserRole,
        },
        orderBy: { id: 'asc' },
      });
      nextUserId = null;
    }

    let prevUserName = alert.assignedToUserId || 'N/A';

    if (alert.assignedToUserId) {
      const u = await this.prisma.user.findUnique({
        where: { id: alert.assignedToUserId },
        select: { name: true },
      });
      if (u) prevUserName = u.name;
    }

    await this.prisma.$transaction(async (tx) => {
      // Verify that the alert has not been resolved in the meantime
      const dbAlert = await tx.alert.findUnique({
        where: { id: alert.id },
        select: { status: true },
      });
      if (!dbAlert || dbAlert.status === AlertStatus.RESOLVED) {
        return;
      }

      if (isBreached) {
        await tx.alert.update({
          where: { id: alert.id },
          data: {
            status: AlertStatus.BREACHED,
            nextEscalationAt: null, // Cancel all further timings
          },
        });

        await tx.alertAssignment.updateMany({
          where: { alertId: alert.id, status: 'OPEN' },
          data: { status: 'ESCALATED' },
        });

        await tx.defectResolutionTimeline.create({
          data: {
            alertId: alert.id,
            actionType: 'BREACHED',
            details: breachedReason,
          },
        });

        return;
      }

      // Update Alert Step
      await tx.alert.update({
        where: { id: alert.id },
        data: {
          assignedToRole: nextUserRole as UserRole,
          assignedToUserId: null, // Assign generally to the role tier, not a single user
          escalationStep: nextStep,
          nextEscalationAt,
        },
      });

      // Deactivate current active assignments
      await tx.alertAssignment.updateMany({
        where: { alertId: alert.id, status: 'OPEN' },
        data: { status: 'ESCALATED' },
      });

      // Create new active assignment for all candidate users of the next role
      for (const u of candidateUsers) {
        await tx.alertAssignment.create({
          data: {
            alertId: alert.id,
            severity: alert.severity,
            assignedToId: u.id,
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
          steppedToRole: nextUserRole as UserRole,
          notes: `Escalated due to response SLA timeout (${incrementMin} mins).`,
        },
      });

      // Log in audit timeline
      const details = `SYSTEM ESCALATION: Overdue. Escalated assignment from role ${currentRole} to role ${nextUserRole}. Assigned to all users of this role.`;
      await tx.defectResolutionTimeline.create({
        data: {
          alertId: alert.id,
          actionType: 'ESCALATED',
          details,
        },
      });
    });

    if (isBreached) {
      this.realtime.broadcastAlert(alert.companyId, 'ALERT_UPDATED', {
        id: alert.id,
        vin: alert.vin,
        defectName: alert.defectName,
        severity: alert.severity,
        status: AlertStatus.BREACHED,
        assignedToUserId: alert.assignedToUserId,
        assignedToRole: alert.assignedToRole,
        soundProfile: alert.defect?.soundProfile || 'CRITICAL',
        createdAt: alert.createdAt,
      });
      return;
    }

    // Notify Real-Time room dashboard (targeted)
    this.realtime.broadcastAlert(alert.companyId, 'ALERT_ESCALATED', {
      alertId: alert.id,
      steppedFromRole: currentRole,
      steppedToRole: nextUserRole as UserRole,
      assignedToUserId: null,
      assignedToRole: nextUserRole as UserRole,
      prevAssignedToUserId: alert.assignedToUserId,
      prevAssignedToRole: alert.assignedToRole,
    });

    this.realtime.broadcastAlert(alert.companyId, 'ALERT_ASSIGNED', {
      alertId: alert.id,
      assignedToUserId: null,
      assignedToRole: nextUserRole as UserRole,
      prevAssignedToUserId: alert.assignedToUserId,
      prevAssignedToRole: alert.assignedToRole,
      isEscalation: true,
      defectName: alert.defect?.name || alert.defectName || 'Alert',
      title: `Alert Escalated: ${alert.defect?.name || 'Alert'}`,
      message: `Overdue alert for VIN ${alert.vin || 'N/A'} has been escalated/reassigned to role ${nextUserRole}.`,
    });

    // Notify previous assignee or previous role users (with the requirement 3 message)
    (async () => {
      try {
        let prevUsers: any[] = [];
        if (alert.assignedToUserId) {
          const u = await this.prisma.user.findUnique({
            where: { id: alert.assignedToUserId, isActive: true },
          });
          if (u) prevUsers.push(u);
        } else if (currentRole) {
          prevUsers = await this.prisma.user.findMany({
            where: {
              role: currentRole as any,
              companyId: alert.companyId,
              isActive: true,
            },
          });
        }

        const prevRoleStr = currentRole || 'specific';
        const nextRoleStr = nextUserRole || 'specific';
        const title = `Alert Escalated: ${alert.defect?.name || alert.defectName || 'Alert'}`;
        const message = nextUserRole
          ? `this alert is not taken over the ${prevRoleStr} role so the alert escalate to next ${nextRoleStr} role in the chain.`
          : `this alert is not taken over the ${prevRoleStr} role so the alert escalate to whatever next role in the chain.`;

        for (const u of prevUsers) {
          await this.notifications.enqueueNotification({
            companyId: alert.companyId,
            userId: u.id,
            alertId: alert.id,
            title,
            message,
            channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
          });
        }
      } catch (err) {
        this.logger.error('[Escalation Notification] Failed to notify previous users:', err);
      }
    })();

    // Determine user IDs to notify (notify all active users of the nextUserRole)
    const notifyUserIds = candidateUsers.map((m) => m.id);

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
  }
}
