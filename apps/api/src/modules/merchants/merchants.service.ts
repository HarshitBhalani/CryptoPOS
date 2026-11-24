import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { UpdateMerchantSettingsDto } from "./dto/update-merchant-settings.dto";
import { DEVNET_NETWORK, SUPPORTED_DEVNET_TOKEN } from "../../blockchain/solana.constants";
import { assertValidSolanaAddress } from "../../blockchain/solana.validator";

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true, businessType: true, status: true, settlementAddr: true, createdAt: true },
    });
    if (!merchant) throw new NotFoundException("Merchant not found");
    return this.formatMerchantResponse(merchant);
  }

  async updateSettings(merchantId: string, dto: UpdateMerchantSettingsDto) {
    if (dto.name === undefined && dto.businessType === undefined && dto.settlementAddress === undefined) {
      throw new BadRequestException("Provide a business name, business type, or settlement address to update");
    }

    let normalizedAddress: string | null = null;
    if (dto.settlementAddress !== undefined) {
      const raw = dto.settlementAddress?.trim() ?? "";
      if (raw.length > 0) {
        assertValidSolanaAddress(raw, "Settlement address");
        normalizedAddress = raw;
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (normalizedAddress !== null) {
          const conflictingWallet = await tx.wallet.findFirst({
            where: { network: DEVNET_NETWORK, address: normalizedAddress, merchantId: { not: merchantId } },
          });
          if (conflictingWallet) {
            throw new ConflictException("This settlement address is already registered to another merchant");
          }
        }

        const updated = await tx.merchant.update({
          where: { id: merchantId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.businessType !== undefined ? { businessType: dto.businessType.trim() || null } : {}),
            ...(dto.settlementAddress !== undefined ? { settlementAddr: normalizedAddress } : {}),
          },
          select: { id: true, name: true, businessType: true, status: true, settlementAddr: true, createdAt: true },
        });

        if (dto.settlementAddress !== undefined) {
          if (normalizedAddress) {
            const existing = await tx.wallet.findFirst({ where: { merchantId, network: DEVNET_NETWORK } });
            if (existing) {
              await tx.wallet.update({
                where: { id: existing.id },
                data: { address: normalizedAddress, purpose: "SETTLEMENT" },
              });
            } else {
              await tx.wallet.create({
                data: { merchantId, network: DEVNET_NETWORK, address: normalizedAddress, purpose: "SETTLEMENT" },
              });
            }
          } else {
            await tx.wallet.deleteMany({ where: { merchantId, network: DEVNET_NETWORK } });
          }
        }

        return this.formatMerchantResponse(updated);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new NotFoundException("Merchant not found");
      }
      throw error;
    }
  }

  async getWallet(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, settlementAddr: true },
    });
    if (!merchant) throw new NotFoundException("Merchant not found");
    return {
      settlementAddress: merchant.settlementAddr,
      network: DEVNET_NETWORK,
      isConfigured: Boolean(merchant.settlementAddr),
      token: SUPPORTED_DEVNET_TOKEN,
    };
  }

  async updateWallet(merchantId: string, settlementAddress: string) {
    const trimmed = (settlementAddress ?? "").trim();
    assertValidSolanaAddress(trimmed, "Settlement address");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const conflictingWallet = await tx.wallet.findFirst({
          where: { network: DEVNET_NETWORK, address: trimmed, merchantId: { not: merchantId } },
        });
        if (conflictingWallet) {
          throw new ConflictException("This settlement address is already registered to another merchant");
        }

        const merchant = await tx.merchant.update({
          where: { id: merchantId },
          data: { settlementAddr: trimmed },
          select: { id: true, settlementAddr: true },
        });

        const existing = await tx.wallet.findFirst({ where: { merchantId, network: DEVNET_NETWORK } });
        if (existing) {
          await tx.wallet.update({
            where: { id: existing.id },
            data: { address: trimmed, purpose: "SETTLEMENT" },
          });
        } else {
          await tx.wallet.create({
            data: { merchantId, network: DEVNET_NETWORK, address: trimmed, purpose: "SETTLEMENT" },
          });
        }

        return {
          settlementAddress: merchant.settlementAddr,
          network: DEVNET_NETWORK,
          isConfigured: true,
          token: SUPPORTED_DEVNET_TOKEN,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new NotFoundException("Merchant not found");
      }
      throw error;
    }
  }

  async removeWallet(merchantId: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.merchant.update({
          where: { id: merchantId },
          data: { settlementAddr: null },
        });
        await tx.wallet.deleteMany({ where: { merchantId, network: DEVNET_NETWORK } });
      });

      return {
        settlementAddress: null,
        network: DEVNET_NETWORK,
        isConfigured: false,
        token: SUPPORTED_DEVNET_TOKEN,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new NotFoundException("Merchant not found");
      }
      throw error;
    }
  }

  listMembers(merchantId: string) {
    return this.prisma.merchantMember.findMany({
      where: { merchantId },
      select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async addCashier(merchantId: string, email: string, actorId: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const [merchant, user] = await Promise.all([
      this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
    ]);
    if (!merchant || !user) throw new NotFoundException("Merchant or registered user not found");
    if (user.id === actorId) throw new ConflictException("Owner cannot add themselves as cashier");
    try {
      return await this.prisma.merchantMember.create({
        data: { merchantId, userId: user.id, role: "CASHIER" },
        select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("User already belongs to this merchant");
      throw error;
    }
  }

  private formatMerchantResponse(merchant: { id: string; name: string; businessType: string | null; status: string; settlementAddr: string | null; createdAt: Date }) {
    return {
      id: merchant.id,
      name: merchant.name,
      businessType: merchant.businessType,
      status: merchant.status,
      settlementAddr: merchant.settlementAddr,
      settlementWallet: {
        address: merchant.settlementAddr,
        network: DEVNET_NETWORK,
        isConfigured: Boolean(merchant.settlementAddr),
        token: SUPPORTED_DEVNET_TOKEN,
      },
      createdAt: merchant.createdAt,
    };
  }
}
