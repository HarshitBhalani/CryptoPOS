import { IsNotEmpty, IsString } from "class-validator";

export class UpdateMerchantWalletDto {
  @IsString()
  @IsNotEmpty({ message: "Settlement address is required" })
  settlementAddress!: string;
}
