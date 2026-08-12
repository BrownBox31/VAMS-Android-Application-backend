import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Severity, UserRole } from '@prisma/client';
import { AlertsService } from '../alerts/alerts.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DefectsService {
  constructor(
    private prisma: PrismaService,
    private alertsService: AlertsService,
  ) {}

  async create(companyId: string, data: {
    name: string;
    category: string;
    severity: Severity;
    defaultAssigneeRole?: UserRole;
    ownerVisible?: boolean;
    soundProfile?: string;
  }) {
    // Prevent duplicate defect names inside same company
    const existing = await this.prisma.defectMaster.findFirst({
      where: { companyId, name: data.name },
    });

    if (existing) {
      throw new ConflictException('Defect with this name already exists in the company catalog');
    }

    const defect = await this.prisma.defectMaster.create({
      data: {
        ...data,
        companyId,
      },
    });

    // Automatically trigger a live test Alert on the dashboard for this new defect catalog item!
    try {
      const randomVinSuffix = Math.floor(10000 + Math.random() * 90000);
      await this.alertsService.ingestEvent({
        source: 'MANUAL_CATALOG_ENTRY',
        event_type: 'DEFECT_REGISTERED',
        companyId,
        vin: `VIN-TEST-${randomVinSuffix}`,
        defectName: defect.name,
      });
    } catch (err) {
      console.error('Failed to trigger auto-alert for newly created defect:', err);
    }

    return defect;
  }

  async findAll(companyId: string) {
    return this.prisma.defectMaster.findMany({
      where: { companyId, active: true },
    });
  }

  async deactivate(companyId: string, id: string) {
    return this.prisma.defectMaster.update({
      where: { id, companyId },
      data: { active: false },
    });
  }

  async syncPythonDefects(companyId: string) {
    const filePath = path.resolve(process.cwd(), 'data/data/cleaned_defects_list.json');
    if (!fs.existsSync(filePath)) {
      return { success: false, message: 'Cleaned defects list file not found on disk.' };
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const defectsList: string[] = JSON.parse(content);
      
      let importedCount = 0;
      let skippedCount = 0;

      for (const defectName of defectsList) {
        if (!defectName || typeof defectName !== 'string') continue;
        
        const trimmedName = defectName.trim();
        if (!trimmedName) continue;

        // Check if exists
        const existing = await this.prisma.defectMaster.findFirst({
          where: { companyId, name: trimmedName },
        });

        if (!existing) {
          await this.prisma.defectMaster.create({
            data: {
              name: trimmedName,
              category: 'Python Sync',
              severity: 'MEDIUM',
              defaultAssigneeRole: 'WORKER',
              ownerVisible: true,
              soundProfile: 'INFO',
              companyId,
            },
          });
          importedCount++;
        } else {
          skippedCount++;
        }
      }

      return {
        success: true,
        message: `Successfully synchronized Python defects. Mapped ${importedCount} new defect terms. Skipped ${skippedCount} duplicates.`,
        importedCount,
        skippedCount,
      };
    } catch (error) {
      console.error('Failed to sync Python defects:', error);
      return {
        success: false,
        message: `Sync failed: ${error.message || error}`,
      };
    }
  }
}
