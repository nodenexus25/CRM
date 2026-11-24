import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * Validates and *transforms* a payload with a Zod schema.
 *
 * The parsed value replaces the raw one, so handlers receive coerced, trimmed
 * and defaulted data — `page` is a number, not the string `"2"`. Failures are
 * re-thrown as the original `ZodError` so `AllExceptionsFilter` can turn them
 * into the shared `VALIDATION_FAILED` envelope with per-field issues.
 *
 * @example
 * ```ts
 * @Post()
 * create(@Body(new ZodValidationPipe(createJobSchema)) body: CreateJobRequest) {}
 * ```
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<TSchema> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      // Surfaced verbatim so the global filter keeps the field-level detail.
      throw result.error;
    }

    return result.data;
  }

  /** Exposed so decorators can describe the failure without an instance. */
  static describe(metadata?: ArgumentMetadata): string {
    return metadata?.type ?? 'value';
  }
}
