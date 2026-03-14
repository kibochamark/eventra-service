import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ConfigModule } from '@nestjs/config';
import { MyLogger } from './domain/GlobalServices/mylogger.service';
import { UsersController } from './controllers/user.controller';
import { UsersModule } from './domain/users/users.module';
import { PrismaModule } from './prisma.module';
import { AssetsModule } from './domain/assets/assets.module';
import { ClientsModule } from './domain/clients/clients.module';
import { QuotesModule } from './domain/quotes/quotes.module';
import { TenantModule } from './domain/tenant/tenant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    UsersModule,
    AssetsModule,
    ClientsModule,
    QuotesModule,
    TenantModule
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}
