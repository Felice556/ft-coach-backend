import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo } from '../middleware/auth.js';
import { leggiId, leggiIdFacoltativo, linkVideoSchema } from '../utils.js';

const router = Router();

// Una serie aggiunta dal trainer dopo le serie normali, con numeri propri.
// Ripetizioni: un numero, oppure null per "Max" (a cedimento).
// Per un intervallo ("6-9") si usa anche il massimo: reps = 6, repsMax = 9.
// Tetti ragionevoli su tutti i numeri e i testi: un errore di battitura (o una richiesta
// fatta apposta) non può riempire il database di valori assurdi.
const repsSchema = z.number().int().positive().max(1000).nullable();
const repsMaxSchema = z.number().int().positive().max(1000).nullable().default(null);

const serieExtraSchema = z.object({
  reps: repsSchema,
  repsMax: repsMaxSchema,
  recuperoSecondi: z.number().int().min(0).max(3600),
  nota: z.string().max(200).optional(),
});
type SerieExtraInput = z.infer<typeof serieExtraSchema>;

const esercizioSchema = z.object({
  nome: z.string().trim().min(1, 'Il nome dell’esercizio non può essere vuoto').max(100),
  videoUrl: linkVideoSchema.optional(),
  descrizione: z.string().max(1000).optional(),
  serieTarget: z.number().int().positive().max(20),
  repsTarget: repsSchema,
  repsMax: repsMaxSchema,
  recuperoSecondi: z.number().int().min(0).max(3600), // 0 = nessun recupero (es. superserie)
  serieExtra: z.array(serieExtraSchema).max(10).default([]),
});

// Un massimo ha senso solo se c'è un minimo ed è più grande: altrimenti lo ignoriamo,
// così nel database non finiscono mai intervalli incoerenti tipo "Max-9" o "9-6".
function massimoValido(min: number | null, max: number | null): number | null {
  return min != null && max != null && max > min ? max : null;
}

// Ogni lettura di una scheda porta con sé gli esercizi ATTIVI (non archiviati)
// e le loro serie extra, sempre nello stesso ordine.
const conEsercizi = {
  esercizi: {
    where: { archiviatoIl: null },
    orderBy: { id: 'asc' as const },
    include: { serieExtra: { orderBy: { ordine: 'asc' as const } } },
  },
};

// Da [{reps, recuperoSecondi, nota}] al formato che Prisma vuole per crearle,
// con l'ordine esplicito (0, 1, 2…) e la nota vuota salvata come null.
function datiSerieExtra(extra: SerieExtraInput[]) {
  return extra.map((s, i) => ({
    ordine: i,
    reps: s.reps,
    repsMax: massimoValido(s.reps, s.repsMax),
    recuperoSecondi: s.recuperoSecondi,
    nota: s.nota || null,
  }));
}

const schedaSchema = z.object({
  nome: z.string().trim().min(1, 'Il nome della scheda non può essere vuoto').max(100),
  clienteId: z.number().int(),
  esercizi: z.array(esercizioSchema).min(1, 'Serve almeno un esercizio'),
});

async function eUnCliente(clienteId: number) {
  const cliente = await prisma.user.findUnique({ where: { id: clienteId } });
  return cliente?.ruolo === 'CLIENTE';
}

// Solo il TRAINER crea schede, e le assegna a un cliente specifico.
router.post('/schede', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const risultato = schedaSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { nome, clienteId, esercizi } = risultato.data;

  // Verifica che il clienteId passato sia davvero un CLIENTE e non un altro trainer.
  if (!(await eUnCliente(clienteId))) {
    res.status(400).json({ errore: 'Cliente non valido: controlla l’ID del cliente' });
    return;
  }

  const scheda = await prisma.scheda.create({
    data: {
      nome,
      clienteId,
      // Creazione annidata su tre livelli: scheda → esercizi → serie extra, in un colpo solo.
      esercizi: {
        create: esercizi.map(({ serieExtra, ...es }) => ({
          ...es,
          repsMax: massimoValido(es.repsTarget, es.repsMax),
          serieExtra: { create: datiSerieExtra(serieExtra) },
        })),
      },
    },
    include: conEsercizi,
  });

  res.status(201).json(scheda);
});

