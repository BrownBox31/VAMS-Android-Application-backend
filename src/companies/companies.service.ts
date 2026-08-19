import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  async create(name: string) {
    const existing = await this.prisma.company.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive'
        }
      },
    });
    if (existing) {
      throw new ConflictException('Company with this name/code is already registered');
    }

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name },
      });

      // Default settings setup (including default sound profiles matching Play guidelines)
      const settings = await tx.companySettings.create({
        data: {
          companyId: company.id,
          soundInfo: 'soft_bell.mp3',
          soundWarning: 'chime.mp3',
          soundCritical: 'alarm.mp3',
          soundEmergency: 'siren.mp3',
        },
      });

      return { ...company, settings };
    });
  }

  async getSettings(companyId: string) {
    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId },
    });
    if (!settings) {
      throw new NotFoundException('Company settings not found');
    }
    return settings;
  }

  async updateSettings(companyId: string, data: any) {
    return this.prisma.companySettings.update({
      where: { companyId },
      data,
    });
  }

  async findOne(idOrName: string) {
    const trimmedIdOrName = idOrName?.trim();
    if (!trimmedIdOrName) {
      throw new NotFoundException('Company not found');
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmedIdOrName);
    let company = null;
    if (isUuid) {
      company = await this.prisma.company.findUnique({
        where: { id: trimmedIdOrName },
      });
    }

    if (!company) {
      company = await this.prisma.company.findFirst({
        where: {
          name: {
            equals: trimmedIdOrName,
            mode: 'insensitive'
          }
        },
      });
    }

    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async findUsers(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
