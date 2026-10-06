import { FieldValidationError } from './domain.error';

/** The requested leaderboard page or page size is outside the allowed range. */
export class InvalidPageRequestError extends FieldValidationError {
  readonly code = 'INVALID_PAGE_REQUEST';

  constructor(field: 'page' | 'pageSize', value: number, reason: string) {
    super(field, String(value), reason);
  }
}
