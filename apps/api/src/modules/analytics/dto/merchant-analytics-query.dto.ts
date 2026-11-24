import { IsOptional, IsString } from "class-validator";

export class MerchantAnalyticsQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  tokenSymbol?: string;

  @IsOptional()
  @IsString()
  currency?: string;
}
