import { Controller, Post, Body, HttpCode, HttpStatus, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RegisterDto, RegisterResponseDto } from './dto/register.dto';
import { UpdateDeviceTokenDto, UpdateDeviceTokenResponseDto } from './dto/update-device-token.dto';

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
}
