const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Clearing database...');
  // Delete in reverse order of dependencies
  await prisma.notificationPreference.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.resolutionComment.deleteMany({});
  await prisma.resolution.deleteMany({});
  await prisma.defectResolutionTimeline.deleteMany({});
  await prisma.alertAssignmentHistory.deleteMany({});
  await prisma.escalationHistory.deleteMany({});
  await prisma.alert.deleteMany({});
  await prisma.escalationRule.deleteMany({});
  await prisma.alertRule.deleteMany({});
  await prisma.defectMaster.deleteMany({});
  await prisma.userActivityLog.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.companySettings.deleteMany({});
  await prisma.company.deleteMany({});

  console.log('Seeding database...');

  // 1. Create Companies
  const companyAlpha = await prisma.company.create({
    data: {
      id: 'b812efd9-a412-4011-9a99-b1d5e3cdae01',
      name: 'Company Alpha',
      settings: {
        create: {
          soundInfo: 'soft_bell.wav',
          soundWarning: 'chime.wav',
          soundCritical: 'alarm.wav',
          soundEmergency: 'siren.wav',
          escalationGraceMin: 1440,
        },
      },
    },
  });

  const companyBajaj = await prisma.company.create({
    data: {
      id: 'b812efd9-a412-4011-9a99-b1d5e3cdae99',
      name: 'Bajaj',
      settings: {
        create: {
          soundInfo: 'soft_bell.wav',
          soundWarning: 'chime.wav',
          soundCritical: 'alarm.wav',
          soundEmergency: 'siren.wav',
          escalationGraceMin: 1440,
        },
      },
    },
  });

  const companyBeta = await prisma.company.create({
    data: {
      id: 'c201efd9-b412-5011-8b99-a1d5e3cdae02',
      name: 'Company Beta',
      settings: {
        create: {
          soundInfo: 'soft_bell.wav',
          soundWarning: 'chime.wav',
          soundCritical: 'alarm.wav',
          soundEmergency: 'siren.wav',
          escalationGraceMin: 1440,
        },
      },
    },
  });

  // 2. Create Users
  // Passwords are stored in plain text in passwordHash per login check comparison: user.passwordHash === loginDto.password
  const superAdmin = await prisma.user.create({
    data: {
      id: 'f90fa27d-f421-49e0-82a8-fdbd5bc2c30a',
      email: 'superadmin@vams.com',
      passwordHash: 'SecurePassword123',
      name: 'Super Admin User',
      role: 'SUPER_ADMIN',
      companyId: companyAlpha.id,
    },
  });

  const bajajAdmin = await prisma.user.create({
    data: {
      id: 'f90fa27d-f421-49e0-82a8-fdbd5bc2c399',
      email: 'sbodkhe@gmail.com',
      passwordHash: 'Bajaj@123',
      name: 'S Bodkhe',
      role: 'SUPER_ADMIN',
      companyId: companyBajaj.id,
    },
  });

  const adminAlpha = await prisma.user.create({
    data: {
      id: 'a30fa27d-f421-49e0-82a8-fdbd5bc2c30a',
      email: 'admin.alpha@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Alpha Admin',
      role: 'COMPANY_ADMIN',
      companyId: companyAlpha.id,
    },
  });

  const supervisorAlpha = await prisma.user.create({
    data: {
      id: 'e30fa27d-f421-49e0-82a8-fdbd5bc2c30a',
      email: 'supervisor.john@company.com',
      passwordHash: 'SecurePassword123',
      name: 'John Doe',
      role: 'SUPERVISOR',
      companyId: companyAlpha.id,
    },
  });

  const workerAlpha = await prisma.user.create({
    data: {
      id: 'd50a29e4-bcde-4211-8fa1-71ca36df201a',
      email: 'worker.joe@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Joe Worker',
      role: 'WORKER',
      companyId: companyAlpha.id,
    },
  });

  const inspectorAlpha = await prisma.user.create({
    data: {
      id: 'c50a29e4-bcde-4211-8fa1-71ca36df201a',
      email: 'inspector.ian@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Ian Inspector',
      role: 'QUALITY_INSPECTOR',
      companyId: companyAlpha.id,
    },
  });

  const engineerAlpha = await prisma.user.create({
    data: {
      id: 'b50a29e4-bcde-4211-8fa1-71ca36df201a',
      email: 'engineer.eli@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Eli Engineer',
      role: 'SERVICE_ENGINEER',
      companyId: companyAlpha.id,
    },
  });

  const adminBeta = await prisma.user.create({
    data: {
      id: 'b30fa27d-f421-49e0-82a8-fdbd5bc2c30a',
      email: 'admin.beta@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Beta Admin',
      role: 'COMPANY_ADMIN',
      companyId: companyBeta.id,
    },
  });

  // 3. Create Defect Masters
  const defectAlpha1 = await prisma.defectMaster.create({
    data: {
      id: '782f9d1a-be10-4bf6-82bd-02c3a5ef59a2',
      name: 'Brake System Fluid Leak',
      category: 'Brake System',
      severity: 'CRITICAL',
      defaultAssigneeRole: 'QUALITY_INSPECTOR',
      ownerVisible: true,
      soundProfile: 'CRITICAL',
      companyId: companyAlpha.id,
    },
  });

  const defectAlpha2 = await prisma.defectMaster.create({
    data: {
      id: '123f9d1a-be10-4bf6-82bd-02c3a5ef59a2',
      name: 'Engine Overheating',
      category: 'Engine',
      severity: 'HIGH',
      defaultAssigneeRole: 'SERVICE_ENGINEER',
      ownerVisible: true,
      soundProfile: 'HIGH',
      companyId: companyAlpha.id,
    },
  });

  const defectAlpha3 = await prisma.defectMaster.create({
    data: {
      id: '223f9d1a-be10-4bf6-82bd-02c3a5ef59a2',
      name: 'Assembly Line Calibration Failure',
      category: 'Assembly',
      severity: 'CRITICAL',
      defaultAssigneeRole: 'WORKER',
      ownerVisible: true,
      soundProfile: 'CRITICAL',
      companyId: companyAlpha.id,
    },
  });

  const defectAlpha4 = await prisma.defectMaster.create({
    data: {
      id: '323f9d1a-be10-4bf6-82bd-02c3a5ef59a2',
      name: 'Transmission Sensor Fault',
      category: 'Transmission',
      severity: 'MEDIUM',
      defaultAssigneeRole: 'SUPERVISOR',
      ownerVisible: true,
      soundProfile: 'MEDIUM',
      companyId: companyAlpha.id,
    },
  });

  const defectAlpha5 = await prisma.defectMaster.create({
    data: {
      id: '423f9d1a-be10-4bf6-82bd-02c3a5ef59a2',
      name: 'Windshield Fluid Low',
      category: 'Cabin',
      severity: 'LOW',
      defaultAssigneeRole: 'WORKER',
      ownerVisible: true,
      soundProfile: 'LOW',
      companyId: companyAlpha.id,
    },
  });

  const defectBeta = await prisma.defectMaster.create({
    data: {
      id: '882f9d1a-be10-4bf6-82bd-02c3a5ef59a2',
      name: 'Tire Pressure Low',
      category: 'Wheels',
      severity: 'LOW',
      defaultAssigneeRole: 'WORKER',
      ownerVisible: true,
      soundProfile: 'LOW',
      companyId: companyBeta.id,
    },
  });

  // 4. Create Alerts
  // Alert 1: CRITICAL - Brake System Fluid Leak (routed to QUALITY_INSPECTOR role)
  await prisma.alert.create({
    data: {
      id: 'cfa3410c-99a3-48ee-bd73-c1ea29b8de01',
      vin: 'MALXW35848DJ29103',
      companyId: companyAlpha.id,
      defectId: defectAlpha1.id,
      severity: 'CRITICAL',
      status: 'OPEN',
      assignedToRole: 'QUALITY_INSPECTOR',
    },
  });

  // Alert 2: CRITICAL - Assembly Line Calibration Failure (assigned to WORKER role)
  const workerAlert = await prisma.alert.create({
    data: {
      id: 'dfa3410c-99a3-48ee-bd73-c1ea29b8de02',
      vin: 'MALXW35848DJ29104',
      companyId: companyAlpha.id,
      defectId: defectAlpha3.id,
      severity: 'CRITICAL',
      status: 'OPEN',
      assignedToRole: 'WORKER',
    },
  });

  // Alert 3: MEDIUM - Transmission Sensor Fault (assigned to SUPERVISOR role)
  const supervisorAlert = await prisma.alert.create({
    data: {
      id: 'efa3410c-99a3-48ee-bd73-c1ea29b8de03',
      vin: 'MALXW35848DJ29105',
      companyId: companyAlpha.id,
      defectId: defectAlpha4.id,
      severity: 'MEDIUM',
      status: 'OPEN',
      assignedToRole: 'SUPERVISOR',
    },
  });

  // Alert 4: HIGH - Engine Overheating (assigned directly to Eli Engineer - SERVICE_ENGINEER)
  await prisma.alert.create({
    data: {
      id: 'ffa3410c-99a3-48ee-bd73-c1ea29b8de04',
      vin: 'MALXW35848DJ29106',
      companyId: companyAlpha.id,
      defectId: defectAlpha2.id,
      severity: 'HIGH',
      status: 'OPEN',
      assignedToUserId: engineerAlpha.id,
    },
  });

  // Alert 5: LOW - Windshield Fluid Low (assigned to WORKER role)
  await prisma.alert.create({
    data: {
      id: 'afa3410c-99a3-48ee-bd73-c1ea29b8de07',
      vin: 'MALXW35848DJ29108',
      companyId: companyAlpha.id,
      defectId: defectAlpha5.id,
      severity: 'LOW',
      status: 'OPEN',
      assignedToRole: 'WORKER',
    },
  });

  // Alert 6: Low Tire Pressure in Beta (assigned to WORKER role)
  await prisma.alert.create({
    data: {
      id: '8fa3410c-99a3-48ee-bd73-c1ea29b8de05',
      vin: 'MALXW35848DJ29107',
      companyId: companyBeta.id,
      defectId: defectBeta.id,
      severity: 'LOW',
      status: 'OPEN',
      assignedToRole: 'WORKER',
    },
  });

  // 5. Pre-seed notifications for Company Alpha users
  console.log('Seeding notification logs...');
  const companyAlphaUsers = [adminAlpha.id, supervisorAlpha.id, workerAlpha.id, inspectorAlpha.id, engineerAlpha.id];
  for (const userId of companyAlphaUsers) {
    await prisma.notification.create({
      data: {
        companyId: companyAlpha.id,
        userId: userId,
        alertId: workerAlert.id,
        title: 'Defect Task Handover',
        message: 'John Doe (SUPERVISOR) has taken over Joe Worker (WORKER)\'s defect task \'Assembly Line Calibration Failure\' on VIN MALXW35848DJ29104.',
        channel: 'IN_APP',
        isRead: false,
      }
    });

    await prisma.notification.create({
      data: {
        companyId: companyAlpha.id,
        userId: userId,
        alertId: supervisorAlert.id,
        title: 'Defect Task Resolved',
        message: 'Joe Worker (WORKER) has resolved John Doe (SUPERVISOR)\'s defect task \'Transmission Sensor Fault\' on VIN MALXW35848DJ29105.',
        channel: 'IN_APP',
        isRead: false,
      }
    });

    await prisma.notification.create({
      data: {
        companyId: companyAlpha.id,
        userId: userId,
        title: 'Defect Task Assignment',
        message: 'Alpha Admin (COMPANY_ADMIN) assigned defect task \'Brake System Fluid Leak\' to Ian Inspector (QUALITY_INSPECTOR).',
        channel: 'IN_APP',
        isRead: false,
      }
    });
  }

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
