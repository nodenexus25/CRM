import { SetMetadata } from '@nestjs/common';

export const NO_ENVELOPE_KEY = 'response:noEnvelope';

/**
 * Opts a route out of the `{ data }` success envelope.
 *
 * Reserved for machine consumers that expect a fixed body shape — the health
 * probes read by orchestrators, and Swagger's own JSON document.
 */
export const NoEnvelope = () => SetMetadata(NO_ENVELOPE_KEY, true);
