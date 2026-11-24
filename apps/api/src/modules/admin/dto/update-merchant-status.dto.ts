import { IsEnum, IsNotEmpty, IsString, MinLength } from "class-validator";
import { MerchantStatus } from "@prisma/client";

export class UpdateMerchantStatusDto {
  @IsEnum(MerchantStatus)
  status: MerchantStatus;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}
