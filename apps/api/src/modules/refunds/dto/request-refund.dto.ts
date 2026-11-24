import { IsNotEmpty, IsOptional, IsString, MaxLength, Matches } from "class-validator";

export class RequestRefundDto {
  @IsString()
  @IsNotEmpty()
  verifiedTxId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: "amountUnits must be an exact positive integer string" })
  amountUnits!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  destinationWallet?: string;
}
