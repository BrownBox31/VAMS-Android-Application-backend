import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';

@Processor('notifications')
@Injectable()
export class NotificationsProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
    this.initializeFirebase();
  }

  private initializeFirebase() {
    if (getApps().length > 0) {
      return;
    }

    try {
      // 1. Try environment variable (Production / Render)
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(
          process.env.FIREBASE_SERVICE_ACCOUNT,
        );

        initializeApp({
          credential: cert(serviceAccount),
        });

        console.log(
          '[Firebase Admin] Initialized successfully using environment variable.',
        );
        return;
      }

      // 2. Try service account file path (Local development)
      const rawPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
      const credPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);

      if (fs.existsSync(credPath)) {
        initializeApp({
          credential: cert(credPath),
        });
        console.log(`[Firebase Admin] Initialized successfully using file: ${credPath}`);
        return;
      }

      console.warn(
        `[Firebase Admin] Firebase config not found. Neither FIREBASE_SERVICE_ACCOUNT env var nor file at ${credPath} exists.`,
      );
    } catch (err) {
      console.error('[Firebase Admin] Initialization failed:', err);
    }
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { notificationId, channel, title, message, userId, alertId } = job.data;

    console.log(
      `[BullMQ Worker] Processing notification ${notificationId} via ${channel}`,
    );

    switch (channel) {
      case NotificationChannel.EMAIL:
        await this.sendMockEmail(title, message);
        break;

      case NotificationChannel.PUSH:
        await this.sendPush(notificationId, userId, title, message, alertId);
        break;

      case NotificationChannel.SMS:
        await this.sendMockSms(title, message);
        break;

      case NotificationChannel.IN_APP:
        break;
    }

    return {
      status: 'SENT',
      notificationId,
    };
  }

  private async sendMockEmail(title: string, message: string) {
    console.log(`Sending Email: ${title} - ${message}`);
  }

  private async sendMockSms(title: string, message: string) {
    console.log(`Sending SMS: ${title} - ${message}`);
  }

  private async sendPush(
    notificationId: string,
    userId: string,
    title: string,
    message: string,
    jobAlertId?: string,
  ) {
    if (!userId) {
      console.log('No userId supplied.');
      return;
    }

    let severity = 'INFO';
    let soundProfile = 'ALERT';
    let alertId = jobAlertId || '';

    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
        include: {
          alert: {
            include: {
              defect: true,
            },
          },
        },
      });

      if (notification) {
        alertId = notification.alertId || jobAlertId || '';
        const titleUpper = notification.title.toUpperCase();
        
        let alertRecord = notification.alert;
        if (!alertRecord && alertId && alertId !== 'BROADCAST' && !alertId.startsWith('BROADCAST')) {
          try {
            alertRecord = await this.prisma.alert.findUnique({
              where: { id: alertId },
              include: { defect: true },
            });
          } catch (e) {
            // ignore
          }
        }

        if (alertRecord) {
          severity = alertRecord.isManual ? 'CRITICAL' : (alertRecord.severity || 'INFO');
          soundProfile = alertRecord.isManual ? 'CRITICAL' : (alertRecord.defect?.soundProfile || 'ALERT');
        } else {
          if (alertId === 'BROADCAST' || alertId.startsWith('BROADCAST') || titleUpper.includes('BROADCAST')) {
            severity = 'HIGH';
            soundProfile = 'ALERT';
          } else {
            // Fallback keyword detection for BROADCAST, ESCALATION, REMINDER titles
            if (
              titleUpper.includes('CRITICAL') ||
              titleUpper.includes('EMERGENCY') ||
              titleUpper.includes('FALLBACK') ||
              titleUpper.includes('FIRE') ||
              titleUpper.includes('SAFETY')
            ) {
              severity = 'CRITICAL';
              soundProfile = 'CRITICAL';
            } else if (
              titleUpper.includes('ESCALAT') ||
              titleUpper.includes('REMINDER') ||
              titleUpper.includes('HIGH')
            ) {
              severity = 'HIGH';
              soundProfile = 'ALERT';
            }
          }
        }
      }
    } catch (dbErr) {
      console.error('[sendPush] Error querying database for notification metadata:', dbErr);
    }

    // Fetch all tokens from UserDeviceToken
    const deviceTokens = await this.prisma.userDeviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    
    const tokens = new Set<string>();
    deviceTokens.forEach(t => tokens.add(t.token));

    // Also fallback to User.fcmToken
    const userRecord = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });
    if (userRecord?.fcmToken) {
      tokens.add(userRecord.fcmToken);
    }

    if (tokens.size === 0) {
      console.log(`No registered push tokens found for user ${userId}`);
      return;
    }

    if (getApps().length === 0) {
      console.log('Firebase not initialized.');
      return;
    }

    const titleUpper = title.toUpperCase();
    const isTaskAction = titleUpper.includes('RESOLVED') || titleUpper.includes('REOPEN') || titleUpper.includes('HANDOVER') || titleUpper.includes('ASSIGN') || titleUpper.includes('TAKEOVER') || titleUpper.includes('TAKE OVER');
    const isSiren = (severity.toUpperCase() === 'CRITICAL' || severity.toUpperCase() === 'EMERGENCY' || soundProfile.toUpperCase() === 'CRITICAL') && !isTaskAction;
    const isBeep = severity.toUpperCase() === 'HIGH' || severity.toUpperCase() === 'MEDIUM' || soundProfile.toUpperCase() === 'ALERT' || isTaskAction;

    const targetChannelId = isSiren 
      ? 'vams_siren_alerts_v8' 
      : (isBeep ? 'vams_beep_alerts_v8' : 'vams_default_alerts_v8');

    for (const token of tokens) {
      try {
        // Send a high-priority message containing both notification (for OS-level display when closed)
        // and data blocks (for app-level consumption when active).
        await getMessaging().send({
          token,
          notification: {
            title,
            body: message,
          },
          data: {
            alertId,
            severity,
            soundProfile,
            title,
            message,
          },
          android: {
            priority: 'high',
            notification: {
              channelId: targetChannelId,
            },
          },
        });
      } catch (error: any) {
        console.error(`FCM Error for token ${token} of user ${userId}:`, error?.message || error);
        
        const isNotRegistered = 
          error?.code === 'messaging/registration-token-not-registered' ||
          error?.errorInfo?.code === 'messaging/registration-token-not-registered' ||
          error?.response?.data?.error?.message === 'NotRegistered' ||
          (typeof error?.response?.text === 'string' && error.response.text.includes('NotRegistered'));
          
        if (isNotRegistered) {
          console.warn(`[FCM] Token ${token} for user ${userId} is unregistered. Clearing stale token.`);
          // Delete from UserDeviceToken
          await this.prisma.userDeviceToken.deleteMany({
            where: { userId, token },
          }).catch(() => {});

          // Also clear from User.fcmToken if it matches
          if (userRecord && userRecord.fcmToken === token) {
            await this.prisma.user.update({
              where: { id: userId },
              data: { fcmToken: null },
            }).catch(() => {});
          }
        }
      }
    }
  }
}