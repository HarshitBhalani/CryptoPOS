import { UserRole } from "@prisma/client";

export type AccessClaims = { sub: string; role: UserRole; type: "access" };
export type RefreshClaims = { sub: string; type: "refresh"; jti: string };
export type AuthenticatedUser = { id: string; role: UserRole };

export const ACCESS_COOKIE = "cryptopos_access";
export const REFRESH_COOKIE = "cryptopos_refresh";
