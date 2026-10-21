import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica } from '../middleware/auth.js';
import { clienteDelTrainer } from '../proprieta.js';
import { leggiId, leggiIdFacoltativo } from '../utils.js';

const router = Router();

// Cardio e passi, una sezione a parte rispetto alle schede di allenamento:
// - il TRAINER decide il piano cardio del cliente (attività, minuti, volte a settimana)
//   e l'obiettivo di passi al giorno;
// - il CLIENTE segna il cardio che ha fatto e i passi di ogni giorno.
// Entrambi vedono tutto (il cliente solo i propri dati, il trainer solo quelli dei suoi clienti).

const MAX_OBIETTIVI = 10; // attività nel piano di un cliente
const GIORNI_STORICO_CARDIO = 120;
const GIORNI_STORICO_PASSI = 90;

// "2026-10-21" → giorno valido, non nel futuro (con un giorno di margine per i fusi orari).
const giornoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
    return d.getTime() <= Date.now() + 24 * 60 * 60 * 1000 && d.getUTCFullYear() >= 2000;
  }, 'Data non valida o nel futuro');

const attivitaSchema = z.string().trim().min(1, 'Scrivi l’attività').max(60, 'Il nome dell’attività è troppo lungo');
const notaSchema = z.string().trim().max(200, 'La nota può avere al massimo 200 caratteri').optional();
const idSchema = z.number().int().positive().max(2147483647);

const obiettivoSchema = z.object({
  attivita: attivitaSchema,
  minuti: z.number().int().min(1, 'Minuti tra 1 e 600').max(600, 'Minuti tra 1 e 600'),
  volteSettimana: z.number().int().min(1, 'Da 1 a 14 volte a settimana').max(14, 'Da 1 a 14 volte a settimana'),
  nota: notaSchema,
});

const sessioneSchema = z.object({
  attivita: attivitaSchema,
  minuti: z.number().int().min(1, 'Minuti tra 1 e 600').max(600, 'Minuti tra 1 e 600'),
  distanzaKm: z.number().min(0, 'Distanza tra 0 e 300 km').max(300, 'Distanza tra 0 e 300 km').nullable().optional(),
  nota: notaSchema,
  data: giornoSchema,
  obiettivoId: idSchema.nullable().optional(),
});

const passiSchema = z.object({
  data: giornoSchema,
  passi: z.number().int().min(0, 'Passi tra 0 e 100.000').max(100000, 'Passi tra 0 e 100.000'),
});

const obiettivoPassiSchema = z.object({
  clienteId: idSchema,
  // null = nessun obiettivo
  passi: z.number().int().min(1000, 'Obiettivo tra 1.000 e 50.000 passi').max(50000, 'Obiettivo tra 1.000 e 50.000 passi').nullable(),
});

const campiObiettivo = { id: true, attivita: true, minuti: true, volteSettimana: true, nota: true } as const;
const campiSessione = { id: true, attivita: true, minuti: true, distanzaKm: true, nota: true, data: true, obiettivoId: true } as const;
const campiPassi = { id: true, passi: true, data: true } as const;

const soloTrainer = (req: any, res: any) => {
  if (req.ruolo === 'TRAINER') return true;
  res.status(403).json({ errore: 'Il piano cardio lo decide il trainer' });
  return false;
};
const soloCliente = (req: any, res: any) => {
  if (req.ruolo === 'CLIENTE') return true;
  res.status(403).json({ errore: 'Cardio fatto e passi li inserisce il cliente' });
  return false;
};

