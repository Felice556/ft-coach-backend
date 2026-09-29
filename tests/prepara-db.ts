// `npm run test:db` — crea le tabelle nel database DI PROVA (una volta, e dopo ogni nuova migrazione).
// Usa lo stesso controllo dei test: se l'indirizzo non è un database di prova locale, si ferma.
import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { controllaDatabaseDiTest, urlDatabaseDiTest } from './db-di-test';

config({ path: '.env.test', override: true });
const url = urlDatabaseDiTest();
controllaDatabaseDiTest(url);

console.log(`Preparo il database di prova: ${new URL(url).host}${new URL(url).pathname}`);
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
