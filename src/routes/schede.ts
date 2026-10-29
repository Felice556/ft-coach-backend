import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';
import { clienteDelTrainer, eAutonomo, MASSIMO_SCHEDE_PERSONALI, schedeDelTrainer, schedeGestibili, schedePersonali } from '../proprieta.js';
import { leggiId, leggiIdFacoltativo, linkVideoSchema } from '../utils.js';

const router = Router();

// Una serie aggiunta dal trainer dopo le serie normali, con numeri propri.
// Ripetizioni: un numero, oppure null per "Max" (a cedimento).
// Per un intervallo ("6-9") si usa anche il massimo: reps = 6, repsMax = 9.
// Tetti ragionevoli su tutti i numeri e i testi: un errore di battitura (o una richiesta
// fatta apposta) non può riempire il database di valori assurdi.
const repsSchema = z.number().int().positive().max(1000).nullable();
const repsMaxBase = z.number().int().positive().max(1000).nullable();
const repsMaxSchema = repsMaxBase.default(null);

// "+ max" (drop set): fatte le ripetizioni previste, si scala il peso e si va a cedimento ("6-9 + max").
const piuMaxBase = z.boolean();
const piuMaxSchema = piuMaxBase.default(false);
// "+ rp" (rest-pause): pausa in secondi prima di riprendere con lo stesso peso ("6-9 + rp 15"). null = no.
const rpBase = z.number().int().min(5, 'Pausa del rest-pause tra 5 e 120 secondi').max(120, 'Pausa del rest-pause tra 5 e 120 secondi').nullable();
const rpSchema = rpBase.default(null);

const serieExtraSchema = z.object({
  reps: repsSchema,
  repsMax: repsMaxSchema,
  piuMax: piuMaxSchema,
  rpSecondi: rpSchema,
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
  piuMax: piuMaxSchema,
  rpSecondi: rpSchema,
  recuperoSecondi: z.number().int().min(0).max(3600), // 0 = nessun recupero
  serieExtra: z.array(serieExtraSchema).max(10).default([]),
  // Collegato all'esercizio successivo: SUPERSET (senza recupero in mezzo) o JUMPSET
  // (con recupero). null = esercizio singolo.
  collegamento: z.enum(['SUPERSET', 'JUMPSET']).nullable().default(null),
});

// Un collegamento "al successivo" sull'ultimo esercizio non ha senso: lo togliamo,
// così nel database non restano collegamenti che non portano a niente.
function senzaCollegamentoFinale<T extends { collegamento: 'SUPERSET' | 'JUMPSET' | null }>(esercizi: T[]): T[] {
  return esercizi.map((e, i) => (i === esercizi.length - 1 ? { ...e, collegamento: null } : e));
}

// Un massimo ha senso solo se c'è un minimo ed è più grande: altrimenti lo ignoriamo,
// così nel database non finiscono mai intervalli incoerenti tipo "Max-9" o "9-6".
function massimoValido(min: number | null, max: number | null): number | null {
  return min != null && max != null && max > min ? max : null;
}

// "+ max" solo dopo un numero di ripetizioni: "Max + max" non vuol dire niente, quindi lo togliamo.
// Con il rest-pause il "+ max" si toglie: la tecnica finale è una sola.
const piuMaxValido = (reps: number | null, piuMax: boolean | undefined, rpSecondi?: number | null) => reps != null && piuMax === true && rpSecondi == null;

// Ogni lettura di una scheda porta con sé gli esercizi ATTIVI (non archiviati)
// e le loro serie extra, sempre nello stesso ordine.
const conEsercizi = {
  esercizi: {
    where: { archiviatoIl: null },
    // Nell'ordine scelto dal trainer (trascinando gli esercizi); a parità, quello di inserimento.
    orderBy: [{ ordine: 'asc' as const }, { id: 'asc' as const }],
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
    piuMax: piuMaxValido(s.reps, s.piuMax, s.rpSecondi),
    rpSecondi: s.rpSecondi ?? null,
    recuperoSecondi: s.recuperoSecondi,
    nota: s.nota || null,
  }));
}

