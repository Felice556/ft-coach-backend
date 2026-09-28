import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo } from '../middleware/auth.js';

const router = Router();

const esercizioSchema = z.object({
  nome: z.string().min(1),
  videoUrl: z.string().url().optional(),
  descrizione: z.string().optional(),
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
    include: { esercizi: { orderBy: { id: 'asc' } } },
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
      include: { esercizi: { orderBy: { id: 'asc' } } },
    });
    res.json(schede);
    return;
  }

  // Trainer: ?clienteId=3 per vedere le schede di quel cliente
  const clienteIdQuery = req.query.clienteId ? Number(req.query.clienteId) : undefined;
  const schede = await prisma.scheda.findMany({
    where: clienteIdQuery ? { clienteId: clienteIdQuery } : undefined,
    include: { esercizi: { orderBy: { id: 'asc' } } },
  });
  res.json(schede);
});

// In modifica, un esercizio può avere un id (esiste già) oppure no (appena aggiunto).
const esercizioModificaSchema = esercizioSchema.extend({
  id: z.number().int().optional(),
});

const modificaSchedaSchema = z.object({
  nome: z.string().min(1, 'Il nome della scheda non può essere vuoto'),
  clienteId: z.number().int().optional(),
  // Se assente, la PUT fa solo la rinomina (compatibile con l'uso precedente).
  esercizi: z.array(esercizioModificaSchema).min(1, 'Serve almeno un esercizio').optional(),
});

// Modifica completa di una scheda: nome, cliente assegnato ed elenco esercizi.
router.put('/schede/:id', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = Number(req.params.id);
  const risultato = modificaSchedaSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { nome, clienteId, esercizi } = risultato.data;

  const esistente = await prisma.scheda.findUnique({ where: { id }, include: { esercizi: true } });
  if (!esistente) {
    res.status(404).json({ errore: 'Scheda non trovata' });
    return;
  }

  if (clienteId !== undefined) {
    const cliente = await prisma.user.findUnique({ where: { id: clienteId } });
    if (!cliente || cliente.ruolo !== 'CLIENTE') {
      res.status(400).json({ errore: 'clienteId non valido' });
      return;
    }
  }

  // Gli id mandati dal client devono appartenere a QUESTA scheda: altrimenti
  // si potrebbe "rubare" e modificare l'esercizio di un'altra scheda.
  const idEsistenti = new Set<number>(esistente.esercizi.map((e) => e.id));
  if (esercizi?.some((e) => e.id !== undefined && !idEsistenti.has(e.id))) {
    res.status(400).json({ errore: 'Esercizio non appartenente a questa scheda' });
    return;
  }

  // Transazione: o vanno a buon fine tutte le operazioni, o nessuna.
  // Evita schede "a metà" se qualcosa fallisce in mezzo.
  const scheda = await prisma.$transaction(async (tx) => {
    await tx.scheda.update({ where: { id }, data: { nome, clienteId } });

    if (esercizi) {
      const idMantenuti = new Set<number>(
        esercizi.flatMap((e) => (e.id !== undefined ? [e.id] : []))
      );

      // 1) Esercizi tolti dal trainer: cancellati (con il loro storico, via cascade).
      const daCancellare = [...idEsistenti].filter((eid) => !idMantenuti.has(eid));
      if (daCancellare.length > 0) {
        await tx.esercizio.deleteMany({ where: { id: { in: daCancellare } } });
      }

      for (const { id: esercizioId, ...dati } of esercizi) {
        // Campi opzionali svuotati → null, altrimenti Prisma lascerebbe il vecchio valore.
        const campi = { ...dati, videoUrl: dati.videoUrl ?? null, descrizione: dati.descrizione ?? null };
        if (esercizioId !== undefined) {
          // 2) Esercizi mantenuti: aggiornati sul posto → lo storico del cliente resta intatto.
          await tx.esercizio.update({ where: { id: esercizioId }, data: campi });
        } else {
          // 3) Esercizi nuovi: creati.
          await tx.esercizio.create({ data: { ...campi, schedaId: id } });
        }
      }
    }

    return tx.scheda.findUnique({ where: { id }, include: { esercizi: { orderBy: { id: 'asc' } } } });
  });

  res.json(scheda);
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
