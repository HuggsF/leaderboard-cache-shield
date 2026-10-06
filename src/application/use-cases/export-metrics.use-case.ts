import type { ExportMetricsOutput } from '@application/dtos/metrics.dto';
import type { MetricsExporter } from '@application/interfaces/metrics-exporter';
import { ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

/** GET /metrics — cache hits/misses, MySQL queries and latency quantiles per strategy. */
export class ExportMetricsUseCase {
  constructor(private readonly exporter: MetricsExporter) {}

  execute(): Result<ExportMetricsOutput, never> {
    return ok({ contentType: this.exporter.contentType, body: this.exporter.render() });
  }
}