const schedaSchema = z.object({
  nome: z.string().trim().min(1, 'Il nome della scheda non può essere vuoto').max(100),
  clienteId: z.number().int().optional(), // il trainer lo indica sempre; chi si allena da solo no (è sé stesso)
  esercizi: z.array(esercizioSchema).min(1, 'Serve almeno un esercizio'),
});

// true solo se clienteId è un CLIENTE seguito da questo trainer.
async function eUnSuoCliente(trainerId: number, clienteId: number) {
  return (await clienteDelTrainer(trainerId, clienteId)) !== null;
}

const trainerDi = (req: any) => req.userId as number;

// Schede che chi fa la richiesta può gestire (vedi proprieta.ts). Se nessuna, risponde 403.
async function gestibiliORifiuta(req: any, res: any): Promise<Prisma.SchedaWhereInput | null> {
  const filtro = await schedeGestibili(req);
  if (!filtro) res.status(403).json({ errore: 'Le tue schede le prepara il tuo trainer' });
  return filtro;
}

// Crea una scheda:
// - il TRAINER la prepara per un suo cliente;
// - il CLIENTE che si allena da solo se la crea per sé (per ora senza limiti: l'app avvisa soltanto
//   che in futuro, dalla quarta in poi, servirà Liftio Pro).
router.post('/schede', autentica, async (req, res) => {
  const risultato = schedaSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { nome } = risultato.data;
  const esercizi = senzaCollegamentoFinale(risultato.data.esercizi);
  const userId = trainerDi(req);

  let autore: { clienteId: number; trainerId: number | null; personale: boolean };
  if ((req as any).ruolo === 'TRAINER') {
    // Verifica che il clienteId passato sia davvero un CLIENTE di questo trainer.
    const clienteId = risultato.data.clienteId;
    if (clienteId === undefined || !(await eUnSuoCliente(userId, clienteId))) {
      res.status(400).json({ errore: 'Cliente non valido: controlla l’ID del cliente' });
      return;
    }
    autore = { clienteId, trainerId: userId, personale: false };
  } else {
    if (!(await eAutonomo(userId))) {
      res.status(403).json({ errore: 'Le tue schede le prepara il tuo trainer' });
      return;
    }
    // Solo un tetto di sicurezza sulle schede attive (non è il limite "Pro", che per ora è solo un avviso).
    if ((await prisma.scheda.count({ where: { ...schedePersonali(userId), archiviataIl: null } })) >= MASSIMO_SCHEDE_PERSONALI) {
      res.status(400).json({ errore: 'Hai già 30 schede attive: archiviane qualcuna per crearne altre' });
      return;
    }
    autore = { clienteId: userId, trainerId: null, personale: true };
  }

  const scheda = await prisma.scheda.create({
    data: {
      nome,
      ...autore,
      // Creazione annidata su tre livelli: scheda → esercizi → serie extra, in un colpo solo.
      esercizi: {
        create: esercizi.map(({ serieExtra, ...es }, ordine) => ({
          ...es,
          ordine,
          repsMax: massimoValido(es.repsTarget, es.repsMax),
          piuMax: piuMaxValido(es.repsTarget, es.piuMax, es.rpSecondi),
          rpSecondi: es.rpSecondi ?? null,
          serieExtra: { create: datiSerieExtra(serieExtra) },
        })),
      },
    },
    include: conEsercizi,
  });

  res.status(201).json(scheda);
});

