import { InvalidPageRequestError } from '@domain/errors/invalid-page-request.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

/**
 * Which slice of the ranking is requested. Bounded on purpose: every page is a separate cache
 * entry, so an unbounded page number would let a client fill Redis (and hit MySQL) at will.
 */
export class PageRequest {
  static readonly MAX_PAGE = 10_000;
  static readonly MAX_PAGE_SIZE = 100;

  private constructor(
    readonly page: number,
    readonly pageSize: number,
  ) {
    Object.freeze(this);
  }

  static create(page: number, pageSize: number): Result<PageRequest, InvalidPageRequestError> {
    if (!Number.isInteger(page) || page < 1 || page > PageRequest.MAX_PAGE) {
      return fail(
        new InvalidPageRequestError(
          'page',
          page,
          `Page must be an integer between 1 and ${PageRequest.MAX_PAGE}`,
        ),
      );
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PageRequest.MAX_PAGE_SIZE) {
      return fail(
        new InvalidPageRequestError(
          'pageSize',
          pageSize,
          `Page size must be an integer between 1 and ${PageRequest.MAX_PAGE_SIZE}`,
        ),
      );
    }
    return ok(new PageRequest(page, pageSize));
  }

  /** Number of ranked students before the first entry of this page. */
  get offset(): number {
    return (this.page - 1) * this.pageSize;
  }

  equals(other: PageRequest): boolean {
    return this.page === other.page && this.pageSize === other.pageSize;
  }
}
