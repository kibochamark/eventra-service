import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from 'generated/prisma/client';
import { fromNodeHeaders } from 'src/common/utils/from-node-headers';
import { getAuth } from 'src/auth';
import { UserRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private userRepo: UserRepository) {}

  // -------------------------------------------------------
  // READ
  // -------------------------------------------------------

  async getUsers(tenantId: string) {
    try {
      return await this.userRepo.findByTenant(tenantId);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async getUserById(id: string, tenantId: string) {
    try {
      const user = await this.userRepo.findById(id, tenantId);
      if (!user) return new NotFoundException(`User "${id}" not found`);
      return user;
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  // -------------------------------------------------------
  // CREATE  (uses better-auth admin plugin for password hashing)
  // -------------------------------------------------------

  /**
   * Creates a new user in the tenant via better-auth's admin plugin.
   * better-auth hashes the password and creates the credential Account row.
   * The admin's session headers are forwarded so better-auth can verify
   * the caller has admin privileges.
   */
  async createUser(
    tenantId: string,
    requestHeaders: Record<string, string | string[] | undefined>,
    data: {
      name: string;
      email: string;
      password: string;
      role?: Role;
    },
  ) {
    try {
      const result = await (getAuth().api as any).createUser({
        body: {
          name: data.name,
          email: data.email,
          password: data.password,
          role: data.role ?? Role.STAFF,
          data: { tenantId, emailVerified: false },
        },
        headers: fromNodeHeaders(requestHeaders as any),
      });
      return result.user;
    } catch (error) {
      if (error?.status === 403) return new ForbiddenException('Admin session required');
      if (error?.body?.message?.includes('already exists') || error?.code === 'P2002') {
        return new BadRequestException('A user with this email already exists');
      }
      return new BadRequestException(error?.body?.message ?? error?.message ?? error);
    }
  }

  // -------------------------------------------------------
  // UPDATE INFO
  // -------------------------------------------------------

  /**
   * Updates name and/or email.
   * Staff can only update their own record — enforced by the controller
   * passing `callerId` and comparing to `id`.
   */
  async updateInfo(
    id: string,
    tenantId: string,
    data: { name?: string; email?: string },
  ) {
    try {
      const user = await this.userRepo.findById(id, tenantId);
      if (!user) return new NotFoundException(`User "${id}" not found`);
      return await this.userRepo.updateInfo(id, tenantId, data);
    } catch (error) {
      if (error?.code === 'P2002') return new BadRequestException('Email already in use');
      return new BadRequestException(error);
    }
  }

  // -------------------------------------------------------
  // UPDATE ROLE  (ADMIN only)
  // -------------------------------------------------------

  async updateRole(id: string, tenantId: string, role: Role) {
    try {
      const user = await this.userRepo.findById(id, tenantId);
      if (!user) return new NotFoundException(`User "${id}" not found`);
      return await this.userRepo.updateRole(id, tenantId, role);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  // -------------------------------------------------------
  // PASSWORD  (ADMIN only — uses better-auth admin plugin)
  // -------------------------------------------------------

  /**
   * Resets a user's password without requiring the old one.
   * better-auth hashes the new password using the same algorithm as sign-up,
   * keeping credentials consistent.
   */
  async setPassword(
    userId: string,
    tenantId: string,
    requestHeaders: Record<string, string | string[] | undefined>,
    newPassword: string,
  ) {
    try {
      const user = await this.userRepo.findById(userId, tenantId);
      if (!user) return new NotFoundException(`User "${userId}" not found`);

      await (getAuth().api as any).setUserPassword({
        body: { userId, newPassword },
        headers: fromNodeHeaders(requestHeaders as any),
      });
      return { message: 'Password updated successfully' };
    } catch (error) {
      if (error?.status === 403) return new ForbiddenException('Admin session required');
      return new BadRequestException(error?.body?.message ?? error?.message ?? error);
    }
  }

  // -------------------------------------------------------
  // DEACTIVATE / ACTIVATE  (ADMIN only)
  // -------------------------------------------------------

  /**
   * Deactivates a user — sets banned=true.
   * better-auth automatically rejects sessions for banned users.
   */
  async deactivate(id: string, tenantId: string) {
    try {
      const user = await this.userRepo.findById(id, tenantId);
      if (!user) return new NotFoundException(`User "${id}" not found`);
      return await this.userRepo.deactivate(id, tenantId);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async activate(id: string, tenantId: string) {
    try {
      const user = await this.userRepo.findById(id, tenantId);
      if (!user) return new NotFoundException(`User "${id}" not found`);
      return await this.userRepo.activate(id, tenantId);
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  // -------------------------------------------------------
  // DELETE  (ADMIN only)
  // -------------------------------------------------------

  async deleteUser(id: string, tenantId: string) {
    try {
      const user = await this.userRepo.findById(id, tenantId);
      if (!user) return new NotFoundException(`User "${id}" not found`);
      await this.userRepo.delete(id, tenantId);
      return { message: 'User deleted successfully' };
    } catch (error) {
      return new BadRequestException(error);
    }
  }
}
