import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class ReverseJournalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
