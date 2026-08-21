import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.query.token as string;
      if (!token) {
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'vams-super-secret-key-change-in-prod',
      });

      // Assign user client to company-specific and role-specific rooms
      const companyRoom = `company_${decoded.companyId}`;
      client.join(companyRoom);

      // Join role specific room for targeted escalation notification
      const roleRoom = `company_${decoded.companyId}_role_${decoded.role}`;
      client.join(roleRoom);

      // Join user specific room for targeted notifications
      const userRoom = `company_${decoded.companyId}_user_${decoded.sub}`;
      client.join(userRoom);

      // Detect if browser (web client) to route dashboard events without sending push notifications to mobile apps
      const userAgent = (client.handshake.headers['user-agent'] || '').toLowerCase();
      const isBrowser = userAgent.includes('mozilla') || userAgent.includes('chrome') || userAgent.includes('safari') || userAgent.includes('firefox');
      let webRoom = '';
      if (isBrowser) {
        webRoom = `company_${decoded.companyId}_web`;
        client.join(webRoom);
      }

      if (decoded.role === 'SUPER_ADMIN') {
        client.join('super_admins');
      }

      console.log(`Client ${client.id} joined rooms: [${companyRoom}, ${roleRoom}, ${userRoom}${webRoom ? ', ' + webRoom : ''}${decoded.role === 'SUPER_ADMIN' ? ', super_admins' : ''}]`);
    } catch (err) {
      console.log(`WS Connection validation failed for client ${client.id}:`, err.message);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  // Broadcaster methods
  broadcastToCompany(companyId: string, event: string, payload: any) {
    if (this.server) {
      if (event === 'BROADCAST_CREATED' && (payload.targetUserIds?.length || payload.targetRoles?.length)) {
        const rooms: string[] = [];
        if (payload.targetUserIds) {
          for (const uId of payload.targetUserIds) {
            rooms.push(`company_${companyId}_user_${uId}`);
          }
        }
        if (payload.targetRoles) {
          for (const role of payload.targetRoles) {
            rooms.push(`company_${companyId}_role_${role}`);
          }
        }
        if (rooms.length > 0) {
          let builder = this.server.to(rooms[0]);
          for (let i = 1; i < rooms.length; i++) {
            builder = builder.to(rooms[i]);
          }
          builder.emit(event, payload);
          return;
        }
      }

      if (companyId && companyId !== 'all') {
        this.server.to(`company_${companyId}`).to('super_admins').emit(event, payload);
      } else {
        this.server.emit(event, payload);
      }
    } else {
      console.warn(`WebSocket server not initialized. Skipping broadcast [${event}]`);
    }
  }

  broadcastToRole(companyId: string, role: string, event: string, payload: any) {
    if (this.server) {
      this.server.to(`company_${companyId}_role_${role}`).to('super_admins').emit(event, payload);
    } else {
      console.warn(`WebSocket server not initialized. Skipping broadcast [${event}] to role room`);
    }
  }

  broadcastAlert(companyId: string, event: string, payload: any) {
    if (this.server) {
      const assignedToUserId = payload.assignedToUserId;
      const assignedToRole = payload.assignedToRole;
      const prevAssignedToUserId = payload.prevAssignedToUserId;
      const prevAssignedToRole = payload.prevAssignedToRole;
      const steppedFromRole = payload.steppedFromRole;

      // 1. Emit full alert payload (with title and message) only to targeted rooms
      const targetRooms: string[] = [];
      if (assignedToUserId) {
        targetRooms.push(`company_${companyId}_user_${assignedToUserId}`);
      }
      if (assignedToRole) {
        if (assignedToRole === 'COMPANY_ADMIN' || assignedToRole === 'SUPER_ADMIN') {
          targetRooms.push(`company_${companyId}_role_COMPANY_ADMIN`);
          targetRooms.push(`company_${companyId}_role_SUPER_ADMIN`);
        } else {
          targetRooms.push(`company_${companyId}_role_${assignedToRole}`);
        }
      }

      if (targetRooms.length > 0) {
        let operator: any = this.server;
        for (const room of targetRooms) {
          operator = operator.to(room);
        }
        operator.emit(event, payload);
      }

      // 2. Emit silent update (without title and message) to previous assignee/role rooms
      const silentPayload = { ...payload };
      const isTakeover = event === 'ALERT_ASSIGNED' && payload.assignedToUserId && !payload.prevAssignedToUserId;
      if (isTakeover) {
        silentPayload.isTakeoverNotification = true;
      } else {
        delete silentPayload.title;
        delete silentPayload.message;
      }

      let silentBuilder = null;
      if (prevAssignedToUserId) {
        const prevUserRoom = `company_${companyId}_user_${prevAssignedToUserId}`;
        silentBuilder = this.server.to(prevUserRoom);
      } else {
        if (prevAssignedToRole) {
          if (prevAssignedToRole === 'COMPANY_ADMIN' || prevAssignedToRole === 'SUPER_ADMIN') {
            silentBuilder = this.server
              .to(`company_${companyId}_role_COMPANY_ADMIN`)
              .to(`company_${companyId}_role_SUPER_ADMIN`);
          } else {
            const prevRoleRoom = `company_${companyId}_role_${prevAssignedToRole}`;
            silentBuilder = silentBuilder ? silentBuilder.to(prevRoleRoom) : this.server.to(prevRoleRoom);
          }
        }
        if (steppedFromRole) {
          if (steppedFromRole === 'COMPANY_ADMIN' || steppedFromRole === 'SUPER_ADMIN') {
            silentBuilder = silentBuilder
              ? silentBuilder.to(`company_${companyId}_role_COMPANY_ADMIN`).to(`company_${companyId}_role_SUPER_ADMIN`)
              : this.server.to(`company_${companyId}_role_COMPANY_ADMIN`).to(`company_${companyId}_role_SUPER_ADMIN`);
          } else {
            const steppedFromRoom = `company_${companyId}_role_${steppedFromRole}`;
            silentBuilder = silentBuilder ? silentBuilder.to(steppedFromRoom) : this.server.to(steppedFromRoom);
          }
        }
      }

      if (silentBuilder) {
        silentBuilder.emit(event, silentPayload);
      }

      // 3. Emit dashboard-sync signal (sync-only event) to web and super admin rooms
      const syncPayload = { ...payload, isSyncOnly: true };
      this.server
        .to(`company_${companyId}_web`)
        .to('super_admins')
        .emit(event, syncPayload);
    } else {
      console.warn(`WebSocket server not initialized. Skipping broadcastAlert [${event}]`);
    }
  }
}
