import { Body, Param, Query } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

/**
 * Typed, validated request accessors.
 *
 * They pair `@nestjs/common`'s parameter decorators with `ZodValidationPipe`,
 * which is what makes the Zod schema in `@talentflow/types` the single runtime
 * and compile-time contract for every endpoint.
 */

/** `@ZodBody(schema) body: z.infer<typeof schema>` */
export const ZodBody = <T extends ZodTypeAny>(schema: T): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));

/** `@ZodQuery(schema) query: z.infer<typeof schema>` — coerces `page`/`pageSize`. */
export const ZodQuery = <T extends ZodTypeAny>(schema: T): ParameterDecorator =>
  Query(new ZodValidationPipe(schema));

/** `@ZodParam(schema) params: z.infer<typeof schema>` */
export const ZodParam = <T extends ZodTypeAny>(schema: T): ParameterDecorator =>
  Param(new ZodValidationPipe(schema));

export type ZodInfer<T extends ZodTypeAny> = z.infer<T>;
