import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './prisma.js';
import authRouter from './routes/auth.js';
import schedeRouter from './routes/schede.js';
import registroRouter from './routes/registro.js';
import presetRouter from './routes/preset.js';
import sessioniRouter from './routes/sessioni.js';

const app = express();
app.use(cors());
app.use(express.json());

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server palestra in ascolto su porta ${PORT}`);
});
