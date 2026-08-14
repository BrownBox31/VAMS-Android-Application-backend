import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
        // Loop completed, notify all active users of the company (admin fallback)
        targetUsers = await this.prisma.user.findMany({
          where: { companyId: payload.companyId, isActive: true }
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
    if (payload.alertDefinitionId) {
      const def = await this.prisma.alertDefinition.findUnique({
        where: { id: payload.alertDefinitionId },
      });
      if (def) {
        criticalOverride = def.criticalOverride;
        if (def.escalationTimeout) {
          nextEscalationAt = new Date(Date.now() + def.escalationTimeout * 60 * 1000);
        }
      }
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
      let targetRole = payload.assignedToRole || null;
      let targetName = targetRole || 'Default';
      if (payload.assignedToUserId) {
        const targetUser = await this.prisma.user.findUnique({
          where: { id: payload.assignedToUserId },
          select: { role: true, name: true },
        });
        if (targetUser) {
          targetRole = targetUser.role;
          targetName = targetUser.name;
        }
      }
      if (!targetRole && !payload.assignedToUserId) {
        targetRole = defect.defaultAssigneeRole;
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
            assignedToUserId: payload.assignedToUserId || null,
            assignedToRole: targetRole,
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
    });

    // 5. Run enqueuing and notification queries asynchronously in the background
    const finalAlert = alert;
    const finalDefect = defect;
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
        } else {
          // Fallback: target only company and super admins to avoid leaking alerts to all roles
          targetUsers = await this.prisma.user.findMany({
            where: {
              companyId: payload.companyId,
              isActive: true,
              role: { in: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            },
          });
        }

        const crypto = require('crypto');
        await Promise.all(
          targetUsers.map(async (user) => {
            const isYou = user.id === finalAlert.assignedToUserId;
            await this.notifications.enqueueNotification({
              companyId: payload.companyId,
              userId: user.id,
              alertId: finalAlert.id,
              title: `${finalSeverity} ALERT: ${finalDefect.name}`,
              message: payload.message || `New defect '${finalDefect.name}' is assigned to ${isYou ? 'you' : assigneeName}.`,
              channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
            });

            await this.prisma.alertNotificationLog.create({
              data: {
                id: crypto.randomUUID(),
                alertId: finalAlert.id,
                userId: user.id,
                type: 'NOTIFICATION',
                message: `New defect '${finalDefect.name}' is assigned to ${isYou ? 'you' : assigneeName}.`,
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

    let targetUserRole = data.assignedToRole || null;
    let targetUserName = data.assignedToRole ? `Role ${data.assignedToRole}` : 'Dynamic';
    if (data.assignedToUserId) {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: data.assignedToUserId },
        select: { role: true, name: true },
      });
      if (targetUser) {
        targetUserRole = targetUser.role;
        targetUserName = targetUser.name;
      }
    }

    const updatedAlert = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.alert.update({
        where: { id: alertId },
        data: {
          assignedToUserId: data.assignedToUserId || null,
          assignedToRole: targetUserRole,
          assignedToDepartment: data.assignedToDepartment || null,
          assignedToTeam: data.assignedToTeam || null,
          status: AlertStatus.IN_PROGRESS,
          escalationStep: 0,
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
          assignedToRole: data.assignedToRole,
          assignedToDepartment: data.assignedToDepartment,
          assignedToTeam: data.assignedToTeam,
          notes: data.notes,
        },
      });

      // Defect Lifecycle timeline update
      const targetName = targetUserName;
      const isTakeover = performedByUserId === data.assignedToUserId;
      const detailsText = isTakeover
        ? `Alert taken over by ${user.name} (${user.role}). Notes: ${data.notes || 'None'}`
        : `Alert assigned by ${user.name} (${user.role}) to ${targetName}. Notes: ${data.notes || 'None'}`;

      await tx.defectResolutionTimeline.create({
        data: {
          alertId,
          actionType: isTakeover ? 'TAKEOVER' : 'ASSIGNED',
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
        if (updatedAlert.assignedToUserId) {
          targetUsers = await this.prisma.user.findMany({
            where: {
              id: updatedAlert.assignedToUserId,
              companyId,
              isActive: true,
            },
          });
        } else if (updatedAlert.assignedToRole) {
          targetUsers = await this.prisma.user.findMany({
            where: {
              role: updatedAlert.assignedToRole as any,
              companyId,
              isActive: true,
            },
          });
        } else {
          targetUsers = await this.prisma.user.findMany({
            where: {
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

    return updatedAlert;
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

    // Enqueue notifications for target users in background (performer role only)
    (async () => {
      try {
        const targetUsers = await this.prisma.user.findMany({
          where: {
            companyId,
            isActive: true,
            role: user.role as any,
          },
        });

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
      include: { defect: true },
    });
    if (!alert) throw new NotFoundException('Alert not found');

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
          nextEscalationAt,
          escalationStep: 0,
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

      // Recreate assignment for target user
      if (alert.assignedToUserId) {
        await tx.alertAssignment.create({
          data: {
            alertId,
            severity: alert.severity,
            assignedToId: alert.assignedToUserId,
            assignedAt: new Date(),
            notifiedAt: new Date(),
            seenAt: null,
            reminderCount: 0,
            escalationLevel: 0,
            status: 'OPEN',
          },
        });
      }

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

    // Enqueue notifications for target assignees only (performer role only)
    (async () => {
      try {
        const targetUsers = await this.prisma.user.findMany({
          where: {
            companyId,
            isActive: true,
            role: user.role as any,
          },
        });

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
  async getDashboardTelemetry(companyId: string, requestingUser?: any) {
    const userRole = requestingUser?.role;
    const userId = requestingUser?.id;

    const baseWhere: any = {
      companyId,
      defect: { active: true },
    };

    if (userRole && userRole !== 'SUPER_ADMIN' && userRole !== 'COMPANY_ADMIN') {
      baseWhere.OR = [
        { assignedToUserId: userId },
        { assignedToRole: userRole as any },
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
      
      if (isAdmin && filters.allVisible) {
        if (filters.assignedToUserId) {
          whereClause.assignedToUserId = filters.assignedToUserId;
        }
        if (filters.assignedToRole) {
          whereClause.assignedToRole = filters.assignedToRole;
        }
      } else {
        whereClause.OR = [
          { assignedToUserId: userId },
          { assignedToRole: userRole as any },
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

    return alerts.map((a) => ({
      ...a,
      assignedToUserId: a.assignedToUser ? a.assignedToUser.name : a.assignedToUserId,
    }));
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
          alert.assignedToRole === user.role;

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

    return {
      ...alert,
      assignedToUserId: alert.assignedToUser ? alert.assignedToUser.name : alert.assignedToUserId,
      timeline: alert.timeline.map((evt) => ({
        ...evt,
        performedByUserId: evt.performedByUser ? evt.performedByUser.name : evt.performedByUserId,
      })),
      assignments: alert.assignments.map((asm) => ({
        ...asm,
        assignedToUserId: asm.assignedToUser ? asm.assignedToUser.name : asm.assignedToUserId,
        assignedByUserId: asm.assignedByUser ? asm.assignedByUser.name : asm.assignedByUserId,
      })),
      resolution: alert.resolution
        ? {
            ...alert.resolution,
            resolvedByUserId: alert.resolution.resolvedByUser
              ? alert.resolution.resolvedByUser.name
              : alert.resolution.resolvedByUserId,
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
    });
    if (!alert) throw new NotFoundException('Alert not found');

    // 1. Deactivate current active assignments
    await this.prisma.alertAssignment.updateMany({
      where: { alertId, status: 'OPEN' },
      data: { status: 'SUPERSEDED' },
    });

    // 2. Resolve index in original escalation chain
    let nextEscalationLevel = 0;
    if (alert.alertDefinitionId) {
      const def = await this.prisma.alertDefinition.findUnique({
        where: { id: alert.alertDefinitionId },
      });
      if (def) {
        const chainIndex = def.escalationChain.indexOf(userId);
        if (chainIndex !== -1) {
          nextEscalationLevel = chainIndex + 1;
        }
      }
    }

    // 3. Create fresh assignment for takeover user, resetting clock and seenAt
    await this.prisma.alertAssignment.create({
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

    // 4. Update the Alert assignedToUserId
    const updatedAlert = await this.prisma.alert.update({
      where: { id: alertId },
      data: {
        assignedToUserId: userId,
        assignedToRole: alert.assignedToRole ? alert.assignedToRole : user.role,
        status: AlertStatus.IN_PROGRESS,
      },
    });

    // 5. Create History assignment and timeline log
    await this.prisma.alertAssignmentHistory.create({
      data: {
        alertId,
        assignedByUserId: userId,
        assignedToUserId: userId,
        assignedToRole: alert.assignedToRole ? alert.assignedToRole : user.role,
        notes: 'Alert taken over by user',
      },
    });

    await this.prisma.defectResolutionTimeline.create({
      data: {
        alertId,
        actionType: 'ASSIGNED',
        performedByUserId: userId,
        performedByRole: user.role,
        details: `Alert taken over by ${user.name} (${user.role}). Escalation chain index set to ${nextEscalationLevel}.`,
      },
    });

    // 6. Broadcast via Socket.IO (targeted)
    this.realtime.broadcastAlert(companyId, 'ALERT_ASSIGNED', {
      alertId,
      assignedToUserId: userId,
      assignedToRole: user.role,
      assignedToName: user.name,
      prevAssignedToUserId: alert.assignedToUserId,
      prevAssignedToRole: alert.assignedToRole,
    });

    return updatedAlert;
  }
}

