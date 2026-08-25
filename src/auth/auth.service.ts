import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

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
    
    // Support both bcrypt hashed passwords and legacy plaintext passwords
    let passwordIsValid = false;
    if (user.passwordHash.startsWith('$2a$') || user.passwordHash.startsWith('$2b$')) {
      passwordIsValid = await bcrypt.compare(incomingPassword, user.passwordHash);
    } else {
      passwordIsValid = user.passwordHash === incomingPassword;
    }

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

  async forgotPassword(email: string, companyId: string, requestHost: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: email.trim().toLowerCase(),
          mode: 'insensitive',
        },
        companyId,
      },
    });

    if (!user) {
      // Return success message to prevent user enumeration
      return { success: true, message: 'If this email exists, a reset link has been sent.' };
    }

    // Create a JWT payload containing user details
    const payload = {
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      currentPasswordHash: user.passwordHash,
      action: 'reset-password'
    };

    // Sign a JWT token that expires in 15 minutes
    const token = this.jwtService.sign(payload, { expiresIn: '15m' });

    const protocol = requestHost.includes('localhost') || requestHost.includes('127.0.0.1') || requestHost.includes('192.168.') ? 'http' : 'https';
    // Link format: token=PLAIN_TOKEN&uid=USER_ID
    const resetLink = `${protocol}://${requestHost}/api/v1/auth/reset-password-page?token=${token}&uid=${user.id}`;

    console.log(`[Forgot Password] Generated reset link: ${resetLink}`);

    await this.sendResetEmail(user.email, user.name, resetLink);

    return { success: true, message: 'If this email exists, a reset link has been sent.' };
  }

  async sendResetEmail(toEmail: string, userName: string, resetLink: string) {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpSecure = process.env.SMTP_SECURE === 'true';
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || 'noreply@vams-app.com';

    let transporter;
    if (smtpHost && smtpUser && smtpPass) {
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    } else {
      console.warn('[SMTP] SMTP variables not configured. Creating Ethereal Email test account fallback...');
      try {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
        console.log(`[SMTP] Created Ereal account: ${testAccount.user}`);
      } catch (err) {
        console.error('[SMTP] Failed to create Ethereal account. Using logs only.', err);
        return;
      }
    }

    const mailOptions = {
      from: smtpFrom,
      to: toEmail,
      subject: 'Reset your VAMS password',
      text: `Hello ${userName},\n\nYou requested a password reset. Please use the following link to reset your password:\n\n${resetLink}\n\nThis link will expire in 15 minutes.\n\nIf you did not request this, please ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #fafafa;">
          <h2 style="color: #2F80ED; text-align: center;">Reset your VAMS password</h2>
          <p>Hello <strong>${userName}</strong>,</p>
          <p>You requested a password reset for your VAMS account. Click the button below to set a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #2F80ED; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          <hr style="border: 0; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
          <p style="color: #828282; font-size: 12px; text-align: center;">This link will expire in 15 minutes. If you did not make this request, you can safely ignore this email.</p>
        </div>
      `,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[SMTP] Password reset email sent: ${info.messageId}`);
      if (!smtpHost) {
        console.log(`[SMTP] Ethereal Message URL: ${nodemailer.getTestMessageUrl(info)}`);
      }
    } catch (err) {
      console.error('[SMTP] Error sending reset email:', err);
    }
  }

  async verifyResetTokenAndUid(token: string, userId: string) {
    try {
      const decoded = this.jwtService.verify(token);
      if (decoded.action !== 'reset-password') {
        throw new Error('Invalid token purpose');
      }
      if (decoded.sub !== userId) {
        throw new Error('User ID mismatch');
      }

      // Check if user exists and password has NOT been changed yet
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      if (user.passwordHash !== decoded.currentPasswordHash) {
        throw new Error('Link has already been used or password was reset.');
      }

      return decoded;
    } catch (err) {
      throw new UnauthorizedException(err.message || 'Invalid or expired token.');
    }
  }

  async resetPassword(token: string, userId: string, newPasswordRaw: string) {
    // Validate token and uid status
    const decoded = await this.verifyResetTokenAndUid(token, userId);

    // Securely hash the password using bcryptjs
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPasswordRaw, salt);

    // Update password in DB
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hashed,
      },
    });

    // Force re-login: Invalidate all existing device sessions/tokens for that user
    await this.prisma.userDeviceToken.deleteMany({
      where: { userId },
    });

    // Clear legacy single fcmToken field
    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: null },
    });

    return { success: true, message: 'Password has been reset successfully.' };
  }
}
