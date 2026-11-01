// Session guard (contract: every route needs a session except health, leaderboards, seasons and v2
// matches). AUTH_MODE=dev trusts `x-dev-user`; privy verifies the Bearer JWT.
// A session is a verified identity whose account exists (created by POST /auth/session).
import {
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccountRow } from '@skirm/db';
import { AuthError, verifyRequestUser } from '@skirm/server';
import type { Request } from 'express';
import { DEPS, type ApiDeps } from './deps';
import { ApiError } from './errors';

const PUBLIC_KEY = 'skirm:public';

/** Route works without a session; the account is attached when valid credentials are sent. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export interface AuthedRequest extends Request {
  account?: AccountRow;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(DEPS) private readonly deps: ApiDeps,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) {
      if (hasCredentials(req)) req.account = await this.resolve(req).catch(() => undefined);
      return true;
    }
    req.account = await this.resolve(req);
    return true;
  }

  private async resolve(req: AuthedRequest): Promise<AccountRow> {
    const user = await verifyRequestUser(this.deps.config, req.headers);
    const { accounts } = this.deps.repos;
    const account = user.privyDid
      ? await accounts.byPrivyDid(user.privyDid)
      : await accounts.byHandle(user.handle);
    if (!account || account.system)
      throw new ApiError(401, 'no_session', 'sign in first (POST /auth/session)');
    return account;
  }
}

function hasCredentials(req: Request): boolean {
  return !!(req.headers['x-dev-user'] || req.headers.authorization);
}

/** The signed-in account (non-public routes), or undefined on public routes. */
export const CurrentAccount = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AccountRow | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().account,
);

/** Narrowing helper for handlers behind the guard. */
export function mustAccount(account: AccountRow | undefined): AccountRow {
  if (!account) throw new AuthError('missing credentials');
  return account;
}
