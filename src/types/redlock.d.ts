/**
 * Type declarations for `redlock@5.0.0-beta.2`.
 *
 * The package ships `dist/index.d.ts`, but its `package.json` declares `"type": "module"` and an
 * `exports` map without a `types` condition. Under `module: Node16` TypeScript therefore cannot
 * use those typings from a CommonJS project (TS7016 / TS1479), even though the CommonJS build
 * (`dist/cjs/index.js`) works at runtime. This ambient module mirrors the upstream declarations
 * for the API surface used by `RedlockDistributedLock`. See docs/adr/002-distributed-lock-algorithm.md.
 */
declare module 'redlock' {
  import { EventEmitter } from 'node:events';
  import type { Cluster, Redis } from 'ioredis';

  type Client = Redis | Cluster;

  export type ExecutionStats = {
    readonly membershipSize: number;
    readonly quorumSize: number;
    readonly votesFor: Set<Client>;
    readonly votesAgainst: Map<Client, Error>;
  };

  export type ExecutionResult = {
    attempts: readonly Promise<ExecutionStats>[];
  };

  export interface Settings {
    readonly driftFactor: number;
    readonly retryCount: number;
    readonly retryDelay: number;
    readonly retryJitter: number;
    readonly automaticExtensionThreshold: number;
  }

  export class ResourceLockedError extends Error {
    readonly message: string;
    constructor(message: string);
  }

  export class ExecutionError extends Error {
    readonly message: string;
    readonly attempts: readonly Promise<ExecutionStats>[];
    constructor(message: string, attempts: readonly Promise<ExecutionStats>[]);
  }

  export class Lock {
    readonly redlock: Redlock;
    readonly resources: string[];
    readonly value: string;
    readonly attempts: readonly Promise<ExecutionStats>[];
    expiration: number;
    release(): Promise<ExecutionResult>;
    extend(duration: number): Promise<Lock>;
  }

  export default class Redlock extends EventEmitter {
    readonly clients: Set<Client>;
    readonly settings: Settings;
    constructor(clients: Iterable<Client>, settings?: Partial<Settings>);
    quit(): Promise<void>;
    acquire(resources: string[], duration: number, settings?: Partial<Settings>): Promise<Lock>;
    release(lock: Lock, settings?: Partial<Settings>): Promise<ExecutionResult>;
    extend(existing: Lock, duration: number, settings?: Partial<Settings>): Promise<Lock>;
  }
}
