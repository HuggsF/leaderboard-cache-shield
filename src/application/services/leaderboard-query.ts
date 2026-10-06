import type { GetLeaderboardInput, GetLeaderboardOutput } from '@application/dtos/leaderboard.dto';
import type { LeaderboardUnavailableError } from '@application/errors/leaderboard-unavailable.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { Clock } from '@application/interfaces/clock';
import type { MetricsCollector } from '@application/interfaces/metrics-collector';
import type { InvalidPageRequestError } from '@domain/errors/invalid-page-request.error';
import { fail } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import { PageRequest } from '@domain/value-objects/page-request.value-object';

export type GetLeaderboardError =
  InvalidPageRequestError | LeaderboardUnavailableError | UnexpectedError;

export type GetLeaderboardResult = Result<GetLeaderboardOutput, GetLeaderboardError>;

export type StrategyResult = Result<GetLeaderboardOutput, LeaderboardUnavailableError>;

export type LeaderboardQueryContext = {
  readonly operation: string;
  readonly pageSize: number;
  readonly clock: Pick<Clock, 'nowMs'>;
  readonly metrics: MetricsCollector;
};

/**
 * Envelope shared by the three strategies: validates the page, measures the response latency
 * and converts infrastructure exceptions into a Result — use cases never throw.
 */
export const executeLeaderboardQuery = async (
  input: GetLeaderboardInput,
  context: LeaderboardQueryContext,
  strategy: (pageRequest: PageRequest, startedAtMs: number) => Promise<StrategyResult>,
): Promise<GetLeaderboardResult> => {
  const pageRequest = PageRequest.create(input.page, context.pageSize);
  if (!pageRequest.success) {
    return pageRequest;
  }
  const startedAtMs = context.clock.nowMs();
  try {
    return await strategy(pageRequest.data, startedAtMs);
  } catch (error: unknown) {
    return fail(new UnexpectedError(context.operation, error));
  } finally {
    context.metrics.recordLatency('response', context.clock.nowMs() - startedAtMs);
  }
};
