
import { Global, Injectable, Optional } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';

import { PrismaNeon } from '@prisma/adapter-neon';
import { ConfigService } from '@nestjs/config';


@Global()
@Injectable()
export class PrismaService extends PrismaClient {
    constructor(@Optional() private config?: ConfigService) {
        // Use config if available, otherwise fall back to environment variable
        const connectionString = config?.get<string>('DATABASE_URL') || process.env.DATABASE_URL;



        if (!connectionString) {
            throw new Error('DATABASE_URL is required');
        }


        const adapter = new PrismaNeon({ connectionString: connectionString! });

        super({
            adapter,
        });
    }
}