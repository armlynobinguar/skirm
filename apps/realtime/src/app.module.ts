// Nest wiring: one module whose service starts the realtime server on bootstrap and closes it
// (then the injected resources) on shutdown. The server itself is framework-free (server.ts).
import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { RealtimeDeps } from './deps';
import { createRealtimeServer, type RealtimeServer } from './server';

export const REALTIME_OPTIONS = Symbol('skirm.realtime.options');

export interface RealtimeOptions {
  deps: RealtimeDeps;
  port: number;
  host?: string;
  /** Closes what main.ts opened (db pool, redis, queue), after the server has stopped. */
  cleanup?: () => Promise<void>;
}

@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  server?: RealtimeServer;
  port?: number;

  constructor(@Inject(REALTIME_OPTIONS) private readonly opts: RealtimeOptions) {}

  async onApplicationBootstrap(): Promise<void> {
    this.server = createRealtimeServer(this.opts.deps);
    this.port = await this.server.listen(this.opts.port, this.opts.host);
    this.opts.deps.log?.info(`listening on :${this.port} (ws path /ws)`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.server?.close();
    this.server = undefined;
    await this.opts.cleanup?.();
  }
}

@Module({})
export class RealtimeModule {
  static forRoot(opts: RealtimeOptions): DynamicModule {
    return {
      module: RealtimeModule,
      providers: [{ provide: REALTIME_OPTIONS, useValue: opts }, RealtimeService],
      exports: [RealtimeService],
    };
  }
}
