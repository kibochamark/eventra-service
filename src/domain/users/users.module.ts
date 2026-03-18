import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRepository } from './users.repository';
import { UsersController } from '../../controllers/user.controller';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers:[UsersController],
  providers: [UsersService, UserRepository, RolesGuard]
})
export class UsersModule {}
