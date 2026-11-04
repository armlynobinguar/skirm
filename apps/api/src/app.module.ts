// AppModule.forRoot(deps) wires every controller against one injected ApiDeps; createApp builds the
// HTTP app (error filter, CORS) the same way for main.ts and the tests.
import 'reflect-metadata';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SessionGuard } from './auth';
import { CoreController } from './controllers/core.controller';
import { CosmeticsController } from './controllers/cosmetics.controller';
import { CreditsController } from './controllers/credits.controller';
import { DecisionsController } from './controllers/decisions.controller';
import { MarketController } from './controllers/market.controller';
import { LobbiesController } from './controllers/lobbies.controller';
import { OnboardingController } from './controllers/onboarding.controller';
import { RentalsController } from './controllers/rentals.controller';
import { OpsController } from './controllers/ops.controller';
import { PublicController } from './controllers/public.controller';
import { RankedController } from './controllers/ranked.controller';
import { SeasonsController } from './controllers/seasons.controller';
import { SkillsController } from './controllers/skills.controller';
import { DEPS, type ApiDeps } from './deps';
import { ApiExceptionFilter } from './errors';
import { DEFAULT_RATE_LIMITS, RateLimitGuard } from './rate-limit';

@Module({})
export class AppModule {
  static forRoot(deps: ApiDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        CoreController,
        PublicController,
        RankedController,
        CreditsController,
        SkillsController,
        MarketController,
        RentalsController,
        LobbiesController,
        SeasonsController,
        CosmeticsController,
        OpsController,
        DecisionsController,
        OnboardingController,
      ],
      providers: [
        { provide: DEPS, useValue: deps },
        // Rate limits first, so a flood is turned away before any session work.
        ...(deps.rateLimit
          ? [{ provide: APP_GUARD, useValue: new RateLimitGuard(deps.rateLimit.store, { ...DEFAULT_RATE_LIMITS, ...deps.rateLimit.limits }) }]
          : []),
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}

export interface CreateAppOptions {
  /** Nest logger levels (default: errors and warnings only). */
  logger?: false | ('log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal')[];
}

export async function createApp(
  deps: ApiDeps,
  opts: CreateAppOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(deps), {
    logger: opts.logger ?? ['error', 'warn'],
    bodyParser: true,
  });
  app.disable('x-powered-by');
  app.enableCors({
    origin: deps.corsOrigins ?? ['http://localhost:3000'],
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-dev-user'],
  });
  app.useBodyParser('json', { limit: '64kb' });
  return app;
}
