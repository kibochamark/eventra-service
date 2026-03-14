import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class ClientsRepository {
  constructor(private prisma: PrismaService) {}

  async createClient(
    tenantId: string,
    data: {
      name: string;
      isCorporate?: boolean;
      email?: string;
      phone?: string;
      address?: string;
      contactPerson?: string;
    },
  ) {
    return await this.prisma.client.create({
      data: { tenantId, ...data },
    });
  }

  async findAllByTenant(tenantId: string) {
    return await this.prisma.client.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        isCorporate: true,
        email: true,
        phone: true,
        contactPerson: true,
        createdAt: true,
        // Quote count — useful for the list view without fetching all quotes
        _count: { select: { quotes: true } },
      },
    });
  }

  async findById(id: string, tenantId: string) {
    return await this.prisma.client.findUnique({
      where: { id, tenantId },
      include: {
        quotes: {
          select: { id: true, quoteNumber: true, status: true },
          orderBy: { id: 'desc' },
          take: 10,
        },
      },
    });
  }

  async updateClient(
    id: string,
    tenantId: string,
    data: {
      name?: string;
      isCorporate?: boolean;
      email?: string;
      phone?: string;
      address?: string;
      contactPerson?: string;
    },
  ) {
    return await this.prisma.client.update({
      where: { id, tenantId },
      data,
    });
  }

  async deleteClient(id: string, tenantId: string) {
    return await this.prisma.client.delete({ where: { id, tenantId } });
  }

  async searchByName(tenantId: string, query: string) {
    return await this.prisma.client.findMany({
      where: {
        tenantId,
        name: { contains: query, mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      take: 20,
      select: {
        id: true,
        name: true,
        isCorporate: true,
        email: true,
        phone: true,
        contactPerson: true,
        _count: { select: { quotes: true } },
      },
    });
  }
}
