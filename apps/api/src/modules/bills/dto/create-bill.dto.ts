import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, ValidateNested } from "class-validator";

const amountPattern = /^\d{1,12}(?:\.\d{1,6})?$/;

export class BillItemDto {
  @IsString() @Length(1, 160) description!: string;
  @IsString() @Matches(amountPattern, { message: "quantity must be a positive decimal with up to 6 places" }) quantity!: string;
  @IsString() @Matches(amountPattern, { message: "unitPrice must be a non-negative decimal with up to 6 places" }) unitPrice!: string;
}

export class CreateBillDto {
  @IsIn(["USD", "AUD", "CAD", "EUR", "GBP", "INR"]) currency!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(100) customerName?: string;
  @IsOptional() @IsEmail() @MaxLength(254) customerEmail?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,3}(?:\.\d{1,4})?$/, { message: "taxRate must be between 0 and 100 percent" }) taxRate?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => BillItemDto) items!: BillItemDto[];
}