// Elenco schede ATTIVE. Il CLIENTE vede solo le proprie; il TRAINER tutte
// (o quelle di un cliente con ?clienteId=3). Con ?archiviate=1 il trainer vede l'archivio.
router.get('/schede', autentica, async (req, res) => {
  const userId = (req as any).userId as number;
  const ruolo = (req as any).ruolo as string;

  if (ruolo === 'CLIENTE') {
    const schede = await prisma.scheda.findMany({
      where: { clienteId: userId, archiviataIl: null },
      orderBy: { id: 'asc' },
      include: conEsercizi,
    });
    res.json(schede);
    return;
  }

  const clienteIdQuery = leggiIdFacoltativo(req.query.clienteId, res);
  if (clienteIdQuery === null) return;
  const archiviate = req.query.archiviate === '1';

  const schede = await prisma.scheda.findMany({
    where: {
      ...(clienteIdQuery ? { clienteId: clienteIdQuery } : {}),
      archiviataIl: archiviate ? { not: null } : null,
    },
    // Trainer: dalla più recente alla più vecchia. A parità di data (es. schede create prima
    // che esistesse la data) conta l'id, che cresce con l'ordine di creazione.
    orderBy: archiviate ? { archiviataIl: 'desc' } : [{ creataIl: 'desc' }, { id: 'desc' }],
    include: conEsercizi,
  });

  if (!archiviate) {
    res.json(schede);
    return;
  }

  // Per l'archivio diciamo anche se la scheda ha storico (serie o allenamenti conclusi):
  // serve al frontend per sapere se l'eliminazione definitiva è possibile.
  const conStorico = await Promise.all(
    schede.map(async (s) => ({ ...s, haStorico: await haStorico(s.id) }))
  );
  res.json(conStorico);
});

// true se la scheda ha anche una sola serie registrata (in qualsiasi esercizio,
// archiviati compresi) o un allenamento concluso.
async function haStorico(schedaId: number): Promise<boolean> {
  const [serie, sessioni] = await Promise.all([
    prisma.registroAllenamento.count({ where: { esercizio: { schedaId } } }),
    prisma.sessioneAllenamento.count({ where: { schedaId } }),
  ]);
  return serie > 0 || sessioni > 0;
}

// In modifica, un esercizio può avere un id (esiste già) oppure no (appena aggiunto).
const esercizioModificaSchema = esercizioSchema.extend({
  id: z.number().int().optional(),
});

const modificaSchedaSchema = z.object({
  nome: z.string().trim().min(1, 'Il nome della scheda non può essere vuoto').max(100),
  clienteId: z.number().int().optional(),
  // Se assente, la PUT fa solo la rinomina (compatibile con l'uso precedente).
  esercizi: z.array(esercizioModificaSchema).min(1, 'Serve almeno un esercizio').optional(),
});

