import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chamber } from './entities/chamber.entity';
import { User } from '../users/entities/user.entity';
import { ChambersService } from './chambers.service';
import { ChambersController } from './chambers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Chamber, User])],
  providers: [ChambersService],
  controllers: [ChambersController],
  exports: [ChambersService],
})
export class ChambersModule {}
