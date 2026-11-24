import { Module } from '@nestjs/common';

import { ClientContactsController } from './client-contacts.controller';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  controllers: [ClientsController, ClientContactsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