// Modifica completa di una scheda: nome, cliente assegnato ed elenco esercizi.
router.put('/schede/:id', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const risultato = modificaSchedaSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { nome, clienteId, esercizi } = risultato.data;

  const esistente = await prisma.scheda.findUnique({
    where: { id },
    include: { esercizi: { where: { archiviatoIl: null } } },
  });
  if (!esistente) {
    res.status(404).json({ errore: 'Scheda non trovata' });
    return;
  }
  if (esistente.archiviataIl) {
    res.status(400).json({ errore: 'La scheda è archiviata: ripristinala prima di modificarla' });
    return;
  }

  if (clienteId !== undefined && !(await eUnCliente(clienteId))) {
    res.status(400).json({ errore: 'Cliente non valido: controlla l’ID del cliente' });
    return;
  }

  // Spostare a un altro cliente una scheda che ha già storico porterebbe con sé le serie
  // e le note del primo cliente (che perderebbe l'accesso ai suoi dati). Lo impediamo:
  // per l'altro cliente si crea una scheda nuova.
  if (clienteId !== undefined && clienteId !== esistente.clienteId && (await haStorico(id))) {
    res.status(409).json({
      errore: 'Questa scheda ha già allenamenti registrati: non si può assegnare a un altro cliente. Creane una nuova per lui.',
    });
    return;
  }

  // Gli id mandati dal client devono appartenere a QUESTA scheda (ed essere attivi):
  // altrimenti si potrebbe "rubare" e modificare l'esercizio di un'altra scheda.
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

      // 1) Esercizi tolti dal trainer: ARCHIVIATI, non cancellati.
      //    Escono dalla scheda, ma le serie registrate dal cliente restano nel database.
      const daArchiviare = [...idEsistenti].filter((eid) => !idMantenuti.has(eid));
      if (daArchiviare.length > 0) {
        await tx.esercizio.updateMany({
          where: { id: { in: daArchiviare } },
          data: { archiviatoIl: new Date() },
        });
      }

      for (const { id: esercizioId, serieExtra, ...dati } of esercizi) {
        // Campi opzionali svuotati → null, altrimenti Prisma lascerebbe il vecchio valore.
        const campi = {
          ...dati,
          repsMax: massimoValido(dati.repsTarget, dati.repsMax),
          videoUrl: dati.videoUrl ?? null,
          descrizione: dati.descrizione ?? null,
        };
        if (esercizioId !== undefined) {
          // 2) Esercizi mantenuti: aggiornati sul posto → lo storico del cliente resta intatto.
          //    Le serie extra invece si sostituiscono in blocco: non hanno storico collegato,
          //    quindi cancellarle e ricrearle è la strada più semplice e sicura.
          await tx.esercizio.update({
            where: { id: esercizioId },
            data: { ...campi, serieExtra: { deleteMany: {}, create: datiSerieExtra(serieExtra) } },
          });
        } else {
          // 3) Esercizi nuovi: creati insieme alle loro serie extra.
          await tx.esercizio.create({
            data: { ...campi, schedaId: id, serieExtra: { create: datiSerieExtra(serieExtra) } },
          });
        }
      }
    }

    return tx.scheda.findUnique({ where: { id }, include: conEsercizi });
  });

  res.json(scheda);
});

// ---------- Archiviazione: al posto della cancellazione ----------

// "Archivia": la scheda sparisce dalle viste (anche da quella del cliente),
// ma resta nel database con esercizi, serie registrate e allenamenti conclusi.
router.post('/schede/:id/archivia', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const { count } = await prisma.scheda.updateMany({
    where: { id, archiviataIl: null },
    data: { archiviataIl: new Date() },
  });
  if (count === 0) {
    res.status(404).json({ errore: 'Scheda non trovata o già archiviata' });
    return;
  }
  res.status(204).send();
});

router.post('/schede/:id/ripristina', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const { count } = await prisma.scheda.updateMany({
    where: { id, archiviataIl: { not: null } },
    data: { archiviataIl: null },
  });
  if (count === 0) {
    res.status(404).json({ errore: 'Scheda non trovata o non archiviata' });
    return;
  }
  res.status(204).send();
});

// Eliminazione DEFINITIVA: solo per schede già archiviate e SENZA storico
// (es. una scheda creata per sbaglio). Se il cliente ha registrato anche una sola
// serie, la scheda non si può eliminare: resta in archivio per sempre.
// Anche se questo controllo avesse un bug, il database stesso rifiuterebbe
// (onDelete: Restrict su serie e allenamenti conclusi).
router.delete('/schede/:id', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const scheda = await prisma.scheda.findUnique({ where: { id } });
  if (!scheda) {
    res.status(404).json({ errore: 'Scheda non trovata' });
    return;
  }
  if (!scheda.archiviataIl) {
    res.status(400).json({ errore: 'Archivia la scheda prima di eliminarla definitivamente' });
    return;
  }
  if (await haStorico(id)) {
    res.status(409).json({
      errore: 'Questa scheda ha allenamenti registrati: per proteggere i dati del cliente resta in archivio',
    });
    return;
  }
  await prisma.scheda.delete({ where: { id } }); // cascade su esercizi e serie extra (senza storico)
  res.status(204).send();
});

// ---------- Singolo esercizio ----------

