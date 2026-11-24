import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { MerchantStatus, Prisma, UserRole } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { AccessClaims, AuthenticatedUser, RefreshClaims } from "./auth.types";

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const merchant = await tx.merchant.create({ data: { name: input.businessName.trim(), businessType: input.businessType?.trim() || null } });
        const created = await tx.user.create({ data: { email, name: input.name.trim(), passwordHash, role: UserRole.OWNER } });
        await tx.merchantMember.create({ data: { userId: created.id, merchantId: merchant.id, role: UserRole.OWNER } });
        return created;
      });
      return this.startSession(user.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("An account with this email already exists");
      }
      throw error;
    }
  }

  async login(input: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      include: { memberships: { include: { merchant: { select: { status: true } } } } },
    });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new UnauthorizedException("Email or password is incorrect");
    if (user.role !== UserRole.PLATFORM_ADMIN && (!user.memberships.length || user.memberships.every((m) => m.merchant.status === MerchantStatus.SUSPENDED))) {
      throw new UnauthorizedException("Account is unavailable");
    }
    return this.startSession(user.id);
  }

  async rotate(refreshToken: string | undefined) {
    const claims = await this.verifyRefresh(refreshToken);
    const tokenHash = this.hashToken(refreshToken!);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.userId !== claims.sub) throw new UnauthorizedException("Refresh session is invalid");
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { userId: claims.sub, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("Refresh token reuse detected; sign in again");
    }
    if (stored.expiresAt <= new Date()) throw new UnauthorizedException("Refresh session expired");

    const newRefreshToken = await this.signRefresh(claims.sub);
    const newHash = this.hashToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date(), replacedBy: newHash } });
      if (revoked.count !== 1) throw new UnauthorizedException("Refresh session already used");
      await tx.refreshToken.create({ data: { userId: claims.sub, tokenHash: newHash, expiresAt: newExpiresAt } });
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: claims.sub } });
    return { user: await this.publicUser(user.id), accessToken: await this.signAccess(user), refreshToken: newRefreshToken };
  }

  async logout(refreshToken?: string) {
    if (refreshToken) await this.prisma.refreshToken.updateMany({ where: { tokenHash: this.hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async currentUser(user: AuthenticatedUser) {
    const result = await this.publicUser(user.id);
    if (!result) throw new UnauthorizedException("Account no longer exists");
    return result;
  }

  private async startSession(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const refreshToken = await this.signRefresh(user.id);
    await this.prisma.refreshToken.create({ data: { userId, tokenHash: this.hashToken(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000) } });
    return { user: await this.publicUser(userId), accessToken: await this.signAccess(user), refreshToken };
  }

  private signAccess(user: { id: string; role: UserRole }) {
    const payload: AccessClaims = { sub: user.id, role: user.role, type: "access" };
    return this.jwt.signAsync(payload, { secret: this.config.getOrThrow<string>("JWT_SECRET"), expiresIn: ACCESS_TTL_SECONDS });
  }

  private signRefresh(userId: string) {
    const payload: RefreshClaims = { sub: userId, type: "refresh", jti: randomUUID() };
    return this.jwt.signAsync(payload, { secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"), expiresIn: REFRESH_TTL_SECONDS });
  }

  private async verifyRefresh(token?: string): Promise<RefreshClaims> {
    if (!token) throw new UnauthorizedException("Refresh session missing");
    try {
      const claims = await this.jwt.verifyAsync<RefreshClaims>(token, { secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET") });
      if (claims.type !== "refresh" || !claims.sub) throw new Error("Invalid token type");
      return claims;
    } catch {
      throw new UnauthorizedException("Refresh session expired or invalid");
    }
  }

  private async publicUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, memberships: { select: { role: true, merchant: { select: { id: true, name: true, status: true } } } } },
    });
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name, role: user.role, merchants: user.memberships.map(({ merchant, role }) => ({ ...merchant, role })) };
  }

  private hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
}
