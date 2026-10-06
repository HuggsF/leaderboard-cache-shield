import { FieldValidationError } from './domain.error';

export class InvalidCompletedCoursesError extends FieldValidationError {
  readonly code = 'INVALID_COMPLETED_COURSES';

  constructor(value: string, reason: string) {
    super('completedCourses', value, reason);
  }
}