// Per la modifica singola le serie extra sono facoltative: se non le mandi, restano come sono.
const modificaEsercizioSchema = esercizioSchema.partial().extend({
  serieExtra: z.array(serieExtraSchema).max(10).optional(),
});

// Modifica un singolo esercizio (es. solo il recupero, senza toccare il resto della scheda).
router.put('/esercizi/:id', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const risultato = modificaEsercizioSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { serieExtra, ...campi } = risultato.data;

  const esistente = await prisma.esercizio.findFirst({ where: { id, archiviatoIl: null } });
  if (!esistente) {
    res.status(404).json({ errore: 'Esercizio non trovato' });
    return;
  }

  const min = campi.repsTarget !== undefined ? campi.repsTarget : esistente.repsTarget;
  const max = campi.repsMax !== undefined ? campi.repsMax : esistente.repsMax;

  const esercizio = await prisma.esercizio.update({
    where: { id },
    data: {
      ...campi,
      repsMax: massimoValido(min, max),
      ...(serieExtra ? { serieExtra: { deleteMany: {}, create: datiSerieExtra(serieExtra) } } : {}),
    },
    include: { serieExtra: { orderBy: { ordine: 'asc' } } },
  });
  res.json(esercizio);
});

// Storico completo di una scheda per il trainer: tutti gli esercizi (anche quelli tolti,
// se hanno serie registrate) con tutte le serie del cliente, dalla più vecchia.
// Serve per i grafici "per esercizio" e per il dettaglio "per allenamento" (raggruppando per giorno).
router.get('/schede/:id/storico', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const scheda = await prisma.scheda.findUnique({
    where: { id },
    select: { id: true, nome: true, clienteId: true, archiviataIl: true, creataIl: true, cliente: { select: { nome: true } } },
  });
  if (!scheda) {
    res.status(404).json({ errore: 'Scheda non trovata' });
    return;
  }
  const esercizi = await prisma.esercizio.findMany({
    where: {
      schedaId: id,
      // attivi sempre; quelli tolti solo se hanno serie (altrimenti non c'è niente da mostrare)
      OR: [{ archiviatoIl: null }, { registri: { some: {} } }],
    },
    orderBy: { id: 'asc' },
    include: {
      serieExtra: { orderBy: { ordine: 'asc' } },
      registri: {
        // solo le serie del proprietario della scheda
        where: { clienteId: scheda.clienteId },
        orderBy: { data: 'asc' },
        select: { id: true, pesoUsato: true, repsFatte: true, nota: true, data: true, esercizioId: true, clienteId: true },
      },
    },
  });
  res.json({ ...scheda, esercizi });
});

// Esercizi tolti da una scheda (archiviati): il trainer li vede nella modifica
// della scheda e può rimetterli, con tutto lo storico del cliente ancora collegato.
router.get('/schede/:id/esercizi-archiviati', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const esercizi = await prisma.esercizio.findMany({
    where: { schedaId: id, archiviatoIl: { not: null } },
    orderBy: { archiviatoIl: 'desc' },
    include: { serieExtra: { orderBy: { ordine: 'asc' } }, _count: { select: { registri: true } } },
  });
  res.json(esercizi);
});

router.post('/esercizi/:id/ripristina', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  // Solo se la scheda è attiva: in una scheda archiviata si ripristina prima la scheda.
  const { count } = await prisma.esercizio.updateMany({
    where: { id, archiviatoIl: { not: null }, scheda: { archiviataIl: null } },
    data: { archiviatoIl: null },
  });
  if (count === 0) {
    res.status(404).json({ errore: 'Esercizio non trovato, non archiviato, o scheda archiviata' });
    return;
  }
  res.status(204).send();
});

// "Elimina" un esercizio = archiviarlo: esce dalla scheda, lo storico resta.
router.delete('/esercizi/:id', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const { count } = await prisma.esercizio.updateMany({
    where: { id, archiviatoIl: null },
    data: { archiviatoIl: new Date() },
  });
  if (count === 0) {
    res.status(404).json({ errore: 'Esercizio non trovato' });
    return;
  }
  res.status(204).send();
});

export default router;
