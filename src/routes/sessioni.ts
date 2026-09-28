import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo } from '../middleware/auth.js';

const router = Router();

const completaSchema = z.object({
  schedaId: z.number().int(),
  // Mezzanotte "di oggi" secondo il telefono del cliente, in formato ISO.
  // Serve perché il server (es. Render) gira in UTC e non sa quando inizia
  // la giornata in Italia: il telefono lo sa.
  inizioGiornata: z.string().datetime(),
});

// Il cliente chiude l'allenamento: il backend conta le serie di oggi e salva la sessione.
router.post('/sessioni', autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const risultato = completaSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const clienteId = (req as any).userId as number;
  const { schedaId } = risultato.data;
  const inizio = new Date(risultato.data.inizioGiornata);

  // Controllo di buon senso: "l'inizio della giornata" deve essere nelle ultime 36 ore,
  // altrimenti qualcuno potrebbe far contare serie di giorni precedenti.
  const oreFa = (Date.now() - inizio.getTime()) / 3_600_000;
  if (oreFa < 0 || oreFa > 36) {
    res.status(400).json({ errore: 'inizioGiornata non valido' });
    return;
  }

  // La scheda deve essere di questo cliente (isolamento dati, come sempre).
  const scheda = await prisma.scheda.findFirst({
    where: { id: schedaId, clienteId },
    include: { esercizi: true },
  });
  if (!scheda) {
    res.status(404).json({ errore: 'Scheda non trovata' });
    return;
  }

  const registri = await prisma.registroAllenamento.findMany({
    where: { clienteId, esercizioId: { in: scheda.esercizi.map((e) => e.id) }, data: { gte: inizio } },
  });

  // Serie fatte: per ogni esercizio al massimo quelle previste (una serie in più non "compensa" un esercizio saltato).
  let serieFatte = 0;
  let serieTotali = 0;
  for (const es of scheda.esercizi) {
    serieTotali += es.serieTarget;
    const fatte = registri.filter((r) => r.esercizioId === es.id).length;
    serieFatte += Math.min(es.serieTarget, fatte);
  }
  const volume = registri.reduce((acc, r) => acc + r.pesoUsato * r.repsFatte, 0);

  const sessione = await prisma.sessioneAllenamento.create({
    data: { schedaId, clienteId, serieFatte, serieTotali, volume },
    // Stessa forma della GET, così il frontend usa un solo tipo.
    include: { scheda: { select: { nome: true } }, cliente: { select: { nome: true } } },
  });
  res.status(201).json(sessione);
});

// Elenco sessioni: il cliente vede le proprie; il trainer quelle di tutti
// (o di un cliente con ?clienteId=), con nome cliente e nome scheda.
router.get('/sessioni', autentica, async (req, res) => {
  const userId = (req as any).userId as number;
  const ruolo = (req as any).ruolo as string;

  const filtroCliente =
    ruolo === 'CLIENTE' ? userId : req.query.clienteId ? Number(req.query.clienteId) : undefined;

  const sessioni = await prisma.sessioneAllenamento.findMany({
    where: filtroCliente !== undefined ? { clienteId: filtroCliente } : undefined,
    orderBy: { completataIl: 'desc' },
    take: 50, // ultime 50: basta e avanza per una schermata da telefono
    include: {
      scheda: { select: { nome: true } },
      cliente: { select: { nome: true } },
    },
  });
  res.json(sessioni);
});

// "Riprendi allenamento": il cliente annulla una chiusura fatta per sbaglio.
// Le serie registrate NON vengono toccate: si cancella solo il segno di "concluso".
router.delete('/sessioni/:id', autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const id = Number(req.params.id);
  const clienteId = (req as any).userId as number;

  const { count } = await prisma.sessioneAllenamento.deleteMany({ where: { id, clienteId } });
  if (count === 0) {
    res.status(404).json({ errore: 'Sessione non trovata' });
    return;
  }
  res.status(204).send();
});

export default router;
