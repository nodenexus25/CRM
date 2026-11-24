import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  globalSearchQuerySchema,
  type GlobalSearchQuery,
  type GlobalSearchResult,
} from '@talentflow/types';

import { ZodQuery } from '@/common/decorators/zod.decorator';

import { SearchService } from './search.service';

/**
 * Global search for the header command palette.
 *
 * There is no `@RequirePermissions` here because the result set is assembled
 * per entity inside `SearchService`, which only queries entities the caller is
 * allowed to read.
 */
@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Search jobs, candidates and clients' })
  run(@ZodQuery(globalSearchQuerySchema) query: GlobalSearchQuery): Promise<GlobalSearchResult> {
    return this.search.search(query);
  }
}
