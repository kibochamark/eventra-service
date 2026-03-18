import { Module } from '@nestjs/common';
import { ClientController } from '../../controllers/client.controller';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientsRepository } from './clients.repository';
import { ClientsService } from './clients.service';

@Module({
  controllers: [ClientController],
  providers: [ClientsService, ClientsRepository, RolesGuard],
  exports: [ClientsService],
})
export class ClientsModule {}