const giorniFa = (n: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

// Tutto il cardio di un cliente, in una richiesta sola.
// Cliente: GET /cardio   ·   Trainer: GET /cardio?clienteId=5
router.get('/cardio', autentica, async (req, res) => {
  const ruolo = (req as any).ruolo as 'CLIENTE' | 'TRAINER';
  const utenteId = (req as any).userId as number;
  let clienteId = utenteId;
  if (ruolo === 'TRAINER') {
    const richiesto = leggiIdFacoltativo(req.query.clienteId, res);
    if (richiesto === null) return;
    if (!richiesto) {
      res.status(400).json({ errore: 'Indica il cliente' });
      return;
    }
    if (!(await clienteDelTrainer(utenteId, richiesto))) {
      res.status(404).json({ errore: 'Cliente non trovato' });
      return;
    }
    clienteId = richiesto;
  }

  const [cliente, obiettivi, sessioni, passi] = await Promise.all([
    prisma.user.findUnique({ where: { id: clienteId }, select: { obiettivoPassi: true } }),
    prisma.obiettivoCardio.findMany({ where: { clienteId }, orderBy: { id: 'asc' }, select: campiObiettivo }),
    prisma.cardioFatto.findMany({
      where: { clienteId, data: { gte: giorniFa(GIORNI_STORICO_CARDIO) } },
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
      select: campiSessione,
    }),
    prisma.passiGiornalieri.findMany({
      where: { clienteId, data: { gte: giorniFa(GIORNI_STORICO_PASSI) } },
      orderBy: { data: 'asc' },
      select: campiPassi,
    }),
  ]);
  res.json({ obiettivoPassi: cliente?.obiettivoPassi ?? null, obiettivi, sessioni, passi });
});

// ---------- Trainer: piano cardio e obiettivo passi ----------

router.post('/cardio/obiettivi', autentica, async (req, res) => {
  if (!soloTrainer(req, res)) return;
  const risultato = obiettivoSchema.extend({ clienteId: idSchema }).safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { clienteId, attivita, minuti, volteSettimana, nota } = risultato.data;
  if (!(await clienteDelTrainer((req as any).userId, clienteId))) {
    res.status(404).json({ errore: 'Cliente non trovato' });
    return;
  }
  if ((await prisma.obiettivoCardio.count({ where: { clienteId } })) >= MAX_OBIETTIVI) {
    res.status(400).json({ errore: 'Il piano cardio può avere al massimo 10 attività' });
    return;
  }
  const obiettivo = await prisma.obiettivoCardio.create({
    data: { clienteId, attivita, minuti, volteSettimana, nota: nota || null },
    select: campiObiettivo,
  });
  res.status(201).json(obiettivo);
});

// L'attività del piano, solo se è di un cliente di questo trainer.
async function obiettivoDelTrainer(id: number, trainerId: number) {
  return prisma.obiettivoCardio.findFirst({ where: { id, cliente: { trainerId } } });
}

router.put('/cardio/obiettivi/:id', autentica, async (req, res) => {
  if (!soloTrainer(req, res)) return;
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const risultato = obiettivoSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  if (!(await obiettivoDelTrainer(id, (req as any).userId))) {
    res.status(404).json({ errore: 'Attività cardio non trovata' });
    return;
  }
  const { attivita, minuti, volteSettimana, nota } = risultato.data;
  const obiettivo = await prisma.obiettivoCardio.update({
    where: { id },
    data: { attivita, minuti, volteSettimana, nota: nota || null },
    select: campiObiettivo,
  });
  res.json(obiettivo);
});

// Togliere un'attività dal piano: il cardio già fatto dal cliente resta (perde solo il collegamento).
router.delete('/cardio/obiettivi/:id', autentica, async (req, res) => {
  if (!soloTrainer(req, res)) return;
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  if (!(await obiettivoDelTrainer(id, (req as any).userId))) {
    res.status(404).json({ errore: 'Attività cardio non trovata' });
    return;
  }
  await prisma.obiettivoCardio.delete({ where: { id } });
  res.status(204).send();
});

router.put('/cardio/obiettivo-passi', autentica, async (req, res) => {
  if (!soloTrainer(req, res)) return;
  const risultato = obiettivoPassiSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { clienteId, passi } = risultato.data;
  if (!(await clienteDelTrainer((req as any).userId, clienteId))) {
    res.status(404).json({ errore: 'Cliente non trovato' });
    return;
  }
  await prisma.user.update({ where: { id: clienteId }, data: { obiettivoPassi: passi } });
  res.json({ obiettivoPassi: passi });
});

// ---------- Cliente: cardio fatto e passi ----------

router.post('/cardio/sessioni', autentica, async (req, res) => {
  if (!soloCliente(req, res)) return;
  const risultato = sessioneSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const clienteId = (req as any).userId as number;
  const { attivita, minuti, distanzaKm, nota, data, obiettivoId } = risultato.data;
  // L'attività del piano deve essere sua (non di un altro cliente).
  if (obiettivoId && !(await prisma.obiettivoCardio.findFirst({ where: { id: obiettivoId, clienteId } }))) {
    res.status(404).json({ errore: 'Attività cardio non trovata' });
    return;
  }
  const sessione = await prisma.cardioFatto.create({
    data: {
      clienteId,
      attivita,
      minuti,
      distanzaKm: distanzaKm == null ? null : Math.round(distanzaKm * 100) / 100,
      nota: nota || null,
      data: new Date(`${data}T00:00:00Z`),
      obiettivoId: obiettivoId ?? null,
    },
    select: campiSessione,
  });
  res.status(201).json(sessione);
});

router.delete('/cardio/sessioni/:id', autentica, async (req, res) => {
  if (!soloCliente(req, res)) return;
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const cancellate = await prisma.cardioFatto.deleteMany({ where: { id, clienteId: (req as any).userId } });
  if (cancellate.count === 0) {
    res.status(404).json({ errore: 'Sessione di cardio non trovata' });
    return;
  }
  res.status(204).send();
});

// Passi di un giorno: se quel giorno ci sono già, vengono corretti (non duplicati).
router.put('/cardio/passi', autentica, async (req, res) => {
  if (!soloCliente(req, res)) return;
  const risultato = passiSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const clienteId = (req as any).userId as number;
  const giorno = new Date(`${risultato.data.data}T00:00:00Z`);
  const riga = await prisma.passiGiornalieri.upsert({
    where: { clienteId_data: { clienteId, data: giorno } },
    create: { clienteId, data: giorno, passi: risultato.data.passi },
    update: { passi: risultato.data.passi },
    select: campiPassi,
  });
  res.json(riga);
});

export default router;
