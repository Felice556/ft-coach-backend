import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7: la connection string per `prisma migrate` / `prisma generate`
// non sta più in schema.prisma, ma qui. Il client a runtime (src/prisma.ts)
// continua invece a usare l'adapter PrismaPg, indipendentemente da questo file.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
