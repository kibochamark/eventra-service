import { Module } from '@nestjs/common';
import { QuoteController } from '../../controllers/quote.controller';
import { RolesGuard } from '../../common/guards/roles.guard';
import { S3Module } from '../GlobalServices/s3/s3.module';
import { QuotesRepository } from './quotes.repository';
import { QuotesService } from './quotes.service';

@Module({
  imports: [S3Module],
  controllers: [QuoteController],
  providers: [QuotesService, QuotesRepository, RolesGuard],
  exports: [QuotesService],
})
export class QuotesModule {}
