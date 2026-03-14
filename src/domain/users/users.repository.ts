import { Injectable } from '@nestjs/common';
import { Role } from 'generated/prisma/client';
import { PrismaService } from 'src/prisma.service';

// Fields returned on every user response — never expose password or session data
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  banned: true,
  banReason: true,
  createdAt: true,
  updatedAt: true,
  tenantId: true,
} as const;

@Injectable()
export class UserRepository {
  constructor(private prisma: PrismaService) {}

  async findByTenant(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: USER_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string, tenantId: string) {
    return this.prisma.user.findUnique({
      where: { id, tenantId },
      select: USER_SELECT,
    });
  }

  async updateInfo(id: string, tenantId: string, data: { name?: string; email?: string }) {
    return this.prisma.user.update({
      where: { id, tenantId },
      data,
      select: USER_SELECT,
    });
  }

  async updateRole(id: string, tenantId: string, role: Role) {
    return this.prisma.user.update({
      where: { id, tenantId },
      data: { role },
      select: USER_SELECT,
    });
  }

  async deactivate(id: string, tenantId: string) {
    return this.prisma.user.update({
      where: { id, tenantId },
      data: { banned: true },
      select: USER_SELECT,
    });
  }

  async activate(id: string, tenantId: string) {
    return this.prisma.user.update({
      where: { id, tenantId },
      data: { banned: false, banReason: null },
      select: USER_SELECT,
    });
  }

  async delete(id: string, tenantId: string) {
    return this.prisma.user.delete({ where: { id, tenantId } });
  }
}
