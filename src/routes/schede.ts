import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo } from '../middleware/auth.js';

const router = Router();

const esercizioSchema = z.object({
  nome: z.string().min(1),
  videoUrl: z.string().url().optional(),
  serieTarget: z.number().int().positive(),
  repsTarget: z.number().int().positive(),
  recuperoSecondi: z.number().int().positive(),
});

const schedaSchema = z.object({
  nome: z.string().min(1, 'Il nome della scheda non può essere vuoto'),
  clienteId: z.number().int(),
  esercizi: z.array(esercizioSchema).min(1, 'Serve almeno un esercizio'),
});

// Solo il TRAINER crea schede, e le assegna a un cliente specifico.
router.post('/schede', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const risultato = schedaSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { nome, clienteId, esercizi } = risultato.data;

  // Verifica che il clienteId passato sia davvero un CLIENTE e non un altro trainer.
  const cliente = await prisma.user.findUnique({ where: { id: clienteId } });
  if (!cliente || cliente.ruolo !== 'CLIENTE') {
    res.status(400).json({ errore: 'clienteId non valido' });
    return;
  }

  const scheda = await prisma.scheda.create({
    data: {
      nome,
      clienteId,
      esercizi: { create: esercizi }, // crea scheda + esercizi in un'unica query annidata
    },
    include: { esercizi: true },
  });

  res.status(201).json(scheda);
});

// Il CLIENTE vede solo le proprie schede; il TRAINER può vedere quelle di un cliente specifico.
router.get('/schede', autentica, async (req, res) => {
  const userId = (req as any).userId as number;
  const ruolo = (req as any).ruolo as string;

  if (ruolo === 'CLIENTE') {
    const schede = await prisma.scheda.findMany({
      where: { clienteId: userId },
      include: { esercizi: true },
    });
    res.json(schede);
    return;
  }

  // Trainer: ?clienteId=3 per vedere le schede di quel cliente
  const clienteIdQuery = req.query.clienteId ? Number(req.query.clienteId) : undefined;
  const schede = await prisma.scheda.findMany({
    where: clienteIdQuery ? { clienteId: clienteIdQuery } : undefined,
    include: { esercizi: true },
  });
  res.json(schede);
});

const rinominaSchema = z.object({
  nome: z.string().min(1, 'Il nome della scheda non può essere vuoto'),
});

// Rinomina una scheda esistente (per aggiungere/rimuovere esercizi vedi le rotte su /esercizi).
router.put('/schede/:id', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = Number(req.params.id);
  const risultato = rinominaSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }

  try {
    const scheda = await prisma.scheda.update({
      where: { id },
      data: { nome: risultato.data.nome },
      include: { esercizi: true },
    });
    res.json(scheda);
  } catch {
    // Prisma lancia un errore se l'id non esiste: lo intercettiamo per rispondere 404
    // invece di un generico 500 (stesso pattern del task manager).
    res.status(404).json({ errore: 'Scheda non trovata' });
  }
});

// Cancella la scheda. Grazie a onDelete: Cascade nello schema, Prisma cancella
// automaticamente anche gli esercizi collegati e il loro storico allenamenti.
router.delete('/schede/:id', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = Number(req.params.id);
  try {
    await prisma.scheda.delete({ where: { id } });
    res.status(204).send();
  } catch {
    res.status(404).json({ errore: 'Scheda non trovata' });
  }
});

const modificaEsercizioSchema = esercizioSchema.partial();

// Modifica un singolo esercizio (es. solo il peso target, senza toccare il resto della scheda).
router.put('/esercizi/:id', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = Number(req.params.id);
  const risultato = modificaEsercizioSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }

  try {
    const esercizio = await prisma.esercizio.update({
      where: { id },
      data: risultato.data,
    });
    res.json(esercizio);
  } catch {
    res.status(404).json({ errore: 'Esercizio non trovato' });
  }
});

router.delete('/esercizi/:id', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = Number(req.params.id);
  try {
    await prisma.esercizio.delete({ where: { id } });
    res.status(204).send();
  } catch {
    res.status(404).json({ errore: 'Esercizio non trovato' });
  }
});

export default router;
