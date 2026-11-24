import { IsOptional, IsString, Length, MaxLength } from "class-validator";

export class UpdateMerchantSettingsDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @MaxLength(80) businessType?: string;
  @IsOptional() @IsString() settlementAddress?: string | null;
}
