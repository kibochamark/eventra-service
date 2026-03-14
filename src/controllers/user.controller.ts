import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from 'generated/prisma/client';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { UsersService } from 'src/domain/users/users.service';
import {
  CreateUserDto,
  SetPasswordDto,
  UpdateRoleDto,
  UpdateUserInfoDto,
  UserIdParamDto,
} from './dto/user.dto';

/**
 * UsersController — /users
 *
 * Route declaration order (static before parameterised):
 *   1. POST   /users                    create user         ADMIN
 *   2. GET    /users                    list users          ADMIN
 *   3. GET    /users/:userId            get user            ADMIN
 *   4. PATCH  /users/:userId            update info         ADMIN + STAFF (own record only for STAFF)
 *   5. PATCH  /users/:userId/role       update role         ADMIN
 *   6. POST   /users/:userId/password   reset password      ADMIN
 *   7. POST   /users/:userId/deactivate deactivate          ADMIN
 *   8. POST   /users/:userId/activate   activate            ADMIN
 *   9. DELETE /users/:userId            delete user         ADMIN
 */
@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(private userService: UsersService) {}

  /**
   * POST /users
   * Creates a new user in the tenant.
   * better-auth handles password hashing — never stored in plain text.
   * ADMIN only.
   */
  @Post()
  @Roles(Role.ADMIN)
  async createUser(@Body() body: CreateUserDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Creating user "${body.email}" for tenant ${tenantId}`);
    const result = await this.userService.createUser(tenantId, req.headers, body);
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * GET /users
   * Lists all users in the tenant.
   * ADMIN only.
   */
  @Get()
  @Roles(Role.ADMIN)
  async getUsers(@Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Listing users for tenant ${tenantId}`);
    const result = await this.userService.getUsers(tenantId);
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * GET /users/:userId
   * Returns a single user scoped to the tenant.
   * ADMIN only.
   */
  @Get(':userId')
  @Roles(Role.ADMIN)
  async getUser(@Param() param: UserIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Fetching user ${param.userId}`);
    const result = await this.userService.getUserById(param.userId, tenantId);
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * PATCH /users/:userId
   * Updates name and/or email.
   * ADMIN: can update any user in their tenant.
   * STAFF: can only update their own record.
   */
  @Patch(':userId')
  @Roles(Role.ADMIN, Role.STAFF)
  async updateInfo(
    @Param() param: UserIdParamDto,
    @Body() body: UpdateUserInfoDto,
    @Req() req: any,
  ) {
    const { tenantId, id: callerId, role } = req.user as any;

    if (role === Role.STAFF && callerId !== param.userId) {
      throw new ForbiddenException('Staff can only update their own profile');
    }

    this.logger.log(`Updating info for user ${param.userId}`);
    const result = await this.userService.updateInfo(param.userId, tenantId, body);
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * PATCH /users/:userId/role
   * Changes the role of a user (ADMIN ↔ STAFF).
   * ADMIN only.
   */
  @Patch(':userId/role')
  @Roles(Role.ADMIN)
  async updateRole(
    @Param() param: UserIdParamDto,
    @Body() body: UpdateRoleDto,
    @Req() req: any,
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(`Setting role of user ${param.userId} to ${body.role}`);
    const result = await this.userService.updateRole(param.userId, tenantId, body.role);
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * POST /users/:userId/password
   * Admin forcefully resets a user's password without requiring the old one.
   * better-auth hashes the new password using the same algorithm as sign-up.
   * ADMIN only.
   */
  @Post(':userId/password')
  @Roles(Role.ADMIN)
  async setPassword(
    @Param() param: UserIdParamDto,
    @Body() body: SetPasswordDto,
    @Req() req: any,
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(`Resetting password for user ${param.userId}`);
    const result = await this.userService.setPassword(
      param.userId,
      tenantId,
      req.headers,
      body.newPassword,
    );
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * POST /users/:userId/deactivate
   * Sets banned=true — better-auth rejects all future sessions for this user.
   * ADMIN only.
   */
  @Post(':userId/deactivate')
  @Roles(Role.ADMIN)
  async deactivate(@Param() param: UserIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Deactivating user ${param.userId}`);
    const result = await this.userService.deactivate(param.userId, tenantId);
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * POST /users/:userId/activate
   * Clears banned flag — user can log in again.
   * ADMIN only.
   */
  @Post(':userId/activate')
  @Roles(Role.ADMIN)
  async activate(@Param() param: UserIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Activating user ${param.userId}`);
    const result = await this.userService.activate(param.userId, tenantId);
    if (result instanceof HttpException) throw result;
    return result;
  }

  /**
   * DELETE /users/:userId
   * Permanently deletes the user and all their sessions (cascade).
   * ADMIN only.
   */
  @Delete(':userId')
  @Roles(Role.ADMIN)
  async deleteUser(@Param() param: UserIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Deleting user ${param.userId}`);
    const result = await this.userService.deleteUser(param.userId, tenantId);
    if (result instanceof HttpException) throw result;
    return result;
  }
}
