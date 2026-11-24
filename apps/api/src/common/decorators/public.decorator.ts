import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Opts a route out of authentication. Used for signup, login, password reset,
 * health checks and the public marketing endpoints.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
