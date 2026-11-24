import { Module } from '@nestjs/common';

import { RbacService } from './rbac.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [RolesController],
  providers: [RbacService, RolesService],
  exports: [RbacService, RolesService],
})
export class RbacModule {}
