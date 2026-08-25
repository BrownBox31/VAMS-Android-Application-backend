import { Controller, Post, Get, Body, Query, Res, HttpCode, HttpStatus, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RegisterDto, RegisterResponseDto } from './dto/register.dto';
import { UpdateDeviceTokenDto, UpdateDeviceTokenResponseDto } from './dto/update-device-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate user and return JWT access token' })
  @ApiResponse({ status: 200, description: 'JWT authentication successful' })
  @ApiResponse({ status: 401, description: 'Invalid login credentials' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User successfully registered', type: RegisterResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed or missing fields' })
  @ApiResponse({ status: 409, description: 'Conflict: Email already exists' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('device-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update/register user FCM device token' })
  @ApiResponse({ status: 200, description: 'Device token successfully updated', type: UpdateDeviceTokenResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateDeviceToken(@Request() req: any, @Body() updateDeviceTokenDto: UpdateDeviceTokenDto) {
    return this.authService.updateDeviceToken(req.user.id, updateDeviceTokenDto.token);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and deactivate device push token' })
  @ApiResponse({ status: 200, description: 'Successfully logged out and token removed' })
  async logout(@Request() req: any, @Body() body: { token?: string }) {
    if (body.token) {
      await this.authService.removeDeviceToken(req.user.id, body.token);
    }
    return { success: true };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset link' })
  @ApiResponse({ status: 200, description: 'Reset email dispatched if user exists' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto, @Request() req: any) {
    const host = req.headers.host || 'localhost:3000';
    return this.authService.forgotPassword(forgotPasswordDto.email, forgotPasswordDto.companyId, host);
  }

  @Get('reset-password-page')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Serve the password reset webpage' })
  async resetPasswordPage(@Query('token') token: string, @Query('uid') uid: string, @Res() res: any) {
    try {
      await this.authService.verifyResetTokenAndUid(token, uid);
    } catch (err) {
      return res.status(HttpStatus.UNAUTHORIZED).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Password Link Expired - VAMS</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); color: #f8fafc; min-height: 100vh; display: flex; justify-content: center; align-items: center; text-align: center; margin: 0; padding: 20px; }
            .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.1); padding: 40px; border-radius: 24px; max-width: 440px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); }
            h1 { font-size: 22px; color: #f43f5e; margin-bottom: 12px; }
            p { font-size: 14px; color: #94a3b8; line-height: 1.5; }
            .logo { font-size: 28px; font-weight: 800; background: linear-gradient(to right, #3b82f6, #6366f1); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 24px; display: inline-block; }
          </style>
        </head>
        <body>
          <div class="card">
            <span class="logo">VAMS SYSTEM</span>
            <h1>Invalid or Expired Link</h1>
            <p>This password reset link is invalid or has expired. Please request a new password reset from the VAMS mobile application.</p>
          </div>
        </body>
        </html>
      `);
    }

    return res.status(HttpStatus.OK).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Password - VAMS</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            --card-bg: rgba(30, 41, 59, 0.7);
            --border-color: rgba(255, 255, 255, 0.1);
            --primary: #3b82f6;
            --primary-hover: #2563eb;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --success: #10b981;
            --error: #f43f5e;
          }
          
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          
          body {
            font-family: 'Inter', sans-serif;
            background: var(--bg-gradient);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            color: var(--text-main);
            overflow: hidden;
            position: relative;
          }

          body::before {
            content: '';
            position: absolute;
            width: 300px;
            height: 300px;
            background: rgba(59, 130, 246, 0.15);
            border-radius: 50%;
            top: 15%;
            left: 15%;
            filter: blur(80px);
            z-index: 0;
          }

          body::after {
            content: '';
            position: absolute;
            width: 400px;
            height: 400px;
            background: rgba(99, 102, 241, 0.15);
            border-radius: 50%;
            bottom: 15%;
            right: 15%;
            filter: blur(100px);
            z-index: 0;
          }
          
          .card {
            background: var(--card-bg);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid var(--border-color);
            padding: 40px;
            border-radius: 24px;
            width: 100%;
            max-width: 440px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            z-index: 10;
            position: relative;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          }
          
          .logo-container {
            text-align: center;
            margin-bottom: 24px;
          }
          
          .logo-text {
            font-size: 28px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(to right, #3b82f6, #6366f1);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          
          h1 {
            font-size: 20px;
            font-weight: 600;
            text-align: center;
            margin-bottom: 8px;
          }
          
          .subtitle {
            font-size: 14px;
            color: var(--text-muted);
            text-align: center;
            margin-bottom: 32px;
          }
          
          .input-group {
            margin-bottom: 24px;
            position: relative;
          }
          
          label {
            display: block;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            margin-bottom: 8px;
          }
          
          .input-wrapper {
            position: relative;
            display: flex;
            align-items: center;
          }
          
          input {
            width: 100%;
            padding: 14px 16px;
            padding-right: 48px;
            border-radius: 12px;
            border: 1px solid var(--border-color);
            background: rgba(15, 23, 42, 0.4);
            color: var(--text-main);
            font-size: 15px;
            outline: none;
            transition: all 0.2s ease;
          }
          
          input:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
          }
          
          .eye-btn {
            position: absolute;
            right: 14px;
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px;
            transition: color 0.2s;
          }
          
          .eye-btn:hover {
            color: var(--text-main);
          }
          
          .btn {
            width: 100%;
            padding: 14px;
            background: var(--primary);
            border: none;
            border-radius: 12px;
            color: white;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            justify-content: center;
            align-items: center;
            position: relative;
            overflow: hidden;
          }
          
          .btn:hover {
            background: var(--primary-hover);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
            transform: translateY(-1px);
          }

          .btn:active {
            transform: translateY(0);
          }
          
          .btn:disabled {
            background: var(--text-muted);
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
          }

          .loader {
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 0.8s linear infinite;
            display: none;
          }

          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          
          .feedback {
            margin-top: 16px;
            font-size: 13px;
            border-radius: 10px;
            display: none;
            align-items: center;
            gap: 10px;
          }
          
          .feedback.error {
            display: flex;
            color: var(--error);
            background: rgba(244, 63, 94, 0.1);
            border: 1px solid rgba(244, 63, 94, 0.2);
            padding: 12px;
          }

          .feedback.success {
            display: flex;
            color: var(--success);
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.2);
            padding: 12px;
          }

          .success-view {
            display: none;
            flex-direction: column;
            align-items: center;
            text-align: center;
            animation: fadeIn 0.4s ease forwards;
          }

          .checkmark-circle {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background: rgba(16, 185, 129, 0.1);
            border: 2px solid var(--success);
            display: flex;
            justify-content: center;
            align-items: center;
            margin-bottom: 24px;
            color: var(--success);
            font-size: 32px;
            animation: pulse 2s infinite;
          }

          @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
            100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
          }

          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        </style>
      </head>
      <body>
        <div class="card" id="form-card">
          <div class="logo-container">
            <span class="logo-text">VAMS SYSTEM</span>
          </div>
          
          <div id="reset-form-container">
            <h1>Reset Password</h1>
            <p class="subtitle">Please enter your new password below.</p>
            
            <form id="reset-form" onsubmit="handleSubmit(event)">
              <div class="input-group">
                <label for="password">New Password</label>
                <div class="input-wrapper">
                  <input type="password" id="password" required minlength="6" placeholder="At least 6 characters">
                  <button type="button" class="eye-btn" onclick="togglePassword('password')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                  </button>
                </div>
              </div>
              
              <div class="input-group">
                <label for="confirm-password">Confirm Password</label>
                <div class="input-wrapper">
                  <input type="password" id="confirm-password" required minlength="6" placeholder="Repeat password">
                  <button type="button" class="eye-btn" onclick="togglePassword('confirm-password')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                  </button>
                </div>
              </div>
              
              <button type="submit" class="btn" id="submit-btn">
                <span id="btn-text">Reset Password</span>
                <div class="loader" id="btn-loader"></div>
              </button>
            </form>
            
            <div class="feedback error" id="feedback-error"></div>
          </div>

          <div class="success-view" id="success-view">
            <div class="checkmark-circle">✓</div>
            <h1>Password Updated</h1>
            <p class="subtitle" style="margin-bottom: 0;">Your password has been changed successfully. You can now close this tab and sign in using your new credentials in the VAMS application.</p>
          </div>
        </div>

        <script>
          const urlParams = new URLSearchParams(window.location.search);
          const token = urlParams.get('token');
          const uid = urlParams.get('uid');
          
          if (!token || !uid) {
            document.getElementById('reset-form-container').style.display = 'none';
            const errorDiv = document.getElementById('feedback-error');
            errorDiv.innerText = 'Error: Invalid or missing parameters.';
            errorDiv.style.display = 'flex';
          }

          function togglePassword(inputId) {
            const input = document.getElementById(inputId);
            input.type = input.type === 'password' ? 'text' : 'password';
          }

          async function handleSubmit(event) {
            event.preventDefault();
            
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            const errorDiv = document.getElementById('feedback-error');
            const submitBtn = document.getElementById('submit-btn');
            const btnText = document.getElementById('btn-text');
            const btnLoader = document.getElementById('btn-loader');
            
            errorDiv.style.display = 'none';
            
            if (password !== confirmPassword) {
              errorDiv.innerText = 'Passwords do not match.';
              errorDiv.style.display = 'flex';
              return;
            }
            
            submitBtn.disabled = true;
            btnText.style.display = 'none';
            btnLoader.style.display = 'block';
            
            try {
              const response = await fetch('/api/v1/auth/reset-password', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token, uid, passwordHash: password })
              });
              
              const data = await response.json();
              
              if (response.ok) {
                document.getElementById('reset-form-container').style.display = 'none';
                document.getElementById('success-view').style.display = 'flex';
              } else {
                throw new Error(data.message || 'Failed to reset password.');
              }
            } catch (err) {
              errorDiv.innerText = err.message || 'An error occurred. Please try again.';
              errorDiv.style.display = 'flex';
              
              submitBtn.disabled = false;
              btnText.style.display = 'block';
              btnLoader.style.display = 'none';
            }
          }
        </script>
      </body>
      </html>
    `);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset a user password' })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto.token, resetPasswordDto.uid, resetPasswordDto.passwordHash);
  }
}
