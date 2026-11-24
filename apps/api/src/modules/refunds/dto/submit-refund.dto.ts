import { IsNotEmpty, IsString, Length } from "class-validator";

export class SubmitRefundDto {
  @IsString()
  @IsNotEmpty()
  @Length(64, 88)
  signature!: string;
}
