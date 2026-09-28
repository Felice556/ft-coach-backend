import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo } from '../middleware/auth.js';

const router = Router();

const presetSchema = z.object({
  nome: z.string().min(1),
  videoUrl: z.string().url().optional(),
  descrizione: z.string().optional(),
});

// Solo il trainer costruisce la propria libreria — ogni trainer vede solo i propri preset,
// non quelli di eventuali altri trainer (stesso principio di isolamento dati di sempre).
router.post('/preset-esercizi', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const risultato = presetSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const trainerId = (req as any).userId as number;

  const preset = await prisma.esercizioPreset.create({
    data: { ...risultato.data, trainerId },
  });
  res.status(201).json(preset);
});

router.get('/preset-esercizi', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const trainerId = (req as any).userId as number;
  const preset = await prisma.esercizioPreset.findMany({
    where: { trainerId },
    orderBy: { nome: 'asc' },
  });
  res.json(preset);
});

router.delete('/preset-esercizi/:id', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = Number(req.params.id);
  const trainerId = (req as any).userId as number;

  // where: { id, trainerId } invece di solo { id }: così un trainer non può
  // cancellare per sbaglio (o di proposito) il preset di un altro trainer.
  const risultato = await prisma.esercizioPreset.deleteMany({ where: { id, trainerId } });
  if (risultato.count === 0) {
    res.status(404).json({ errore: 'Preset non trovato' });
    return;
  }
  res.status(204).send();
});

export default router;
