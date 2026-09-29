import 'dotenv/config';
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

// Senza queste variabili il server non può funzionare: meglio fermarsi subito
// all'avvio con un messaggio chiaro, invece di scoprirlo al primo login.
for (const nome of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[nome]) {
    console.error(`Variabile d'ambiente mancante: ${nome}. Controlla il file .env (o le variabili su Render).`);
    process.exit(1);
  }
}

const app = express();

// Su Render le richieste arrivano tramite un "proxy": così Express legge l'IP vero del
// visitatore (serve ai limiti sui tentativi di login, altrimenti tutti avrebbero lo stesso IP).
app.set('trust proxy', 1);

// Intestazioni di sicurezza standard (es. vietano di mostrare il server dentro altri siti).
app.use(helmet());

// In produzione accettiamo richieste solo dal frontend indicato in FRONTEND_URL
// (es. l'indirizzo su Vercel); in sviluppo, se non è impostata, da qualsiasi origine.
app.use(cors(process.env.FRONTEND_URL ? { origin: process.env.FRONTEND_URL.split(',') } : undefined));
// Corpo delle richieste al massimo 100 KB: basta e avanza per una scheda, blocca invii enormi.
app.use(express.json({ limit: '100kb' }));
app.use(limiteGenerale);

// Rotta di verifica: se risponde, server + connessione DB sono ok.
app.get('/health', async (req, res) => {
  const numeroUtenti = await prisma.user.count();
  res.json({ ok: true, utentiNelDb: numeroUtenti });
});

app.use(authRouter);
app.use(schedeRouter);
app.use(registroRouter);
app.use(presetRouter);
app.use(sessioniRouter);
app.use(invitiRouter);

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server palestra in ascolto su porta ${PORT}`);
});
