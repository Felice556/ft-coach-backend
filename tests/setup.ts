// Eseguito da Vitest prima di ogni file di test: prepara le variabili d'ambiente
// PRIMA che l'app venga importata (il client Prisma e i token le leggono all'avvio).
import { config } from 'dotenv';
import { controllaDatabaseDiTest, urlDatabaseDiTest } from './db-di-test';

// .env.test (facoltativo, non va su GitHub) per chi ha il database di prova con un'altra password.
config({ path: '.env.test', override: true });

const url = urlDatabaseDiTest();
controllaDatabaseDiTest(url);

process.env.DATABASE_URL = url;
process.env.JWT_SECRET = 'segreto-solo-per-i-test-lungo-abbastanza';
process.env.CODICE_TRAINER = 'codice-trainer-di-test';
delete process.env.INVITI_OBBLIGATORI;
delete process.env.FRONTEND_URL;
