import { Module } from '@nestjs/common';
import { AssetController } from '../../controllers/asset.controller';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AssetsService } from './assets.service';
import { AssetsRepository } from './assets.repository';
import { S3Module } from '../GlobalServices/s3/s3.module';

// PrismaModule is @Global(), so PrismaService is available here without re-importing it.
// S3Module is imported here to make S3Service available to AssetsService.
@Module({
  imports: [S3Module],
  controllers: [AssetController],
  providers: [AssetsService, AssetsRepository, RolesGuard],
})
export class AssetsModule {}
