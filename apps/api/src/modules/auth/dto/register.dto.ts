import { IsEmail, IsOptional, IsString, Length, MaxLength } from "class-validator";

export class RegisterDto {
  @IsString() @Length(2, 80) name!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @Length(12, 128) password!: string;
  @IsString() @Length(2, 120) businessName!: string;
  @IsOptional() @IsString() @MaxLength(80) businessType?: string;
}
