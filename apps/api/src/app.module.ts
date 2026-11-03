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
import { MarketController } from './controllers/market.controller';
import { RentalsController } from './controllers/rentals.controller';
import { OpsController } from './controllers/ops.controller';
import { PublicController } from './controllers/public.controller';
import { SeasonsController } from './controllers/seasons.controller';
import { SkillsController } from './controllers/skills.controller';
import { DEPS, type ApiDeps } from './deps';
import { ApiExceptionFilter } from './errors';

@Module({})
export class AppModule {
  static forRoot(deps: ApiDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        CoreController,
        PublicController,
        CreditsController,
        SkillsController,
        MarketController,
        RentalsController,
        SeasonsController,
        CosmeticsController,
        OpsController,
      ],
      providers: [
        { provide: DEPS, useValue: deps },
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
