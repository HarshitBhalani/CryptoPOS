import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ACCESS_COOKIE, AuthenticatedUser, REFRESH_COOKIE } from "./auth.types";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { Roles } from "./roles.decorator";
import { RolesGuard } from "./roles.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}

  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() body: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.register(body);
    this.setCookies(response, session.accessToken, session.refreshToken);
    return { success: true, message: "Account created", data: { user: session.user } };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.login(body);
    this.setCookies(response, session.accessToken, session.refreshToken);
    return { success: true, message: "Signed in", data: { user: session.user } };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.rotate(request.cookies?.[REFRESH_COOKIE]);
    this.setCookies(response, session.accessToken, session.refreshToken);
    return { success: true, message: "Session refreshed", data: { user: session.user } };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[REFRESH_COOKIE]);
    const options = this.cookieOptions();
    response.clearCookie(ACCESS_COOKIE, { ...options, path: "/" });
    response.clearCookie(REFRESH_COOKIE, { ...options, path: "/api/v1/auth" });
    return { success: true, message: "Signed out", data: null };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN, UserRole.OWNER, UserRole.CASHIER)
  async me(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, message: "Current account", data: { user: await this.auth.currentUser(user) } };
  }

  private setCookies(response: Response, accessToken: string, refreshToken: string) {
    const options = this.cookieOptions();
    response.cookie(ACCESS_COOKIE, accessToken, { ...options, path: "/", maxAge: 60 * 60 * 1000 });
    response.cookie(REFRESH_COOKIE, refreshToken, { ...options, path: "/api/v1/auth", maxAge: 30 * 24 * 60 * 60 * 1000 });
  }

  private cookieOptions() {
    return { httpOnly: true, secure: this.config.get<string>("NODE_ENV") === "production", sameSite: "lax" as const };
  }
}
