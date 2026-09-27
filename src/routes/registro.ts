import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo } from '../middleware/auth.js';

const router = Router();

const registroSchema = z.object({
  esercizioId: z.number().int(),
  pesoUsato: z.number().positive(),
  repsFatte: z.number().int().positive(),
  nota: z.string().optional(),
});

// Solo il CLIENTE registra i propri allenamenti — non ha senso che lo faccia il trainer.
router.post('/registro', autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const risultato = registroSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { esercizioId, pesoUsato, repsFatte, nota } = risultato.data;
  const clienteId = (req as any).userId as number;

  // Isolamento dati: l'esercizio deve appartenere a una scheda DI QUESTO cliente,
  // altrimenti un cliente potrebbe registrare pesi su esercizi di qualcun altro.
  const esercizio = await prisma.esercizio.findUnique({
    where: { id: esercizioId },
    include: { scheda: true },
  });
  if (!esercizio || esercizio.scheda.clienteId !== clienteId) {
    res.status(404).json({ errore: 'Esercizio non trovato' });
    return;
  }

  const registro = await prisma.registroAllenamento.create({
    data: { esercizioId, pesoUsato, repsFatte, nota, clienteId },
  });

  res.status(201).json(registro);
});

// Storico di un esercizio specifico, ordinato dal più vecchio al più recente
// (comodo per disegnare poi un grafico di progressione).
router.get('/registro/:esercizioId', autentica, async (req, res) => {
  const esercizioId = Number(req.params.esercizioId);
  const clienteId = (req as any).userId as number;
  const ruolo = (req as any).ruolo as string;

  const esercizio = await prisma.esercizio.findUnique({
    where: { id: esercizioId },
    include: { scheda: true },
  });
  if (!esercizio) {
    res.status(404).json({ errore: 'Esercizio non trovato' });
    return;
  }

  // Un cliente può vedere solo il proprio storico; il trainer può vedere quello di ogni cliente.
  if (ruolo === 'CLIENTE' && esercizio.scheda.clienteId !== clienteId) {
    res.status(403).json({ errore: 'Non puoi vedere lo storico di un altro cliente' });
    return;
  }

  const storico = await prisma.registroAllenamento.findMany({
    where: { esercizioId },
    orderBy: { data: 'asc' },
  });
  res.json(storico);
});

export default router;
