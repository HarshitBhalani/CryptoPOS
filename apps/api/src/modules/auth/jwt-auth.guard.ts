import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { ACCESS_COOKIE, AccessClaims } from "./auth.types";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;
    const token = request.cookies?.[ACCESS_COOKIE] ?? (authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined);
    if (!token) throw new UnauthorizedException("Authentication required");
    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(token, { secret: this.config.getOrThrow<string>("JWT_SECRET") });
      if (claims.type !== "access" || !claims.sub || !claims.role) throw new Error("Invalid access token");
      request.user = { id: claims.sub, role: claims.role };
      return true;
    } catch {
      throw new UnauthorizedException("Session expired or invalid");
    }
  }
}
