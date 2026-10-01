import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo } from '../middleware/auth.js';
import { leggiId, leggiIdFacoltativo } from '../utils.js';

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

  // La scheda deve essere di questo cliente (isolamento dati, come sempre) e attiva.
  // Contano solo gli esercizi attivi: quelli tolti dal trainer non fanno più parte del programma.
  const scheda = await prisma.scheda.findFirst({
    where: { id: schedaId, clienteId, archiviataIl: null },
    include: { esercizi: { where: { archiviatoIl: null }, include: { serieExtra: true } } },
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
    // Serie previste = quelle normali + quelle "diverse" aggiunte dal trainer.
    const previste = es.serieTarget + es.serieExtra.length;
    serieTotali += previste;
    const fatte = registri.filter((r) => r.esercizioId === es.id).length;
    serieFatte += Math.min(previste, fatte);
  }
  const volume = registri.reduce((acc, r) => acc + r.pesoUsato * r.repsFatte, 0);

  // Se oggi questa scheda era già stata completata (es. il cliente l'ha riaperta per
  // fare un'altra serie), AGGIORNIAMO quella sessione invece di crearne un doppione.
  const includi = { scheda: { select: { nome: true } }, cliente: { select: { nome: true } } };
  const giaCompletata = await prisma.sessioneAllenamento.findFirst({
    where: { schedaId, clienteId, completataIl: { gte: inizio } },
    orderBy: { completataIl: 'desc' },
  });

  const sessione = giaCompletata
    ? await prisma.sessioneAllenamento.update({
        where: { id: giaCompletata.id },
        data: { serieFatte, serieTotali, volume, completataIl: new Date() },
        include: includi,
      })
    : await prisma.sessioneAllenamento.create({
        data: { schedaId, clienteId, serieFatte, serieTotali, volume },
        // Stessa forma della GET, così il frontend usa un solo tipo.
        include: includi,
      });
  res.status(giaCompletata ? 200 : 201).json(sessione);
});

// Elenco sessioni: il cliente vede le proprie; il trainer quelle di tutti
// (o di un cliente con ?clienteId=), con nome cliente e nome scheda.
router.get('/sessioni', autentica, async (req, res) => {
  const userId = (req as any).userId as number;
  const ruolo = (req as any).ruolo as string;

  // Il cliente vede solo le proprie; il trainer tutte, o quelle di ?clienteId=…
  let filtroCliente: number | undefined;
  if (ruolo === 'CLIENTE') {
    filtroCliente = userId;
  } else {
    const daQuery = leggiIdFacoltativo(req.query.clienteId, res);
    if (daQuery === null) return;
    filtroCliente = daQuery;
  }

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

// Feedback a fine allenamento: una nota e un voto di fatica da 1 a 10, entrambi facoltativi.
// Mandare null (o una nota vuota) toglie quel valore.
const feedbackSchema = z.object({
  nota: z.string().trim().max(1000).nullable(),
  fatica: z.number().int().min(1).max(10).nullable(),
});

// Solo il cliente scrive il feedback, e solo sui propri allenamenti.
router.put('/sessioni/:id/feedback', autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const risultato = feedbackSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const clienteId = (req as any).userId as number;
  const { count } = await prisma.sessioneAllenamento.updateMany({
    where: { id, clienteId },
    data: { nota: risultato.data.nota || null, fatica: risultato.data.fatica },
  });
  if (count === 0) {
    // 404 anche se esiste ma è di un altro cliente: così non si scopre nemmeno che c'è.
    res.status(404).json({ errore: 'Allenamento non trovato' });
    return;
  }
  const sessione = await prisma.sessioneAllenamento.findUnique({
    where: { id },
    include: { scheda: { select: { nome: true } }, cliente: { select: { nome: true } } },
  });
  res.json(sessione);
});

// Nota: NON esiste una rotta per cancellare un allenamento concluso.
// "Riprendi allenamento" riapre soltanto la scheda: quando il cliente ripreme
// "Allenamento completato", la POST qui sopra AGGIORNA la sessione di oggi.
// Così nessun tocco sbagliato può far sparire un allenamento dallo storico.

export default router;
