import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationChannel } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue('notifications') private notificationQueue: Queue,
    private prisma: PrismaService,
  ) {}

  async enqueueNotification(data: {
    companyId: string;
    userId: string;
    alertId?: string;
    title: string;
    message: string;
    channels: NotificationChannel[];
  }) {
    // 1. Audit log in database first
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { userId: data.userId },
    });

    const activeChannels = data.channels.filter((ch) => {
      const pref = preferences.find((p) => p.channel === ch);
      return pref ? pref.enabled : true; // Default to true if not set
    });

    await Promise.all(
      activeChannels.map(async (channel) => {
        // Create Database Record
        const notification = await this.prisma.notification.create({
          data: {
            companyId: data.companyId,
            userId: data.userId,
            alertId: data.alertId && !data.alertId.startsWith('BROADCAST') ? data.alertId : null,
            title: data.title,
            message: data.message,
            channel,
          },
        });

        try {
          // Enqueue in BullMQ processor for background sending (Push, SMS, Email)
          await this.notificationQueue.add('send_notification', {
            notificationId: notification.id,
            channel,
            userId: data.userId,
            title: data.title,
            message: data.message,
            alertId: data.alertId || null,
          });
        } catch (queueError) {
          console.error(`Failed to add notification to BullMQ queue:`, queueError);
        }
      })
    );
  }
}
