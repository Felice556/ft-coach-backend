import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { limiteGenerale } from './limiti.js';
import { prisma } from './prisma.js';
import authRouter from './routes/auth.js';
import schedeRouter from './routes/schede.js';
import registroRouter from './routes/registro.js';
import presetRouter from './routes/preset.js';
import sessioniRouter from './routes/sessioni.js';
import invitiRouter from './routes/inviti.js';
import { HEADER_NUOVO_TOKEN } from './middleware/auth.js';
import misureRouter from './routes/misure.js';

// L'app Express, senza avviarla: così i test (tests/) possono usarla direttamente,
// senza aprire una porta. L'avvio vero è in server.ts.
const app = express();

// Su Render le richieste arrivano tramite un "proxy": così Express legge l'IP vero del
// visitatore (serve ai limiti sui tentativi di login, altrimenti tutti avrebbero lo stesso IP).
app.set('trust proxy', 1);

// Intestazioni di sicurezza standard (es. vietano di mostrare il server dentro altri siti).
app.use(helmet());

// In produzione accettiamo richieste solo dal frontend indicato in FRONTEND_URL
// (es. l'indirizzo su Cloudflare Pages); in sviluppo, se non è impostata, da qualsiasi origine.
// exposedHeaders: il frontend (su un altro dominio) deve poter leggere il token rinnovato.
app.use(
  cors({
    ...(process.env.FRONTEND_URL ? { origin: process.env.FRONTEND_URL.split(',') } : {}),
    exposedHeaders: [HEADER_NUOVO_TOKEN],
  }),
);
// Corpo delle richieste al massimo 100 KB: basta e avanza per una scheda, blocca invii enormi.
app.use(express.json({ limit: '100kb' }));
app.use(limiteGenerale);

// Rotta di verifica: se risponde, server + connessione DB sono ok.
// Controlla anche che il database risponda (una query minima), ma non rivela nessun dato:
// l'indirizzo è pubblico (lo usa cron-job.org per tenere sveglio il server).
app.get('/health', async (req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

app.use(authRouter);
app.use(schedeRouter);
app.use(registroRouter);
app.use(presetRouter);
app.use(sessioniRouter);
app.use(invitiRouter);
app.use(misureRouter);

// Gestore degli errori imprevisti (database irraggiungibile, bug, ecc.).
// Express 5 ci porta qui anche gli errori delle rotte async: la singola richiesta
// riceve un 500, ma il server RESTA ACCESO per tutti gli altri utenti.
// (Si riconosce dai 4 parametri: Express lo tratta come gestore di errori.)
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  // Errori "del client" già classificati da Express (es. JSON malformato → status 400):
  // rispondiamo con quel codice e un messaggio chiaro, non con un 500.
  const status = (err as { status?: number })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ errore: 'Dati della richiesta non validi' });
    return;
  }
  console.error(`Errore su ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ errore: 'Errore interno del server, riprova tra poco' });
});

export default app;
