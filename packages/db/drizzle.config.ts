import { defineConfig } from 'drizzle-kit';

// drizzle-kit (dev only; deploys migrate with the migrate job, src/migrator.ts) connects through
// node-postgres, which treats `sslmode=require` as verify-full. uselibpqcompat gives it libpq's
// meaning instead (encrypt, don't check the CA), which the Supabase pooler URL needs.
function withLibpqSsl(url: string): string {
  if (!/[?&]sslmode=/.test(url) || /[?&]uselibpqcompat=/.test(url)) return url;
  return `${url}&uselibpqcompat=true`;
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: withLibpqSsl(process.env.DATABASE_URL ?? 'postgres://skirm:skirm@localhost:5432/skirm') },
  strict: true,
  verbose: true,
});
