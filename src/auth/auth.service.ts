import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: any) {
    // Resolve company ID if company name is passed (supports both companyId and companyIdOrName)
    let targetCompanyId = loginDto.companyId || loginDto.companyIdOrName;
    if (targetCompanyId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetCompanyId);
      if (!isUuid) {
        const company = await this.prisma.company.findFirst({
          where: {
            name: {
              equals: targetCompanyId,
              mode: 'insensitive'
            }
          },
        });
        if (company) {
          targetCompanyId = company.id;
        }
      }
    }

    const email = loginDto.email?.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive'
        },
        ...(targetCompanyId ? { companyId: targetCompanyId } : {}),
      },
      include: {
        company: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Support both password and passwordHash
    const incomingPassword = loginDto.password || loginDto.passwordHash;
    const passwordIsValid = user.passwordHash === incomingPassword; 
    if (!passwordIsValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { 
      sub: user.id, 
      email: user.email, 
      role: user.role, 
      companyId: user.companyId,
      companyName: user.company.name,
      companyCode: user.company.name,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
        companyName: user.company.name,
        companyCode: user.company.name,
      },
    };
  }

  async register(data: any) {
    const email = data.email?.trim().toLowerCase();
    if (!email) {
      throw new Error('Email is required');
    }

    const companyIdOrName = data.companyId?.trim();
    if (!companyIdOrName) {
      throw new Error('Company ID or name is required');
    }

    // Check if the input is a valid UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyIdOrName);
    
    let company = null;
    if (isUuid) {
      company = await this.prisma.company.findUnique({
        where: { id: companyIdOrName },
      });
    }

    if (!company) {
      company = await this.prisma.company.findFirst({
        where: {
          name: {
            equals: companyIdOrName,
            mode: 'insensitive'
          }
        },
      });
    }

    // If company does not exist, create it automatically along with default settings
    if (!company) {
      company = await this.prisma.$transaction(async (tx) => {
        const newComp = await tx.company.create({
          data: { name: companyIdOrName },
        });

        await tx.companySettings.create({
          data: {
            companyId: newComp.id,
            soundInfo: 'soft_bell.mp3',
            soundWarning: 'chime.mp3',
            soundCritical: 'alarm.mp3',
            soundEmergency: 'siren.mp3',
          },
        });

        return newComp;
      });
    }

    // Check duplicate user scoped to the company
    const existingUser = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive'
        },
        companyId: company.id
      },
    });
    if (existingUser) {
      throw new ConflictException(`User with this email is already registered in this company`);
    }

    const validRoles = [
      'SUPER_ADMIN',
      'COMPANY_ADMIN',
      'FACTORY_MANAGER',
      'SUPERVISOR',
      'WORKER',
      'QUALITY_INSPECTOR',
      'SERVICE_ENGINEER',
      'DEALER',
      'VEHICLE_OWNER',
      'READ_ONLY_USER',
    ];
    
    let resolvedRole = data.role;
    if (resolvedRole === 'MANAGER') {
      resolvedRole = 'FACTORY_MANAGER';
    }
    if (!validRoles.includes(resolvedRole)) {
      resolvedRole = 'WORKER';
    }

    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email: email,
        passwordHash: data.password,
        role: resolvedRole as any,
        companyId: company.id,
        isActive: true, // Activated by default to support immediate login
      },
    });

    const { passwordHash, ...result } = user;
    return result;
  }

  async updateDeviceToken(userId: string, token: string) {
    // 1. Check if token already registered for this user
    const existing = await this.prisma.userDeviceToken.findFirst({
      where: { userId, token },
    });
    if (!existing) {
      await this.prisma.userDeviceToken.create({
        data: { userId, token },
      });
    }

    // 2. Fallback to also update User.fcmToken field to keep legacy single-token queries working
    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token },
    });

    return { success: true };
  }

  async removeDeviceToken(userId: string, token: string) {
    // 1. Delete token from UserDeviceToken table
    await this.prisma.userDeviceToken.deleteMany({
      where: { userId, token },
    });

    // 2. If it was the main fcmToken fallback, clear it or set to the next available token
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    if (user && user.fcmToken === token) {
      const nextToken = await this.prisma.userDeviceToken.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      await this.prisma.user.update({
        where: { id: userId },
        data: { fcmToken: nextToken ? nextToken.token : null },
      });
    }

    return { success: true };
  }
}