// Elenco schede ATTIVE. Il CLIENTE vede le proprie: quelle del suo trainer attuale oppure,
// se si allena da solo, quelle che si è creato (le altre restano salvate, "in pausa").
// Il TRAINER vede quelle che ha preparato per i SUOI clienti (o per uno solo con ?clienteId=3).
// Con ?archiviate=1 si vede l'archivio (trainer e chi si allena da solo).
router.get('/schede', autentica, async (req, res) => {
  const userId = (req as any).userId as number;
  const ruolo = (req as any).ruolo as string;
  const archiviate = req.query.archiviate === '1';

  if (ruolo === 'CLIENTE') {
    const io = await prisma.user.findUnique({ where: { id: userId }, select: { trainerId: true } });
    if (archiviate && io?.trainerId) {
      res.json([]); // l'archivio delle schede del trainer lo gestisce il trainer
      return;
    }
    const schede = await prisma.scheda.findMany({
      where: {
        clienteId: userId,
        ...(io?.trainerId ? { trainerId: io.trainerId, personale: false } : { personale: true }),
        archiviataIl: archiviate ? { not: null } : null,
      },
      orderBy: archiviate ? { archiviataIl: 'desc' } : { id: 'asc' },
      include: conEsercizi,
    });
    res.json(archiviate ? await Promise.all(schede.map(async (s) => ({ ...s, haStorico: await haStorico(s.id) }))) : schede);
    return;
  }

  const clienteIdQuery = leggiIdFacoltativo(req.query.clienteId, res);
  if (clienteIdQuery === null) return;

  const schede = await prisma.scheda.findMany({
    where: {
      ...schedeDelTrainer(userId),
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

// Modifica completa di una scheda: nome, cliente assegnato (solo il trainer) ed elenco esercizi.
router.put('/schede/:id', autentica, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const risultato = modificaSchedaSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { nome } = risultato.data;
  // Solo il trainer sposta una scheda a un altro cliente; chi si allena da solo non ha nessuno a cui darla.
  const clienteId = (req as any).ruolo === 'TRAINER' ? risultato.data.clienteId : undefined;
  const esercizi = risultato.data.esercizi && senzaCollegamentoFinale(risultato.data.esercizi);
  const gestibili = await gestibiliORifiuta(req, res);
  if (!gestibili) return;

  const esistente = await prisma.scheda.findFirst({
    where: { id, ...gestibili },
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

  if (clienteId !== undefined && !(await eUnSuoCliente(trainerDi(req), clienteId))) {
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

      for (const [ordine, { id: esercizioId, serieExtra, ...dati }] of esercizi.entries()) {
        // Campi opzionali svuotati → null, altrimenti Prisma lascerebbe il vecchio valore.
        // L'ordine è la posizione nell'elenco mandato: così si salva anche il riordino.
        const campi = {
          ...dati,
          ordine,
          repsMax: massimoValido(dati.repsTarget, dati.repsMax),
          piuMax: piuMaxValido(dati.repsTarget, dati.piuMax, dati.rpSecondi),
          rpSecondi: dati.rpSecondi ?? null,
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
router.post('/schede/:id/archivia', autentica, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const gestibili = await gestibiliORifiuta(req, res);
  if (!gestibili) return;
  const { count } = await prisma.scheda.updateMany({
    where: { id, archiviataIl: null, ...gestibili },
    data: { archiviataIl: new Date() },
  });
  if (count === 0) {
    res.status(404).json({ errore: 'Scheda non trovata o già archiviata' });
    return;
  }
  res.status(204).send();
});

router.post('/schede/:id/ripristina', autentica, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const gestibili = await gestibiliORifiuta(req, res);
  if (!gestibili) return;
  const { count } = await prisma.scheda.updateMany({
    where: { id, archiviataIl: { not: null }, ...gestibili },
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
router.delete('/schede/:id', autentica, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const gestibili = await gestibiliORifiuta(req, res);
  if (!gestibili) return;
  const scheda = await prisma.scheda.findFirst({ where: { id, ...gestibili } });
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

// Per la modifica singola tutto è facoltativo: quello che non mandi resta com'è.
// Attenzione: con zod 4 .partial() applicherebbe comunque i .default() (es. piuMax → false),
// quindi i campi con un default vanno ridichiarati qui senza default.
const modificaEsercizioSchema = esercizioSchema.partial().extend({
  repsMax: repsMaxBase.optional(),
  piuMax: piuMaxBase.optional(),
  rpSecondi: rpBase.optional(),
  serieExtra: z.array(serieExtraSchema).max(10).optional(),
  collegamento: z.enum(['SUPERSET', 'JUMPSET']).nullable().optional(),
});

// Modifica un singolo esercizio (es. solo il recupero, senza toccare il resto della scheda).
router.put('/esercizi/:id', autentica, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const gestibili = await gestibiliORifiuta(req, res);
  if (!gestibili) return;
  const risultato = modificaEsercizioSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { serieExtra, ...campi } = risultato.data;

  const esistente = await prisma.esercizio.findFirst({ where: { id, archiviatoIl: null, scheda: gestibili } });
  if (!esistente) {
    res.status(404).json({ errore: 'Esercizio non trovato' });
    return;
  }

  const min = campi.repsTarget !== undefined ? campi.repsTarget : esistente.repsTarget;
  const max = campi.repsMax !== undefined ? campi.repsMax : esistente.repsMax;
  const piuMax = campi.piuMax !== undefined ? campi.piuMax : esistente.piuMax;
  const rpSecondi = campi.rpSecondi !== undefined ? campi.rpSecondi : esistente.rpSecondi;

  const esercizio = await prisma.esercizio.update({
    where: { id },
    data: {
      ...campi,
      repsMax: massimoValido(min, max),
      piuMax: piuMaxValido(min, piuMax, rpSecondi),
      rpSecondi,
      ...(serieExtra ? { serieExtra: { deleteMany: {}, create: datiSerieExtra(serieExtra) } } : {}),
    },
    include: { serieExtra: { orderBy: { ordine: 'asc' } } },
  });
  res.json(esercizio);
});

// Storico completo di una scheda per il trainer: tutti gli esercizi (anche quelli tolti,
// se hanno serie registrate) con tutte le serie del cliente, dalla più vecchia.
// Serve per i grafici "per esercizio" e per il dettaglio "per allenamento" (raggruppando per giorno).
router.get('/schede/:id/storico', autentica, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const gestibili = await gestibiliORifiuta(req, res);
  if (!gestibili) return;
  const scheda = await prisma.scheda.findFirst({
    where: { id, ...gestibili },
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
    orderBy: [{ ordine: 'asc' }, { id: 'asc' }],
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
router.get('/schede/:id/esercizi-archiviati', autentica, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const gestibili = await gestibiliORifiuta(req, res);
  if (!gestibili) return;
  const esercizi = await prisma.esercizio.findMany({
    where: { schedaId: id, archiviatoIl: { not: null }, scheda: gestibili },
    orderBy: { archiviatoIl: 'desc' },
    include: { serieExtra: { orderBy: { ordine: 'asc' } }, _count: { select: { registri: true } } },
  });
  res.json(esercizi);
});

router.post('/esercizi/:id/ripristina', autentica, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const gestibili = await gestibiliORifiuta(req, res);
  if (!gestibili) return;
  // Solo se la scheda è attiva: in una scheda archiviata si ripristina prima la scheda.
  const esercizio = await prisma.esercizio.findFirst({
    where: { id, archiviatoIl: { not: null }, scheda: { archiviataIl: null, ...gestibili } },
    select: { schedaId: true },
  });
  if (!esercizio) {
    res.status(404).json({ errore: 'Esercizio non trovato, non archiviato, o scheda archiviata' });
    return;
  }
  // Torna in fondo alla scheda, come lo mostra il form del trainer.
  const ultimo = await prisma.esercizio.aggregate({
    where: { schedaId: esercizio.schedaId, archiviatoIl: null },
    _max: { ordine: true },
  });
  await prisma.esercizio.update({
    where: { id },
    data: { archiviatoIl: null, ordine: (ultimo._max.ordine ?? -1) + 1 },
  });
  res.status(204).send();
});

// "Elimina" un esercizio = archiviarlo: esce dalla scheda, lo storico resta.
router.delete('/esercizi/:id', autentica, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const gestibili = await gestibiliORifiuta(req, res);
  if (!gestibili) return;
  const { count } = await prisma.esercizio.updateMany({
    where: { id, archiviatoIl: null, scheda: gestibili },
    data: { archiviatoIl: new Date() },
  });
  if (count === 0) {
    res.status(404).json({ errore: 'Esercizio non trovato' });
    return;
  }
  res.status(204).send();
});

export default router;
