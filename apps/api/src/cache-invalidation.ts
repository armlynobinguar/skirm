// `@Invalidates(scope, ...)` on a write route drops those read-cache scopes once the handler
// succeeds (before the response goes out), so the writer's next read already sees its change.
import {
  Inject,
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mergeMap, type Observable } from 'rxjs';
import { DEPS, type ApiDeps } from './deps';
import { readCacheOf } from './read-cache';

const INVALIDATES = 'skirm:invalidates';

export const Invalidates = (...scopes: string[]) => SetMetadata(INVALIDATES, scopes);

@Injectable()
export class CacheInvalidationInterceptor implements NestInterceptor {
  constructor(
    @Inject(DEPS) private readonly deps: ApiDeps,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const scopes = this.reflector.get<string[] | undefined>(INVALIDATES, ctx.getHandler());
    if (!scopes?.length) return next.handle();
    const cache = readCacheOf(this.deps);
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        await Promise.all(scopes.map((s) => cache.invalidate(s)));
        return body;
      }),
    );
  }
}
