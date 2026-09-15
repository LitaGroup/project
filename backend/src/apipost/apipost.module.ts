import { Module } from '@nestjs/common';
import { ApipostService } from './apipost.service';

@Module({
  providers: [ApipostService],
  exports: [ApipostService],
})
export class ApipostModule {}
