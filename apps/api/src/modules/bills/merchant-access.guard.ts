import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../prisma.service";

@Injectable()
export class MerchantAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { merchantId } = request.params;
    const user = request.user;
    if (!merchantId || !user?.id) throw new NotFoundException("Merchant not found");
    if (user.role === UserRole.PLATFORM_ADMIN) {
      const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { status: true } });
      if (!merchant) throw new NotFoundException("Merchant not found");
      if (merchant.status !== "ACTIVE") throw new ForbiddenException("Merchant account is suspended");
      request.merchantRole = UserRole.PLATFORM_ADMIN;
      return true;
    }
    const membership = await this.prisma.merchantMember.findUnique({
      where: { userId_merchantId: { userId: user.id, merchantId } },
      include: { merchant: { select: { status: true } } },
    });
    if (!membership) throw new NotFoundException("Merchant not found");
    if (membership.merchant.status !== "ACTIVE") throw new ForbiddenException("Merchant account is suspended");
    request.merchantRole = membership.role;
    return true;
  }
}
