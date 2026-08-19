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
      role: 'COMPANY_ADMIN',
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

  const supervisorBajaj = await prisma.user.create({
    data: {
      id: 'e30fa27d-f421-49e0-82a8-fdbd5bc2c399',
      email: 'supervisor.bajaj@company.com',
      passwordHash: 'SecurePassword123',
      name: 'John Doe',
      role: 'SUPERVISOR',
      companyId: companyBajaj.id,
    },
  });

  const workerBajaj = await prisma.user.create({
    data: {
      id: 'd50a29e4-bcde-4211-8fa1-71ca36df2099',
      email: 'worker.bajaj@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Joe Worker',
      role: 'WORKER',
      companyId: companyBajaj.id,
    },
  });

  const inspectorBajaj = await prisma.user.create({
    data: {
      id: 'c50a29e4-bcde-4211-8fa1-71ca36df2099',
      email: 'inspector.bajaj@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Ian Inspector',
      role: 'QUALITY_INSPECTOR',
      companyId: companyBajaj.id,
    },
  });

  const engineerBajaj = await prisma.user.create({
    data: {
      id: 'b50a29e4-bcde-4211-8fa1-71ca36df2099',
      email: 'engineer.bajaj@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Eli Engineer',
      role: 'SERVICE_ENGINEER',
      companyId: companyBajaj.id,
    },
  });

  const managerBajaj = await prisma.user.create({
    data: {
      id: 'a50a29e4-bcde-4211-8fa1-71ca36df2099',
      email: 'manager.bajaj@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Factory Manager',
      role: 'FACTORY_MANAGER',
      companyId: companyBajaj.id,
    },
  });

  const dealerBajaj = await prisma.user.create({
    data: {
      id: '950a29e4-bcde-4211-8fa1-71ca36df2099',
      email: 'dealer.bajaj@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Dealer',
      role: 'DEALER',
      companyId: companyBajaj.id,
    },
  });

  const ownerBajaj = await prisma.user.create({
    data: {
      id: '850a29e4-bcde-4211-8fa1-71ca36df2099',
      email: 'owner.bajaj@company.com',
      passwordHash: 'SecurePassword123',
      name: 'Vehicle Owner',
      role: 'VEHICLE_OWNER',
      companyId: companyBajaj.id,
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

  const defectBajaj1 = await prisma.defectMaster.create({
    data: {
      id: '782f9d1a-be10-4bf6-82bd-02c3a5ef5999',
      name: 'Brake System Fluid Leak',
      category: 'Brake System',
      severity: 'CRITICAL',
      defaultAssigneeRole: 'QUALITY_INSPECTOR',
      ownerVisible: true,
      soundProfile: 'CRITICAL',
      companyId: companyBajaj.id,
    },
  });

  const defectBajaj2 = await prisma.defectMaster.create({
    data: {
      id: '123f9d1a-be10-4bf6-82bd-02c3a5ef5999',
      name: 'Engine Overheating',
      category: 'Engine',
      severity: 'HIGH',
      defaultAssigneeRole: 'SERVICE_ENGINEER',
      ownerVisible: true,
      soundProfile: 'HIGH',
      companyId: companyBajaj.id,
    },
  });

  const defectBajaj3 = await prisma.defectMaster.create({
    data: {
      id: '223f9d1a-be10-4bf6-82bd-02c3a5ef5999',
      name: 'Assembly Line Calibration Failure',
      category: 'Assembly',
      severity: 'CRITICAL',
      defaultAssigneeRole: 'WORKER',
      ownerVisible: true,
      soundProfile: 'CRITICAL',
      companyId: companyBajaj.id,
    },
  });

  const defectBajaj4 = await prisma.defectMaster.create({
    data: {
      id: '323f9d1a-be10-4bf6-82bd-02c3a5ef5999',
      name: 'Transmission Sensor Fault',
      category: 'Transmission',
      severity: 'MEDIUM',
      defaultAssigneeRole: 'SUPERVISOR',
      ownerVisible: true,
      soundProfile: 'MEDIUM',
      companyId: companyBajaj.id,
    },
  });

  const defectBajaj5 = await prisma.defectMaster.create({
    data: {
      id: '423f9d1a-be10-4bf6-82bd-02c3a5ef5999',
      name: 'Windshield Fluid Low',
      category: 'Cabin',
      severity: 'LOW',
      defaultAssigneeRole: 'WORKER',
      ownerVisible: true,
      soundProfile: 'LOW',
      companyId: companyBajaj.id,
    },
  });

  // 4. Create Alerts
  // Alert 1: CRITICAL - Brake System Fluid Leak (assigned to QUALITY_INSPECTOR role)
  await prisma.alert.create({
    data: {
      id: 'cfa3410c-99a3-48ee-bd73-c1ea29b8de01',
      vin: 'MALXW35848DJ29103',
      companyId: companyAlpha.id,
      defectId: defectAlpha1.id,
      defectName: 'Brake System Fluid Leak',
      severity: 'CRITICAL',
      status: 'OPEN',
      assignedToUserId: inspectorAlpha.id,
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
      defectName: 'Assembly Line Calibration Failure',
      severity: 'CRITICAL',
      status: 'OPEN',
      assignedToUserId: workerAlpha.id,
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
      defectName: 'Transmission Sensor Fault',
      severity: 'MEDIUM',
      status: 'OPEN',
      assignedToUserId: supervisorAlpha.id,
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
      defectName: 'Engine Overheating',
      severity: 'HIGH',
      status: 'IN_PROGRESS',
      assignedToUserId: engineerAlpha.id,
      assignedToRole: 'SERVICE_ENGINEER',
    },
  });

  // Alert 5: LOW - Windshield Fluid Low (assigned to WORKER role)
  await prisma.alert.create({
    data: {
      id: 'afa3410c-99a3-48ee-bd73-c1ea29b8de07',
      vin: 'MALXW35848DJ29108',
      companyId: companyAlpha.id,
      defectId: defectAlpha5.id,
      defectName: 'Windshield Fluid Low',
      severity: 'LOW',
      status: 'OPEN',
      assignedToUserId: workerAlpha.id,
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
      defectName: 'Tire Pressure Low',
      severity: 'LOW',
      status: 'OPEN',
      assignedToUserId: adminBeta.id,
      assignedToRole: 'WORKER',
    },
  });

  // Alert 7: CRITICAL - Brake Fluid Leak in Bajaj (routed to QUALITY_INSPECTOR role)
  const bajajAlert1 = await prisma.alert.create({
    data: {
      id: 'cfa3410c-99a3-48ee-bd73-c1ea29b8de99',
      vin: 'MALXW35848DJ29199',
      companyId: companyBajaj.id,
      defectId: defectBajaj1.id,
      defectName: 'Brake System Fluid Leak',
      severity: 'CRITICAL',
      status: 'OPEN',
      assignedToUserId: inspectorBajaj.id,
      assignedToRole: 'QUALITY_INSPECTOR',
    },
  });

  // Alert 8: CRITICAL - Assembly Calibration in Bajaj (assigned to WORKER role)
  const bajajAlert2 = await prisma.alert.create({
    data: {
      id: 'dfa3410c-99a3-48ee-bd73-c1ea29b8de99',
      vin: 'MALXW35848DJ29299',
      companyId: companyBajaj.id,
      defectId: defectBajaj3.id,
      defectName: 'Assembly Line Calibration Failure',
      severity: 'CRITICAL',
      status: 'OPEN',
      assignedToUserId: workerBajaj.id,
      assignedToRole: 'WORKER',
    },
  });

  // Alert 9: MEDIUM - Transmission Fault in Bajaj (assigned to SUPERVISOR role)
  const bajajAlert3 = await prisma.alert.create({
    data: {
      id: 'efa3410c-99a3-48ee-bd73-c1ea29b8de99',
      vin: 'MALXW35848DJ29399',
      companyId: companyBajaj.id,
      defectId: defectBajaj4.id,
      defectName: 'Transmission Sensor Fault',
      severity: 'MEDIUM',
      status: 'OPEN',
      assignedToUserId: supervisorBajaj.id,
      assignedToRole: 'SUPERVISOR',
    },
  });

  // Alert 10: HIGH - Engine Overheating in Bajaj (assigned directly to engineerBajaj)
  await prisma.alert.create({
    data: {
      id: 'ffa3410c-99a3-48ee-bd73-c1ea29b8de99',
      vin: 'MALXW35848DJ29499',
      companyId: companyBajaj.id,
      defectId: defectBajaj2.id,
      defectName: 'Engine Overheating',
      severity: 'HIGH',
      status: 'IN_PROGRESS',
      assignedToUserId: engineerBajaj.id,
      assignedToRole: 'SERVICE_ENGINEER',
    },
  });

  // Alert 11: LOW - Windshield Fluid Low in Bajaj (assigned to WORKER role)
  await prisma.alert.create({
    data: {
      id: 'afa3410c-99a3-48ee-bd73-c1ea29b8de99',
      vin: 'MALXW35848DJ29599',
      companyId: companyBajaj.id,
      defectId: defectBajaj5.id,
      defectName: 'Windshield Fluid Low',
      severity: 'LOW',
      status: 'OPEN',
      assignedToUserId: workerBajaj.id,
      assignedToRole: 'WORKER',
    },
  });

  // 4b. Seed timeline events
  console.log('Seeding DefectResolutionTimeline audit logs...');
  await prisma.defectResolutionTimeline.create({
    data: {
      alertId: 'cfa3410c-99a3-48ee-bd73-c1ea29b8de99',
      actionType: 'INGESTION',
      details: 'Defect event ingested from Inspection Vision System (Brake Fluid Leak).',
    }
  });
  await prisma.defectResolutionTimeline.create({
    data: {
      alertId: 'cfa3410c-99a3-48ee-bd73-c1ea29b8de99',
      actionType: 'ASSIGNED',
      performedByUserId: bajajAdmin.id,
      details: 'S Bodkhe (COMPANY_ADMIN) assigned defect task to Ian Inspector (QUALITY_INSPECTOR).',
    }
  });
  await prisma.defectResolutionTimeline.create({
    data: {
      alertId: 'ffa3410c-99a3-48ee-bd73-c1ea29b8de99',
      actionType: 'INGESTION',
      details: 'Defect event ingested from Inspection vision system (Engine Overheating).',
    }
  });
  await prisma.defectResolutionTimeline.create({
    data: {
      alertId: 'ffa3410c-99a3-48ee-bd73-c1ea29b8de99',
      actionType: 'TAKEOVER',
      performedByUserId: engineerBajaj.id,
      details: 'Eli Engineer (SERVICE_ENGINEER) took over the alert.',
    }
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

  // 6. Pre-seed notifications for Bajaj users
  console.log('Seeding Bajaj notifications...');
  const companyBajajUsers = [bajajAdmin.id, supervisorBajaj.id, workerBajaj.id, inspectorBajaj.id, engineerBajaj.id, managerBajaj.id, dealerBajaj.id, ownerBajaj.id];
  for (const userId of companyBajajUsers) {
    await prisma.notification.create({
      data: {
        companyId: companyBajaj.id,
        userId: userId,
        alertId: bajajAlert2.id,
        title: 'Defect Task Handover',
        message: 'John Doe (SUPERVISOR) has taken over Joe Worker (WORKER)\'s defect task \'Assembly Line Calibration Failure\' on VIN MALXW35848DJ29299.',
        channel: 'IN_APP',
        isRead: false,
      }
    });

    await prisma.notification.create({
      data: {
        companyId: companyBajaj.id,
        userId: userId,
        alertId: bajajAlert3.id,
        title: 'Defect Task Resolved',
        message: 'Joe Worker (WORKER) has resolved John Doe (SUPERVISOR)\'s defect task \'Transmission Sensor Fault\' on VIN MALXW35848DJ29399.',
        channel: 'IN_APP',
        isRead: false,
      }
    });

    await prisma.notification.create({
      data: {
        companyId: companyBajaj.id,
        userId: userId,
        title: 'Defect Task Assignment',
        message: 'S Bodkhe (COMPANY_ADMIN) assigned defect task \'Brake System Fluid Leak\' to Ian Inspector (QUALITY_INSPECTOR).',
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
