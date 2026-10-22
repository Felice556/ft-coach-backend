import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeAdmin, richiedeRuolo } from '../middleware/auth.js';

const router = Router();

// Programmi Liftio "in arrivo": per ora si possono solo guardare e chiedere di essere avvisati.
// Le chiavi stanno qui (non le decide il telefono): così nel database non finiscono valori a caso.
// Testi e dettagli dei programmi stanno nell'app.
// Tre livelli: principiante, intermedio, avanzato.
export const PROGRAMMI_IN_ARRIVO = ['principiante', 'intermedio', 'avanzato'] as const;

const avvisoSchema = z.object({ attivo: z.boolean() });

const annuncioSchema = z.object({
  messaggio: z.string().trim().min(1, 'Scrivi il messaggio').max(300, 'Il messaggio può avere al massimo 300 caratteri'),
});

// I programmi per cui chi chiede ha toccato "Avvisami", e gli annunci dell'amministratore
// su quei programmi che non ha ancora visto (per il pallino su "Programmi").
router.get('/programmi/avvisi', autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const righe = await prisma.avvisoProgramma.findMany({
    where: { userId: (req as any).userId as number },
    select: { programma: true, annuncioVistoIl: true },
    orderBy: { id: 'asc' },
  });
  const annunci = righe.length
    ? await prisma.annuncioProgramma.findMany({
        where: { OR: righe.map((r) => ({ programma: r.programma, ...(r.annuncioVistoIl ? { creatoIl: { gt: r.annuncioVistoIl } } : {}) })) },
        orderBy: { creatoIl: 'desc' },
        take: 10,
        select: { id: true, programma: true, messaggio: true, creatoIl: true },
      })
    : [];
  res.json({ avvisi: righe.map((r) => r.programma), annunci });
});

// "Ok, visto": gli annunci arrivati fin qui non accendono più il pallino.
router.post('/programmi/annunci/visti', autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  await prisma.avvisoProgramma.updateMany({ where: { userId: (req as any).userId as number }, data: { annuncioVistoIl: new Date() } });
  res.status(204).send();
});

// "Avvisami" (attivo: true) oppure "Non avvisarmi più" (attivo: false). Ripeterlo non crea doppioni.
router.put('/programmi/:chiave/avviso', autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const programma = PROGRAMMI_IN_ARRIVO.find((p) => p === req.params.chiave);
  if (!programma) {
    res.status(404).json({ errore: 'Programma non trovato' });
    return;
  }
  const risultato = avvisoSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const userId = (req as any).userId as number;
  if (risultato.data.attivo) {
    await prisma.avvisoProgramma.upsert({
      where: { userId_programma: { userId, programma } },
      create: { userId, programma },
      update: {},
    });
  } else {
    await prisma.avvisoProgramma.deleteMany({ where: { userId, programma } });
  }
  res.json({ programma, attivo: risultato.data.attivo });
});

// Solo l'amministratore: quante persone aspettano ogni programma (solo numeri, nessun nome),
// quando è arrivato l'ultimo "Avvisami" (per il suo pallino) e l'ultimo annuncio mandato per programma.
router.get('/admin/programmi', autentica, richiedeAdmin, async (_req, res) => {
  const [gruppi, ultimo, annunci] = await Promise.all([
    prisma.avvisoProgramma.groupBy({ by: ['programma'], _count: { _all: true } }),
    prisma.avvisoProgramma.findFirst({ orderBy: { creatoIl: 'desc' }, select: { creatoIl: true } }),
    prisma.annuncioProgramma.findMany({ orderBy: { creatoIl: 'desc' }, take: 30, select: { programma: true, messaggio: true, creatoIl: true } }),
  ]);
  const conteggi = Object.fromEntries(PROGRAMMI_IN_ARRIVO.map((p) => [p, 0]));
  for (const g of gruppi) if (g.programma in conteggi) conteggi[g.programma] = g._count._all;
  const ultimiAnnunci: Record<string, { messaggio: string; creatoIl: Date }> = {};
  for (const a of annunci) ultimiAnnunci[a.programma] ??= { messaggio: a.messaggio, creatoIl: a.creatoIl };
  res.json({ conteggi, ultimoAvvisoIl: ultimo?.creatoIl ?? null, ultimiAnnunci });
});

// Solo l'amministratore: manda un messaggio a chi aspetta un programma. Lo vedranno nell'app
// (pallino su "Programmi"). Risponde con quante persone lo riceveranno.
router.post('/admin/programmi/:chiave/annuncio', autentica, richiedeAdmin, async (req, res) => {
  const programma = PROGRAMMI_IN_ARRIVO.find((p) => p === req.params.chiave);
  if (!programma) {
    res.status(404).json({ errore: 'Programma non trovato' });
    return;
  }
  const risultato = annuncioSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const [annuncio, destinatari] = await Promise.all([
    prisma.annuncioProgramma.create({ data: { programma, messaggio: risultato.data.messaggio }, select: { id: true, programma: true, messaggio: true, creatoIl: true } }),
    prisma.avvisoProgramma.count({ where: { programma } }),
  ]);
  res.status(201).json({ ...annuncio, destinatari });
});

export default router;
