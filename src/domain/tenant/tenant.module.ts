import { Module } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantController } from 'src/controllers/tenant.controller';
import { TenantRepository } from './tenant.repository';

@Module({
  providers: [TenantService, TenantRepository],
  controllers: [TenantController]
})
export class TenantModule {}
