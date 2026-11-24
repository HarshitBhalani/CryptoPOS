import { IsEnum, IsOptional, IsString, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { JournalType } from "@prisma/client";

export class ListJournalsQueryDto {
  @IsOptional()
  @IsString()
  billId?: string;

  @IsOptional()
  @IsEnum(JournalType)
  type?: JournalType;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
