import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ApiError } from './api-error';

/**
 * Routes an API failure into a react-hook-form instance.
 *
 * The API returns `VALIDATION_FAILED` with a `details[]` list of
 * `{ path, message }`, so field-level errors land on the matching input and the
 * form still shows a summary for anything that has no field (a 403, a rate
 * limit). Returns the message the caller should surface.
 */
export function applyApiError<TFieldValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TFieldValues>,
): string {
  if (error instanceof ApiError) {
    for (const issue of error.issues) {
      if (!issue.path) continue;
      setError(issue.path as Path<TFieldValues>, { type: 'server', message: issue.message });
    }
    return error.message;
  }

  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
