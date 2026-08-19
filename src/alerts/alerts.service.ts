import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { Severity, AlertStatus, UserRole, NotificationChannel } from '@prisma/client';

@Injectable()
export class AlertsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private notifications: NotificationsService,
  ) {}

  /**
   * External Event Ingest (REST Webhook ingestion layer)
   */
    async ingestEvent(payload: {
    source: string;
    event_type: string;
    companyId: string;
    vin?: string;
    defectName?: string;
    alertDefinitionId?: string;
    alertId?: string;
    assignedToUserId?: string;
    assignedToRole?: UserRole;
    severity?: Severity;
    title?: string;
    message?: string;
    loopCompleted?: boolean;
    targetUserIds?: string[];
    targetRoles?: string[];
  }) {
    console.log('[DEBUG Ingest] Incoming Payload:', payload);
    // 1. Validate company exists
    const company = await this.prisma.company.findUnique({
      where: { id: payload.companyId },
    });
    if (!company) {
      throw new NotFoundException('Company tenant not found');
    }

    // Handle Broadcast event type
    if (payload.event_type === 'BROADCAST') {
      const orConditions: any[] = [];
      if (payload.targetUserIds && payload.targetUserIds.length > 0) {
        orConditions.push({ id: { in: payload.targetUserIds } });
      }
      if (payload.targetRoles && payload.targetRoles.length > 0) {
        orConditions.push({ role: { in: payload.targetRoles } });
      }

      const activeUsers = await this.prisma.user.findMany({
        where: {
          isActive: true,
          ...(payload.companyId && payload.companyId !== 'all' ? { companyId: payload.companyId } : {}),
          ...(orConditions.length > 0 ? { OR: orConditions } : {}),
        },
      });

      const broadcastId = `BROADCAST_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      this.realtime.broadcastToCompany(payload.companyId, 'BROADCAST_CREATED', {
        broadcastId,
        title: payload.title || 'Company Broadcast',
        message: payload.message || '',
        targetUserIds: payload.targetUserIds || null,
        targetRoles: payload.targetRoles || null,
      });

      (async () => {
        try {
          const crypto = require('crypto');
          await Promise.all(
            activeUsers.map(async (u) => {
              const userBroadcastId = `${broadcastId}_${u.id}`;
              await this.notifications.enqueueNotification({
                companyId: payload.companyId && payload.companyId !== 'all' ? payload.companyId : u.companyId,
                userId: u.id,
                alertId: userBroadcastId,
                title: payload.title || 'Company Broadcast',
                message: payload.message || '',
                channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
              });

              await this.prisma.alertNotificationLog.create({
                data: {
                  id: crypto.randomUUID(),
                  alertId: userBroadcastId,
                  userId: u.id,
                  type: 'BROADCAST',
                  message: payload.message || '',
                },
              });
            })
          );
        } catch (err) {
          console.error('[Broadcast Webhook] Failed to enqueue notifications:', err);
        }
      })();

      return { success: true };
    }

    // Handle Escalation event type
    if (payload.event_type === 'ESCALATION') {
      const alert = await this.prisma.alert.findUnique({
        where: { id: payload.alertId },
        include: { defect: true }
      });
      if (!alert) {
        throw new NotFoundException('Alert not found for escalation');
      }

      const targetUserId = payload.assignedToUserId;
      const targetRole = payload.assignedToRole;
      let targetUsers: any[] = [];
      if (payload.loopCompleted) {
        // Loop completed, notify only company/super admins
        targetUsers = await this.prisma.user.findMany({
          where: {
            companyId: payload.companyId,
            isActive: true,
            role: { in: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
          },
        });
      } else if (targetRole) {
        targetUsers = await this.prisma.user.findMany({
          where: { companyId: payload.companyId, role: targetRole as any, isActive: true }
        });
      } else if (targetUserId) {
        const u = await this.prisma.user.findUnique({ where: { id: targetUserId } });
        if (u) targetUsers.push(u);
      }

      // Trigger Real-time Socket.IO Broadcast to company dashboard so stats update (targeted)
      this.realtime.broadcastAlert(payload.companyId, 'ALERT_UPDATED', {
        id: alert.id,
        vin: alert.vin,
        defectName: alert.defectName,
        severity: alert.severity,
        status: alert.status,
        assignedToUserId: targetUserId || null,
        assignedToRole: targetRole || (targetUsers[0]?.role || null),
        soundProfile: alert.defect?.soundProfile || 'CRITICAL',
        createdAt: alert.createdAt,
      });

      // Enqueue Push Notifications for the targeted assignees
      (async () => {
        try {
          const crypto = require('crypto');
          for (const user of targetUsers) {
            const isYou = user.id === targetUserId;
            await this.notifications.enqueueNotification({
              companyId: payload.companyId,
              userId: user.id,
              alertId: alert.id,
              title: payload.loopCompleted ? `SLA FALLBACK ALERT: ${alert.defectName}` : `ESCALATED ALERT: ${alert.defectName}`,
              message: payload.message || `Alert escalated to ${isYou ? 'you' : (targetRole ? `role ${targetRole}` : user.name)}.`,
              channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
            });

            await this.prisma.alertNotificationLog.create({
              data: {
                id: crypto.randomUUID(),
                alertId: alert.id,
                userId: user.id,
                type: 'ESCALATION',
                message: payload.message || `Alert escalated to ${isYou ? 'you' : (targetRole ? `role ${targetRole}` : user.name)}.`,
              },
            });
          }
        } catch (err) {
          console.error('[Escalation Webhook] Failed to enqueue notifications:', err);
        }
      })();

      return { success: true };
    }

    // Handle Reminder event type
    if (payload.event_type === 'REMINDER') {
      const alert = await this.prisma.alert.findUnique({
        where: { id: payload.alertId },
        include: { defect: true }
      });
      if (!alert) {
        throw new NotFoundException('Alert not found for reminder');
      }

      const targetUserId = payload.assignedToUserId;
      if (targetUserId) {
        const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
        if (user) {
          (async () => {
            try {
              const crypto = require('crypto');
              await this.notifications.enqueueNotification({
                companyId: payload.companyId,
                userId: user.id,
                alertId: alert.id,
                title: `REMINDER ALERT: ${alert.defectName}`,
                message: payload.message || `Reminder: Alert '${alert.defectName}' is still pending your response.`,
                channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
              });

              await this.prisma.alertNotificationLog.create({
                data: {
                  id: crypto.randomUUID(),
                  alertId: alert.id,
                  userId: user.id,
                  type: 'REMINDER',
                  message: payload.message || `Reminder: Alert '${alert.defectName}' is still pending your response.`,
                },
              });
            } catch (err) {
              console.error('[Reminder Webhook] Failed to enqueue notifications:', err);
            }
          })();
        }
      }

      return { success: true };
    }

    if (!payload.defectName && payload.event_type !== 'BROADCAST') {
      throw new BadRequestException('defectName is required for standard alert events');
    }

    // 2. Fetch or create Defect Master mapping details to map severity/assignees
    let defect = await this.prisma.defectMaster.findFirst({
      where: { companyId: payload.companyId, name: payload.defectName, active: true },
    });

    const finalSeverity = payload.severity || (defect ? defect.severity : 'MEDIUM');

    if (!defect) {
      // Auto-create defect master mapping if it does not exist
      const crypto = require('crypto');
      const newDefectId = crypto.randomUUID();
      let soundProfileVal = 'MEDIUM';
      if (finalSeverity === 'CRITICAL' || finalSeverity === 'EMERGENCY') {
        soundProfileVal = 'CRITICAL';
      } else if (finalSeverity === 'HIGH') {
        soundProfileVal = 'ALERT';
      }

      defect = await this.prisma.defectMaster.create({
        data: {
          id: newDefectId,
          name: payload.defectName,
          category: 'Manual Dispatch',
          severity: finalSeverity,
          defaultAssigneeRole: payload.assignedToRole || 'WORKER',
          ownerVisible: true,
          soundProfile: soundProfileVal,
          active: true,
          companyId: payload.companyId,
        },
      });
    }

    // Calculate next escalation date based on severity rules
    let nextEscalationAt = this.calculateNextEscalation(finalSeverity);

    // Determine active sound profile based on severity override
    let activeSoundProfile = defect.soundProfile;
    if (payload.severity) {
      if (payload.severity === 'CRITICAL' || payload.severity === 'EMERGENCY') {
        activeSoundProfile = 'CRITICAL';
      } else if (payload.severity === 'HIGH') {
        activeSoundProfile = 'ALERT';
      } else {
        activeSoundProfile = 'MEDIUM';
      }
    }

    // Resolve Alert Definition details if provided
    let criticalOverride = false;
    let alertDefinition = null;
    if (payload.alertDefinitionId) {
      const def = await this.prisma.alertDefinition.findUnique({
        where: { id: payload.alertDefinitionId },
      });
      if (def) {
        alertDefinition = def;
        criticalOverride = def.criticalOverride;
        if (def.escalationTimeout) {
          nextEscalationAt = new Date(Date.now() + def.escalationTimeout * 60 * 1000);
        }
      }
    }

    // Check for duplicate alert (same company, vin, and defectName that is still active/unresolved)
    const duplicateAlert = await this.prisma.alert.findFirst({
      where: {
        companyId: payload.companyId,
        vin: payload.vin || null,
        defectName: payload.defectName,
        status: { in: [AlertStatus.OPEN, AlertStatus.REOPENED, AlertStatus.IN_PROGRESS] },
      },
      include: { defect: true },
    });

    if (duplicateAlert) {
      console.log(`[DEBUG Ingest] Duplicate alert found (ID: ${duplicateAlert.id}). Skipping creation.`);
      return duplicateAlert;
    }

    // 3. Check if alert already exists, or create it, timeline and auto assignment
    let alert = null;
    if (payload.alertId) {
      alert = await this.prisma.alert.findUnique({
        where: { id: payload.alertId },
        include: { defect: true },
      });
    }

    if (!alert) {
      let targetRole = null;
      let targetUserId = null;
      let targetName = 'Default';

      // Resolve assignee from alert definition template if provided
      if (payload.alertDefinitionId && alertDefinition) {
        const primaryId = alertDefinition.primaryAssigneeId;
        if (primaryId) {
          if (primaryId.startsWith('ROLE:')) {
            targetRole = primaryId.substring(5).toUpperCase();
            targetUserId = null;
          } else {
            const targetUser = await this.prisma.user.findUnique({
              where: { id: primaryId },
              select: { id: true, role: true, name: true, companyId: true },
            });
            if (targetUser && targetUser.companyId === payload.companyId) {
              targetUserId = targetUser.id;
              targetRole = targetUser.role;
              targetName = targetUser.name;
            }
          }
        }
      }

      // If not resolved from definition template, fall back to standard payload request fields
      if (!targetUserId && !targetRole) {
        if (payload.assignedToUserId) {
          const targetUser = await this.prisma.user.findUnique({
            where: { id: payload.assignedToUserId },
            select: { id: true, role: true, name: true, companyId: true },
          });
          if (targetUser && targetUser.companyId === payload.companyId) {
            targetUserId = targetUser.id;
            targetRole = targetUser.role;
            targetName = targetUser.name;
          }
        }
        if (!targetUserId && payload.assignedToRole) {
          targetRole = payload.assignedToRole;
        }
        if (!targetRole && !targetUserId) {
          targetRole = defect.defaultAssigneeRole;
        }
      }

      if (targetRole && !targetUserId && targetName === 'Default') {
        targetName = targetRole;
      }

      alert = await this.prisma.$transaction(async (tx) => {
        const newAlert = await tx.alert.create({
          data: {
            id: payload.alertId || undefined,
            vin: payload.vin || null,
            companyId: payload.companyId,
            defectId: defect.id,
            defectName: payload.defectName,
            alertDefinitionId: payload.alertDefinitionId || null,
            severity: finalSeverity,
            status: AlertStatus.OPEN,
            assignedToUserId: targetUserId,
            assignedToRole: targetRole as any,
            nextEscalationAt,
            isManual: payload.source === 'admin-portal',
          },
          include: { defect: true },
        });

        // Create initial active AlertAssignment record
        if (newAlert.assignedToUserId) {
          await tx.alertAssignment.create({
            data: {
              alertId: newAlert.id,
              severity: finalSeverity,
              assignedToId: newAlert.assignedToUserId,
              assignedAt: new Date(),
              notifiedAt: new Date(),
              seenAt: null,
              reminderCount: 0,
              escalationLevel: 0,
              status: 'OPEN',
            },
          });
        }

        // Log creation to defect audit timeline
        await tx.defectResolutionTimeline.create({
          data: {
            alertId: newAlert.id,
            actionType: 'CREATED',
            performedByRole: UserRole.QUALITY_INSPECTOR,
            details: `Defect created by source system: [${payload.source}]. Routed to assignee: ${targetName}.${payload.message ? ' Notes: ' + payload.message : ''}`,
          },
        });

        return newAlert;
      });
    }

    // 4. Trigger Real-time Socket.IO Broadcast to company dashboard (targeted)
    this.realtime.broadcastAlert(payload.companyId, 'ALERT_CREATED', {
      id: alert.id,
      vin: alert.vin,
      defectName: defect.name,
      severity: alert.severity,
      status: alert.status,
      assignedToUserId: alert.assignedToUserId,
      assignedToRole: alert.assignedToRole,
      soundProfile: activeSoundProfile,
      createdAt: alert.createdAt,
      definition: alertDefinition?.definition || null,
      alertDefinition: alertDefinition || null,
    });

    // 5. Run enqueuing and notification queries asynchronously in the background
    const finalAlert = alert;
    const finalDefect = defect;
    const finalAlertDefinition = alertDefinition;
    (async () => {
      try {
        // Resolve assignee name for clearer notifications
        let assigneeName: string = finalAlert.assignedToRole || finalDefect.defaultAssigneeRole;
        if (finalAlert.assignedToUserId) {
          const assignedUser = await this.prisma.user.findUnique({
            where: { id: finalAlert.assignedToUserId },
          });
          if (assignedUser) {
            assigneeName = assignedUser.name;
          }
        }

        // Determine target users to notify (notify target assignee/role only to isolate alerts)
        let targetUsers: any[] = [];
        if (finalAlert.assignedToUserId) {
          targetUsers = await this.prisma.user.findMany({
            where: {
              id: finalAlert.assignedToUserId,
              companyId: payload.companyId,
              isActive: true,
            },
          });
        } else if (finalAlert.assignedToRole) {
          targetUsers = await this.prisma.user.findMany({
            where: {
              role: finalAlert.assignedToRole as any,
              companyId: payload.companyId,
              isActive: true,
            },
          });
        }

        const crypto = require('crypto');
        await Promise.all(
          targetUsers.map(async (user) => {
            const isYou = user.id === finalAlert.assignedToUserId;
            let messageText = payload.message || `New defect '${finalDefect.name}' is assigned to ${isYou ? 'you' : assigneeName}.`;
            if (finalAlertDefinition?.definition) {
              messageText += `\nGuidelines: ${finalAlertDefinition.definition}`;
            }

            await this.notifications.enqueueNotification({
              companyId: payload.companyId,
              userId: user.id,
              alertId: finalAlert.id,
              title: `${finalSeverity} ALERT: ${finalDefect.name}`,
              message: messageText,
              channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
            });

            await this.prisma.alertNotificationLog.create({
              data: {
                id: crypto.randomUUID(),
                alertId: finalAlert.id,
                userId: user.id,
                type: 'NOTIFICATION',
                message: messageText,
              },
            });
          })
        );
      } catch (err) {
        console.error('[Ingest Sync] Background notification enqueuing failed:', err);
      }
    })();

    return alert;
  }

  /**
   * Assign or Reassign Alerts to target roles/users
   */
  async assignAlert(
    companyId: string,
    alertId: string,
    performedByUserId: string,
    data: {
      assignedToUserId?: string;
      assignedToRole?: UserRole;
      assignedToDepartment?: string;
      assignedToTeam?: string;
      notes?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: performedByUserId } });
    if (!user) throw new NotFoundException('User profile not found');

    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId, companyId },
      include: {
        defect: true,
        assignedToUser: {
          select: { id: true, name: true, role: true },
        },
      },
    });
    if (!alert) throw new NotFoundException('Alert not found');

    const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'COMPANY_ADMIN';
    let targetUser = null;
    if (data.assignedToUserId) {
      targetUser = await this.prisma.user.findUnique({
        where: { id: data.assignedToUserId },
      });
      if (!targetUser || targetUser.companyId !== companyId) {
        throw new NotFoundException('Target user not found in this company');
      }
    }

    let actionType = 'ASSIGNED';
    let detailsText = '';

    if (isAdmin) {
      // Cross-role manual reassignment override from VAMS Admin Dashboard
      actionType = 'REASSIGNED_MANUAL_ADMIN';
      const targetDesc = targetUser ? `${targetUser.name} (${targetUser.role})` : `role ${data.assignedToRole}`;
      detailsText = `MANUAL ADMIN OVERRIDE: Alert reassigned by Admin ${user.name} to ${targetDesc}. Notes: ${data.notes || 'None'}`;
    } else {
      // Same-role peer reassignment (non-admin)
      if (alert.assignedToUserId !== performedByUserId) {
        throw new ForbiddenException('Only the current assignee can reassign this alert');
      }
      if (alert.status !== AlertStatus.IN_PROGRESS) {
        throw new BadRequestException('Alert must be taken over before reassigning');
      }
      if (!targetUser) {
        throw new BadRequestException('Same-role peer reassignment requires a specific target user ID');
      }
      if (targetUser.role !== user.role) {
        throw new BadRequestException('You can only reassign to a peer of the same role');
      }

      actionType = 'REASSIGNED_SAME_ROLE';
      detailsText = `Alert reassigned by peer ${user.name} to ${targetUser.name}. Notes: ${data.notes || 'None'}`;
    }

    let targetUserRole = data.assignedToRole || null;
    let targetUserName = data.assignedToRole ? `Role ${data.assignedToRole}` : 'Dynamic';
    if (targetUser) {
      targetUserRole = targetUser.role;
      targetUserName = targetUser.name;
    }

    const updatedAlert = await this.prisma.$transaction(async (tx) => {
      let nextEscalationAt = null;
      if (!data.assignedToUserId && targetUserRole) {
        nextEscalationAt = this.calculateNextEscalation(alert.severity);
        if (alert.alertDefinitionId) {
          const def = await tx.alertDefinition.findUnique({
            where: { id: alert.alertDefinitionId },
          });
          if (def && def.escalationTimeout) {
            nextEscalationAt = new Date(Date.now() + def.escalationTimeout * 60 * 1000);
          }
        }
      }

      const nextStatus = isAdmin
        ? (data.assignedToUserId ? AlertStatus.IN_PROGRESS : AlertStatus.OPEN)
        : AlertStatus.IN_PROGRESS;

      const updated = await tx.alert.update({
        where: { id: alertId },
        data: {
          assignedToUserId: data.assignedToUserId || null,
          assignedToRole: targetUserRole,
          assignedToDepartment: data.assignedToDepartment || null,
          assignedToTeam: data.assignedToTeam || null,
          status: nextStatus,
          escalationStep: 0,
          nextEscalationAt,
        },
        include: {
          assignedToUser: {
            select: { id: true, name: true, role: true },
          },
        },
      });

      // Deactivate current active assignments
      await tx.alertAssignment.updateMany({
        where: { alertId, status: 'OPEN' },
        data: { status: 'SUPERSEDED' },
      });

      // Create new active assignment if assignedToUserId is defined
      if (data.assignedToUserId) {
        let nextEscalationLevel = 0;
        if (alert.alertDefinitionId) {
          const def = await tx.alertDefinition.findUnique({
            where: { id: alert.alertDefinitionId },
          });
          if (def) {
            const chainIndex = def.escalationChain.indexOf(data.assignedToUserId);
            if (chainIndex !== -1) {
              nextEscalationLevel = chainIndex + 1;
            }
          }
        }

        await tx.alertAssignment.create({
          data: {
            alertId,
            severity: alert.severity,
            assignedToId: data.assignedToUserId,
            assignedAt: new Date(),
            notifiedAt: new Date(),
            seenAt: null,
            reminderCount: 0,
            escalationLevel: nextEscalationLevel,
            status: 'OPEN',
          },
        });
      }

      // Assignment history audit log
      await tx.alertAssignmentHistory.create({
        data: {
          alertId,
          assignedByUserId: performedByUserId,
          assignedToUserId: data.assignedToUserId,
          assignedToRole: targetUserRole,
          assignedToDepartment: data.assignedToDepartment,
          assignedToTeam: data.assignedToTeam,
          notes: data.notes,
        },
      });

      // Defect Lifecycle timeline update
      await tx.defectResolutionTimeline.create({
        data: {
          alertId,
          actionType: actionType as any,
          performedByUserId,
          performedByRole: user.role,
          details: detailsText,
        },
      });

      return updated;
    });

    // Determine the previous assignee description
    let prevAssigneeDesc = 'unassigned';
    if (alert.assignedToUser) {
      prevAssigneeDesc = `${alert.assignedToUser.name} (${alert.assignedToUser.role})`;
    } else if (alert.assignedToRole) {
      prevAssigneeDesc = `role ${alert.assignedToRole}`;
    }

    // Determine the new assignee description
    let newAssigneeDesc = 'unassigned';
    if (updatedAlert.assignedToUser) {
      newAssigneeDesc = `${updatedAlert.assignedToUser.name} (${updatedAlert.assignedToUser.role})`;
    } else if (updatedAlert.assignedToRole) {
      newAssigneeDesc = `role ${updatedAlert.assignedToRole}`;
    }

    let title = 'Defect Task Assignment';
    let message = '';

    // Check if user is taking over the task (handover)
    if (performedByUserId === data.assignedToUserId) {
      title = 'Defect Task Handover';
      message = `${user.name} (${user.role}) has taken over ${prevAssigneeDesc}'s defect task '${alert.defect ? alert.defect.name : 'Alert'}' on VIN ${alert.vin || 'N/A'}.`;
    } else {
      message = `${user.name} (${user.role}) has assigned defect task '${alert.defect ? alert.defect.name : 'Alert'}' (VIN: ${alert.vin || 'N/A'}) to ${newAssigneeDesc}.`;
    }

    // Notify real-time dashboard (targeted)
    this.realtime.broadcastAlert(companyId, 'ALERT_ASSIGNED', {
      alertId,
      assignedToUserId: updatedAlert.assignedToUserId,
      assignedToRole: updatedAlert.assignedToRole,
      prevAssignedToUserId: alert.assignedToUserId,
      prevAssignedToRole: alert.assignedToRole,
      title,
      message,
    });

    // Enqueue notifications for target assignees only
    (async () => {
      try {
        let targetUsers: any[] = [];
        if (updatedAlert.assignedToRole) {
          targetUsers = await this.prisma.user.findMany({
            where: {
              role: updatedAlert.assignedToRole as any,
              companyId,
              isActive: true,
            },
          });
        }

        await Promise.all(
          targetUsers.map((u) =>
            this.notifications.enqueueNotification({
              companyId,
              userId: u.id,
              alertId: alertId,
              title,
              message,
              channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
            }),
          ),
        );
      } catch (err) {
        console.error('[reassignAlert] Error enqueueing notifications:', err);
      }
    })();

    return this.findOneAlert(companyId, alertId);
  }

  /**
   * Resolve Alerts mapping who resolved and storing voice log details
   */
  async resolveAlert(
    companyId: string,
    alertId: string,
    resolvedByUserId: string,
    data: {
      reason: string;
      notes?: string;
      audioPath?: string;
      transcription?: string;
      imageUrls?: string[];
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: resolvedByUserId } });
    if (!user) throw new NotFoundException('User profile not found');

    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId, companyId },
      include: {
        defect: true,
        assignedToUser: {
          select: { id: true, name: true, role: true },
        },
      },
    });
    if (!alert) throw new NotFoundException('Alert not found');

    if (alert.status === AlertStatus.RESOLVED) {
      throw new BadRequestException('Alert is already resolved');
    }

    // Permission check:
    // 1. If alert is taken over (assignedToUserId is not null): only that user (current holder) can resolve it.
    // 2. If alert is not taken over (assignedToUserId is null): any user of the assigned role can resolve it.
    // 3. Admins can resolve it as a manual system override.
    const isHolder = alert.assignedToUserId === resolvedByUserId;
    const isSameRole = alert.assignedToUserId === null && user.role === alert.assignedToRole;
    const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'COMPANY_ADMIN';

    if (!isHolder && !isSameRole && !isAdmin) {
      throw new ForbiddenException('You do not have permission to resolve this alert');
    }

    const resolvedAlert = await this.prisma.$transaction(async (tx) => {
      // 1. Update Alert Status
      const updated = await tx.alert.update({
        where: { id: alertId },
        data: {
          status: AlertStatus.RESOLVED,
          nextEscalationAt: null, // Cancel escalations
        },
      });

      // Update active AlertAssignment status to RESOLVED
      await tx.alertAssignment.updateMany({
        where: { alertId, status: 'OPEN' },
        data: { status: 'RESOLVED' },
      });

      // 2. Clear any existing resolution record first to prevent unique constraint violation
      await tx.resolution.deleteMany({
        where: { alertId },
      });

      // Write Resolution Record
      await tx.resolution.create({
        data: {
          alertId,
          resolvedByUserId,
          reason: data.reason,
          notes: data.notes,
          audioPath: data.audioPath,
          transcription: data.transcription,
          imageUrls: data.imageUrls || [],
        },
      });

      // 3. Log Timeline Audit
      await tx.defectResolutionTimeline.create({
        data: {
          alertId,
          actionType: 'RESOLVED',
          performedByUserId: resolvedByUserId,
          performedByRole: user.role,
          details: `Alert resolved by user: ${user.name} (${user.role}). Reason: ${data.reason}`,
        },
      });

      return updated;
    });

    // Notify real-time dashboards (targeted)
    this.realtime.broadcastAlert(companyId, 'ALERT_RESOLVED', {
      alertId,
      resolvedBy: user.name,
      resolvedByUserId,
      resolvedByRole: user.role,
      reason: data.reason,
      assignedToUserId: resolvedAlert.assignedToUserId,
      assignedToRole: resolvedAlert.assignedToRole,
    });

    // Determine the assignee description
    let assigneeDesc = 'unassigned';
    if (alert.assignedToUser) {
      assigneeDesc = `${alert.assignedToUser.name} (${alert.assignedToUser.role})`;
    } else if (alert.assignedToRole) {
      assigneeDesc = `role ${alert.assignedToRole}`;
    }

    const title = 'Defect Task Resolved';
    const commentSuffix = data.reason ? ` Comment: "${data.reason}"` : '';
    let message = '';
    if (resolvedByUserId === alert.assignedToUserId) {
      message = `${user.name} (${user.role}) has resolved their assigned defect task '${alert.defect ? alert.defect.name : 'Alert'}' on VIN ${alert.vin || 'N/A'}.${commentSuffix}`;
    } else {
      message = `${user.name} (${user.role}) has resolved ${assigneeDesc}'s defect task '${alert.defect ? alert.defect.name : 'Alert'}' on VIN ${alert.vin || 'N/A'}.${commentSuffix}`;
    }

    // Enqueue notifications for target assignees only
    (async () => {
      try {
        let targetUsers: any[] = [];
        if (resolvedAlert.assignedToRole) {
          targetUsers = await this.prisma.user.findMany({
            where: {
              role: resolvedAlert.assignedToRole as any,
              companyId,
              isActive: true,
            },
          });
        }

        await Promise.all(
          targetUsers.map((u) =>
            this.notifications.enqueueNotification({
              companyId,
              userId: u.id,
              alertId: alertId,
              title,
              message,
              channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
            }),
          ),
        );
      } catch (err) {
        console.error('[resolveAlert] Error enqueueing notifications:', err);
      }
    })();

    return this.findOneAlert(companyId, alertId);
  }

  /**
   * Reopen Alerts if defects recur or fails inspector validation
   */
  async reopenAlert(companyId: string, alertId: string, performedByUserId: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: performedByUserId } });
    if (!user) throw new NotFoundException('User profile not found');

    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId, companyId },
      include: { 
        defect: true,
        resolution: true,
      },
    });
    if (!alert) throw new NotFoundException('Alert not found');

    // Permission check:
    // 1. Only the user who resolved the alert, or users of that same role, can reopen it.
    // 2. Admins can reopen as override.
    const isResolver = alert.resolution?.resolvedByUserId === performedByUserId;
    const isSameRole = user.role === alert.assignedToRole;
    const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'COMPANY_ADMIN';

    if (!isResolver && !isSameRole && !isAdmin) {
      throw new ForbiddenException('You do not have permission to reopen this alert');
    }

    const reopenedAlert = await this.prisma.$transaction(async (tx) => {
      let nextEscalationAt = this.calculateNextEscalation(alert.severity);
      if (alert.alertDefinitionId) {
        const def = await tx.alertDefinition.findUnique({
          where: { id: alert.alertDefinitionId },
        });
        if (def && def.escalationTimeout) {
          nextEscalationAt = new Date(Date.now() + def.escalationTimeout * 60 * 1000);
        }
      }

      const updated = await tx.alert.update({
        where: { id: alertId },
        data: {
          status: AlertStatus.REOPENED,
          assignedToUserId: null, // Reset to unclaimed so it becomes shared again!
          nextEscalationAt,
          // Removed: escalationStep: 0 to preserve chain steps!
        },
      });

      // Remove resolution record
      await tx.resolution.deleteMany({
        where: { alertId },
      });

      // Deactivate current active assignments
      await tx.alertAssignment.updateMany({
        where: { alertId, status: 'OPEN' },
        data: { status: 'SUPERSEDED' },
      });

      // Log Timeline
      await tx.defectResolutionTimeline.create({
        data: {
          alertId,
          actionType: 'REOPENED',
          performedByUserId,
          performedByRole: user.role,
          details: `Alert reopened by ${user.name} (${user.role}). Reason: ${reason}`,
        },
      });

      return updated;
    });

    // Broadcast (targeted)
    this.realtime.broadcastAlert(companyId, 'ALERT_REOPENED', {
      alertId,
      reopenedBy: user.name,
      assignedToUserId: reopenedAlert.assignedToUserId,
      assignedToRole: reopenedAlert.assignedToRole,
    });

    // Enqueue notifications for target assignees only
    (async () => {
      try {
        let targetUsers: any[] = [];
        if (reopenedAlert.assignedToRole) {
          targetUsers = await this.prisma.user.findMany({
            where: {
              role: reopenedAlert.assignedToRole as any,
              companyId,
              isActive: true,
            },
          });
        }

        await Promise.all(
          targetUsers.map((u) =>
            this.notifications.enqueueNotification({
              companyId,
              userId: u.id,
              alertId: alertId,
              title: 'Defect Task Reopened',
              message: `${user.name} (${user.role}) has reopened defect task '${alert.defect ? alert.defect.name : 'Alert'}' (VIN: ${alert.vin || 'N/A'}). Reason: ${reason}`,
              channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
            }),
          ),
        );
      } catch (err) {
        console.error('[reopenAlert] Error enqueueing notifications:', err);
      }
    })();

    return this.findOneAlert(companyId, alertId);
  }

  /**
   * Get dynamic telemetry dashboard numbers
   */
  /**
   * Get dynamic telemetry dashboard numbers
   */
  async getDashboardTelemetry(companyId: string, requestingUser?: any, allVisible?: boolean, userAgent?: string) {
    const userRole = requestingUser?.role;
    const userId = requestingUser?.id;

    const baseWhere: any = {
      companyId,
      defect: { active: true },
    };

    const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN';
    const isMobileClient = (userAgent || '').toLowerCase().includes('okhttp');
    const showAll = isAdmin && (allVisible || !isMobileClient);

    if (!showAll && userRole) {
      baseWhere.OR = [
        { assignedToUserId: userId },
        {
          assignedToRole: userRole as any,
          status: { in: [AlertStatus.OPEN, AlertStatus.REOPENED] },
        },
      ];
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [openAlertsCount, criticalAlertsCount, resolvedTodayCount, openAlerts] = await Promise.all([
      this.prisma.alert.count({
        where: {
          ...baseWhere,
          status: { not: AlertStatus.RESOLVED },
        },
      }),
      this.prisma.alert.count({
        where: {
          ...baseWhere,
          status: { not: AlertStatus.RESOLVED },
          severity: { in: [Severity.CRITICAL, Severity.EMERGENCY] },
        },
      }),
      this.prisma.alert.count({
        where: {
          ...baseWhere,
          status: AlertStatus.RESOLVED,
          updatedAt: { gte: todayStart },
        },
      }),
      this.prisma.alert.findMany({
        where: {
          ...baseWhere,
          status: { not: AlertStatus.RESOLVED },
        },
        select: {
          severity: true,
          defect: {
            select: {
              category: true,
            },
          },
        },
      }),
    ]);

    const severityCount = openAlerts.reduce((acc, curr) => {
      acc[curr.severity] = (acc[curr.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const categoryCount = openAlerts.reduce((acc, curr) => {
      const cat = curr.defect?.category || 'General';
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      openAlertsCount,
      criticalAlertsCount,
      resolvedTodayCount,
      alertsBySeverity: severityCount,
      alertsByCategory: categoryCount,
    };
  }

  /**
   * Find all alerts for the company with optional filters
   */
  async findAlerts(
    companyId: string,
    filters: {
      status?: AlertStatus;
      severity?: Severity;
      assignedToUserId?: string;
      assignedToRole?: UserRole;
      allVisible?: boolean;
      userAgent?: string;
    },
    requestingUser?: any,
  ) {
    const userRole = requestingUser?.role;
    const userId = requestingUser?.id;

    const whereClause: any = {
      companyId,
      defect: { active: true },
      ...(filters.status && { status: filters.status }),
      ...(filters.severity && { severity: filters.severity }),
    };

    if (userRole) {
      const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN';
      const isMobileClient = (filters.userAgent || '').toLowerCase().includes('okhttp');
      const showAll = isAdmin && (filters.allVisible || !isMobileClient);
      
      if (showAll) {
        if (filters.assignedToUserId) {
          whereClause.assignedToUserId = filters.assignedToUserId;
        }
        if (filters.assignedToRole) {
          whereClause.assignedToRole = filters.assignedToRole;
        }
      } else {
        whereClause.OR = [
          { assignedToUserId: userId },
          { 
            assignedToRole: userRole as any,
            status: { in: [AlertStatus.OPEN, AlertStatus.REOPENED] },
          },
        ];
      }
    }

    const alerts = await this.prisma.alert.findMany({
      where: whereClause,
      include: {
        defect: true,
        assignedToUser: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        resolution: {
          include: {
            resolvedByUser: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const definitions = await this.prisma.alertDefinition.findMany({
      where: { companyId },
    });
    const defMap = new Map(definitions.map((d) => [d.id, d]));

    return alerts.map((a) => {
      const def = a.alertDefinitionId ? defMap.get(a.alertDefinitionId) : null;
      return {
        ...a,
        definition: def?.definition || null,
        alertDefinition: def || null,
        assignedToUserId: a.assignedToUserId,
        assignedToUserName: a.assignedToUser ? a.assignedToUser.name : null,
      };
    });
  }

  /**
   * Find a single alert detail with relations
   */
  async findOneAlert(companyId: string, alertId: string, userId?: string) {
    const alert = await this.prisma.alert.findFirst({
      where: { id: alertId, companyId },
      include: {
        defect: true,
        assignedToUser: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        resolution: {
          include: {
            resolvedByUser: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
        timeline: {
          include: {
            performedByUser: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        comments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        assignments: {
          include: {
            assignedByUser: {
              select: { id: true, name: true, role: true },
            },
            assignedToUser: {
              select: { id: true, name: true, role: true },
            },
          },
          orderBy: { assignedAt: 'desc' },
        },
      },
    });

    if (!alert) {
      throw new NotFoundException('Alert not found');
    }

    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User profile not found');

      if (user.role !== 'SUPER_ADMIN' && user.role !== 'COMPANY_ADMIN') {
        const isCurrentlyAssigned =
          alert.assignedToUserId === userId ||
          (alert.assignedToUserId === null && alert.assignedToRole === user.role);

        if (!isCurrentlyAssigned) {
          const wasPreviouslyAssigned = await this.prisma.alertAssignmentHistory.findFirst({
            where: {
              alertId,
              OR: [
                { assignedToUserId: userId },
                { assignedToRole: user.role },
              ],
            },
          });

          if (!wasPreviouslyAssigned) {
            throw new NotFoundException('Alert not found');
          }
        }
      }
    }

    if (userId && alert.assignedToUserId === userId) {
      this.prisma.alertAssignment.updateMany({
        where: {
          alertId: alert.id,
          assignedToId: userId,
          seenAt: null,
          status: 'OPEN',
        },
        data: {
          seenAt: new Date(),
        },
      }).catch((err) => {
        console.warn(`[findOneAlert] Failed to update seenAt timestamp:`, err.message);
      });
    }

    let alertDefinition = null;
    if (alert.alertDefinitionId) {
      alertDefinition = await this.prisma.alertDefinition.findUnique({
        where: { id: alert.alertDefinitionId },
      });
    }

    return {
      ...alert,
      definition: alertDefinition?.definition || null,
      alertDefinition: alertDefinition || null,
      assignedToUserId: alert.assignedToUserId,
      assignedToUserName: alert.assignedToUser ? alert.assignedToUser.name : null,
      timeline: alert.timeline.map((evt) => ({
        ...evt,
        performedByUserId: evt.performedByUser ? evt.performedByUser.name : evt.performedByUserId,
      })),
      assignments: alert.assignments.map((asm) => ({
        ...asm,
        assignedToUserId: asm.assignedToUserId,
        assignedToUserName: asm.assignedToUser ? asm.assignedToUser.name : null,
        assignedByUserId: asm.assignedByUserId,
        assignedByUserName: asm.assignedByUser ? asm.assignedByUser.name : null,
      })),
      resolution: alert.resolution
        ? {
            ...alert.resolution,
            resolvedByUserId: alert.resolution.resolvedByUserId,
            resolvedByUserName: alert.resolution.resolvedByUser
              ? alert.resolution.resolvedByUser.name
              : null,
          }
        : null,
    };
  }

  /**
   * Add comment to an alert
   */
  async addComment(
    companyId: string,
    alertId: string,
    userId: string,
    data: {
      commentText: string;
      audioPath?: string;
      transcription?: string;
    },
  ) {
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId, companyId },
    });
    if (!alert) throw new NotFoundException('Alert not found');

    const comment = await this.prisma.resolutionComment.create({
      data: {
        alertId,
        userId,
        commentText: data.commentText,
        audioPath: data.audioPath,
        transcription: data.transcription,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    });

    // Audit timeline log
    await this.prisma.defectResolutionTimeline.create({
      data: {
        alertId,
        actionType: 'NOTE_ADDED',
        performedByUserId: userId,
        performedByRole: comment.user.role,
        details: `Note added: "${data.commentText.slice(0, 60)}${data.commentText.length > 60 ? '...' : ''}"`,
      },
    });

    // Real-time broadcast (targeted)
    this.realtime.broadcastAlert(companyId, 'COMMENT_ADDED', {
      alertId,
      commentId: comment.id,
      commentText: comment.commentText,
      userName: comment.user.name,
      createdAt: comment.createdAt,
      assignedToUserId: alert.assignedToUserId,
      assignedToRole: alert.assignedToRole,
    });

    return comment;
  }

  private calculateNextEscalation(severity: Severity): Date {
    const now = new Date();
    // Default escalations rule triggers
    switch (severity) {
      case Severity.EMERGENCY:
        return new Date(now.getTime() + 15 * 60 * 1000); // 15 mins
      case Severity.CRITICAL:
        return new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hour
      case Severity.HIGH:
        return new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours
      case Severity.MEDIUM:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      default:
        return new Date(now.getTime() + 72 * 60 * 60 * 1000); // 72 hours
    }
  }

  async takeoverAlert(companyId: string, alertId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User profile not found');

    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId, companyId },
      include: { defect: true, assignedToUser: true },
    });
    if (!alert) throw new NotFoundException('Alert not found');

    try {
      await this.prisma.$transaction(async (tx) => {
        const updatedCount = await tx.alert.updateMany({
          where: {
            id: alertId,
            companyId,
            status: { in: [AlertStatus.OPEN, AlertStatus.REOPENED] },
          },
          data: {
            assignedToUserId: userId,
            assignedToRole: alert.assignedToRole ? alert.assignedToRole : user.role,
            status: AlertStatus.IN_PROGRESS,
            nextEscalationAt: null, // Cancel escalations on takeover!
          },
        });

        if (updatedCount.count === 0) {
          throw new BadRequestException('ALERT_ALREADY_TAKEN');
        }

        // 1. Deactivate current active assignments
        await tx.alertAssignment.updateMany({
          where: { alertId, status: 'OPEN' },
          data: { status: 'SUPERSEDED' },
        });

        // 2. Resolve index in original escalation chain
        let nextEscalationLevel = 0;
        if (alert.alertDefinitionId) {
          const def = await tx.alertDefinition.findUnique({
            where: { id: alert.alertDefinitionId },
          });
          if (def) {
            const chainIndex = def.escalationChain.indexOf(userId);
            if (chainIndex !== -1) {
              nextEscalationLevel = chainIndex + 1;
            }
          }
        }

        // 3. Create fresh assignment for takeover user
        await tx.alertAssignment.create({
          data: {
            alertId,
            severity: alert.severity,
            assignedToId: userId,
            assignedAt: new Date(),
            notifiedAt: new Date(),
            seenAt: null,
            reminderCount: 0,
            escalationLevel: nextEscalationLevel,
            status: 'OPEN',
          },
        });

        // 4. Create History assignment
        await tx.alertAssignmentHistory.create({
          data: {
            alertId,
            assignedByUserId: userId,
            assignedToUserId: userId,
            assignedToRole: alert.assignedToRole ? alert.assignedToRole : user.role,
            notes: 'Alert taken over by user',
          },
        });

        // 5. Timeline log
        await tx.defectResolutionTimeline.create({
          data: {
            alertId,
            actionType: 'TAKEOVER',
            performedByUserId: userId,
            performedByRole: user.role,
            details: `Alert taken over by ${user.name} (${user.role}). Escalation chain index set to ${nextEscalationLevel}.`,
          },
        });
      });
    } catch (err) {
      if (err instanceof BadRequestException && err.message === 'ALERT_ALREADY_TAKEN') {
        const currentAlert = await this.prisma.alert.findUnique({
          where: { id: alertId },
          include: { assignedToUser: true },
        });
        const takerName = currentAlert?.assignedToUser?.name || 'another user';
        return {
          success: false,
          alreadyTaken: true,
          message: `Alert already taken over by ${takerName}`,
          alreadyTakenBy: takerName,
        } as any;
      }
      throw err;
    }

    // 6. Broadcast via Socket.IO (targeted)
    this.realtime.broadcastAlert(companyId, 'ALERT_ASSIGNED', {
      alertId,
      assignedToUserId: userId,
      assignedToRole: user.role,
      assignedToName: user.name,
      prevAssignedToUserId: alert.assignedToUserId,
      prevAssignedToRole: alert.assignedToRole,
    });

    // Enqueue notification for the previous assignee user or role to let them know it has been taken over
    (async () => {
      try {
        let targetUsers: any[] = [];
        if (alert.assignedToRole) {
          targetUsers = await this.prisma.user.findMany({
            where: {
              role: alert.assignedToRole as any,
              companyId,
              isActive: true,
              id: { not: userId },
            },
          });
        }

        const title = 'Defect Task Taken Over';
        const message = `Alert '${alert.defect ? alert.defect.name : 'Alert'}' (VIN: ${alert.vin || 'N/A'}) has been taken over by ${user.name} (${user.role}).`;

        await Promise.all(
          targetUsers.map((u) =>
            this.notifications.enqueueNotification({
              companyId,
              userId: u.id,
              alertId,
              title,
              message,
              channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
            })
          )
        );
      } catch (err) {
        console.error('[takeoverAlert] Error enqueueing notifications:', err);
      }
    })();

    return this.findOneAlert(companyId, alertId);
  }
}

