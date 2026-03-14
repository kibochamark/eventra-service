import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientsRepository } from './clients.repository';

@Injectable()
export class ClientsService {
  constructor(private clientsRepo: ClientsRepository) {}

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
    try {
      return await this.clientsRepo.createClient(tenantId, data);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async getClients(tenantId: string) {
    try {
      return await this.clientsRepo.findAllByTenant(tenantId);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async getClientById(id: string, tenantId: string) {
    try {
      const client = await this.clientsRepo.findById(id, tenantId);
      if (!client) {
        return new NotFoundException(`Client with id "${id}" was not found`);
      }
      return client;
    } catch (error) {
      return new BadRequestException(error);
    }
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
    try {
      return await this.clientsRepo.updateClient(id, tenantId, data);
    } catch (error) {
      if (error?.code === 'P2025') {
        return new NotFoundException(`Client with id "${id}" was not found`);
      }
      return new BadRequestException(error);
    }
  }

  async searchClients(tenantId: string, query: string) {
    try {
      return await this.clientsRepo.searchByName(tenantId, query);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async deleteClient(id: string, tenantId: string) {
    try {
      await this.clientsRepo.deleteClient(id, tenantId);
      return { message: 'Client deleted successfully' };
    } catch (error) {
      if (error?.code === 'P2025') {
        return new NotFoundException(`Client with id "${id}" was not found`);
      }
      // P2003 — client has linked quotes; cannot delete
      if (error?.code === 'P2003') {
        return new BadRequestException(
          'Cannot delete a client that has existing quotes',
        );
      }
      return new BadRequestException(error);
    }
  }
}
