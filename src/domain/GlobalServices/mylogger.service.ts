import { Global, LoggerService } from '@nestjs/common';


export class MyLogger implements LoggerService {
    log(message: string) { }
    error(message: string, trace: string) { }
    warn(message: string) { }
}