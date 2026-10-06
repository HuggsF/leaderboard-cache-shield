import { FieldValidationError } from './domain.error';

export class InvalidRankError extends FieldValidationError {
  readonly code = 'INVALID_RANK';

  constructor(value: string, reason: string) {
    super('rank', value, reason);
  }
}
