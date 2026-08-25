import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@tata.com', description: 'The user email address' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Tata Motors', description: 'The company ID or name' })
  @IsString()
  @IsNotEmpty()
  companyId: string;
}
