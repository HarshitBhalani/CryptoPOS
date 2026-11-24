import { IsEnum, IsOptional, IsString } from "class-validator";
import { MerchantStatus } from "@prisma/client";

export class ListMerchantsQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(MerchantStatus)
  status?: MerchantStatus;
}
