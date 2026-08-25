import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'jwt_token_here', description: 'Reset password JWT token' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'user_uuid_here', description: 'User ID' })
  @IsString()
  @IsNotEmpty()
  uid: string;

  @ApiProperty({ example: 'newpassword123', description: 'New password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  passwordHash: string;
}
