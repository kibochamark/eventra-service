import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from 'generated/prisma/client';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { ClientsService } from 'src/domain/clients/clients.service';
import {
  ClientIdParamDto,
  CreateClientDto,
  SearchClientDto,
  UpdateClientDto,
} from './dto/client.dto';

@Controller('clients')
@UseGuards(RolesGuard)
export class ClientController {
  private readonly logger = new Logger(ClientController.name);

  constructor(private clientsService: ClientsService) {}

  /**
   * POST /clients
   * Creates a new client for the tenant.
   * ADMIN only — staff should not be able to create new clients.
   */
  @Post()
  @Roles(Role.ADMIN)
  async createClient(@Body() body: CreateClientDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Creating client "${body.name}" for tenant ${tenantId}`);
    return await this.clientsService.createClient(tenantId, body);
  }

  /**
   * GET /clients/search?q=<query>
   * Case-insensitive name search. Returns up to 20 matching clients.
   * Used for the client picker when building a quote.
   * Must be declared before GET /clients/:id to avoid the param swallowing "search".
   */
  @Get('search')
  @Roles(Role.ADMIN, Role.STAFF)
  async searchClients(@Query() query: SearchClientDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Searching clients by name "${query.q}" for tenant ${tenantId}`);
    return await this.clientsService.searchClients(tenantId, query.q);
  }

  /**
   * GET /clients
   * Lists all clients for the tenant with their quote count.
   */
  @Get()
  @Roles(Role.ADMIN, Role.STAFF)
  async getClients(@Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Listing clients for tenant ${tenantId}`);
    return await this.clientsService.getClients(tenantId);
  }

  /**
   * GET /clients/:id
   * Returns a single client with their 10 most recent quotes.
   */
  @Get(':id')
  @Roles(Role.ADMIN, Role.STAFF)
  async getClient(@Param() param: ClientIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Fetching client ${param.id} for tenant ${tenantId}`);
    const result = await this.clientsService.getClientById(param.id, tenantId);
    if (result instanceof NotFoundException) throw result;
    return result;
  }

  /**
   * PATCH /clients/:id
   * Partially updates a client's details.
   * ADMIN only.
   */
  @Patch(':id')
  @Roles(Role.ADMIN)
  async updateClient(
    @Param() param: ClientIdParamDto,
    @Body() body: UpdateClientDto,
    @Req() req: any,
  ) {
    const { tenantId } = req.user as any;
    this.logger.log(`Updating client ${param.id} for tenant ${tenantId}`);
    const result = await this.clientsService.updateClient(
      param.id,
      tenantId,
      body,
    );
    if (result instanceof NotFoundException) throw result;
    return result;
  }

  /**
   * DELETE /clients/:id
   * Deletes a client.
   * Returns 400 if the client has linked quotes.
   * ADMIN only.
   */
  @Delete(':id')
  @Roles(Role.ADMIN)
  async deleteClient(@Param() param: ClientIdParamDto, @Req() req: any) {
    const { tenantId } = req.user as any;
    this.logger.log(`Deleting client ${param.id} for tenant ${tenantId}`);
    const result = await this.clientsService.deleteClient(param.id, tenantId);
    if (result instanceof NotFoundException) throw result;
    return result;
  }
}
