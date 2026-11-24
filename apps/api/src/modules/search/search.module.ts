import { Module } from '@nestjs/common';

import { PostgresSearchAdapter } from './search.adapter';
import { SearchController } from './search.controller';
import { SEARCH_ADAPTER, SearchService, searchAdapterProvider } from './search.service';

@Module({
  controllers: [SearchController],
  providers: [PostgresSearchAdapter, searchAdapterProvider, SearchService],
  exports: [SearchService, SEARCH_ADAPTER],
})
export class SearchModule {}
