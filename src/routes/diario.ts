import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica } from '../middleware/auth.js';
import { clienteDelTrainer, piuRecente, visibileDal } from '../proprieta.js';
import { leggiIdFacoltativo } from '../utils.js';

const router = Router();

// Diario alimentare.
// - Il CLIENTE scrive i pasti di ogni giorno (a parole), olio, acqua e come si è sentito.
//   Serve il suo consenso apposito: sono abitudini che possono dire qualcosa sulla salute.
// - Il TRAINER legge il diario dei SUOI clienti (solo se hanno dato il consenso) e può lasciare
//   un commento a ogni giornata. Non è un piano alimentare: niente calorie, niente diete.
//   Il trainer vede solo le giornate da quando il cliente è collegato a lui.
// - Chi si allena da solo lo usa come diario personale (nessuno lo legge).
// - Ritirando il consenso, il diario del cliente viene cancellato.

const GIORNI_STORICO = 60;
const MAX_VOCI_EXTRA = 6; // voci in più al giorno ("Post cena", "Pre allenamento"…)
const TIPI_PASTO = ['COLAZIONE', 'SPUNTINO_MATTINA', 'PRANZO', 'SPUNTINO_POMERIGGIO', 'CENA'] as const;

const giornoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
    return d.getTime() <= Date.now() + 24 * 60 * 60 * 1000 && d.getUTCFullYear() >= 2000;
  }, 'Data non valida o nel futuro');

const pastoSchema = z.object({
  testo: z.string().trim().max(500, 'Ogni pasto può avere al massimo 500 caratteri'),
  ora: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Ora non valida')
    .nullable()
    .optional(),
});

const voceExtraSchema = pastoSchema.extend({
  nome: z.string().trim().min(1, 'Dai un nome alla voce').max(40, 'Il nome della voce può avere al massimo 40 caratteri'),
});

const giornataSchema = z.object({
  // Voci in più scelte dal cliente, nell'ordine in cui le vuole vedere (quelle con testo vuoto vengono tolte).
  extra: z.array(voceExtraSchema).max(MAX_VOCI_EXTRA, 'Al massimo 6 voci in più al giorno').optional(),
  // Pasti della giornata: quelli assenti o con testo vuoto vengono tolti.
  pasti: z.object(Object.fromEntries(TIPI_PASTO.map((t) => [t, pastoSchema.nullable().optional()])) as Record<(typeof TIPI_PASTO)[number], z.ZodOptional<z.ZodNullable<typeof pastoSchema>>>),
  olioCucchiai: z.number().min(0, 'Olio tra 0 e 20 cucchiai').max(20, 'Olio tra 0 e 20 cucchiai').nullable().optional(),
  acquaLitri: z.number().min(0, 'Acqua tra 0 e 10 litri').max(10, 'Acqua tra 0 e 10 litri').nullable().optional(),
  sensazioni: z.string().trim().max(300, 'Le note possono avere al massimo 300 caratteri').optional(),
});

const commentoSchema = z.object({
  clienteId: z.number().int().positive().max(2147483647),
  // null o testo vuoto = commento tolto
  commento: z.string().trim().max(1000, 'Il commento può avere al massimo 1000 caratteri').nullable(),
});

const consensoSchema = z.object({ consenso: z.boolean() });

const campiGiorno = {
  id: true,
  data: true,
  olioCucchiai: true,
  acquaLitri: true,
  sensazioni: true,
  commentoTrainer: true,
  commentatoIl: true,
  pasti: { select: { tipo: true, nome: true, testo: true, ora: true }, orderBy: { id: 'asc' } }, // fissi prima, poi le voci in più nel loro ordine
} as const;

const giornoDaTesto = (s: string) => new Date(`${s}T00:00:00Z`);
const mezzoQuarto = (n: number | null | undefined, passo: number) => (n == null ? null : Math.round(n / passo) * passo);

// Di chi è il diario richiesto. Cliente: il suo. Trainer: uno dei suoi clienti.
async function clienteDelDiario(req: any, res: any, richiesto: number | null | undefined): Promise<number | null> {
  if (req.ruolo === 'CLIENTE') return req.userId as number;
  if (!richiesto) {
    res.status(400).json({ errore: 'Indica il cliente' });
    return null;
  }
  if (!(await clienteDelTrainer(req.userId, richiesto))) {
    res.status(404).json({ errore: 'Cliente non trovato' });
    return null;
  }
  return richiesto;
}

// Diario degli ultimi 60 giorni. Cliente: GET /diario  ·  Trainer: GET /diario?clienteId=5
router.get('/diario', autentica, async (req, res) => {
  const richiesto = leggiIdFacoltativo(req.query.clienteId, res);
  if (richiesto === null) return;
  const clienteId = await clienteDelDiario(req, res, richiesto);
  if (clienteId === null) return;

  const cliente = await prisma.user.findUnique({ where: { id: clienteId }, select: { consensoDiarioIl: true } });
  const consenso = cliente?.consensoDiarioIl != null;
  // Senza consenso non si mostra niente (e comunque il diario non può esistere).
  const da = new Date();
  da.setUTCHours(0, 0, 0, 0);
  da.setUTCDate(da.getUTCDate() - GIORNI_STORICO);
  const dal = (req as any).ruolo === 'TRAINER' ? await visibileDal(clienteId) : null;
  const giorni = consenso
    ? await prisma.giornoDiario.findMany({ where: { clienteId, data: { gte: piuRecente(da, dal) } }, orderBy: { data: 'desc' }, select: campiGiorno })
    : [];
  res.json({ consenso, giorni });
});

// Il cliente dà o ritira il consenso. Ritirandolo, il suo diario viene cancellato.
router.put('/diario/consenso', autentica, async (req, res) => {
  if ((req as any).ruolo !== 'CLIENTE') {
    res.status(403).json({ errore: 'Il consenso al diario lo dà il cliente' });
    return;
  }
  const risultato = consensoSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const clienteId = (req as any).userId as number;
  if (risultato.data.consenso) {
    await prisma.user.update({ where: { id: clienteId }, data: { consensoDiarioIl: new Date() } });
  } else {
    await prisma.$transaction([
      prisma.giornoDiario.deleteMany({ where: { clienteId } }), // i pasti si cancellano con le loro giornate
      prisma.user.update({ where: { id: clienteId }, data: { consensoDiarioIl: null } }),
    ]);
  }
  res.json({ consenso: risultato.data.consenso });
});

// Il cliente salva una giornata (tutta insieme). Una giornata vuota viene tolta,
// a meno che il trainer non l'abbia già commentata.
router.put('/diario/:data', autentica, async (req, res) => {
  if ((req as any).ruolo !== 'CLIENTE') {
    res.status(403).json({ errore: 'Il diario lo scrive il cliente' });
    return;
  }
  const data = giornoSchema.safeParse(req.params.data);
  const risultato = giornataSchema.safeParse(req.body);
  if (!data.success || !risultato.success) {
    res.status(400).json({ errori: [...(data.error?.issues ?? []), ...(risultato.error?.issues ?? [])] });
    return;
  }
  const clienteId = (req as any).userId as number;
  const cliente = await prisma.user.findUnique({ where: { id: clienteId }, select: { consensoDiarioIl: true } });
  if (!cliente?.consensoDiarioIl) {
    res.status(403).json({ errore: 'Per usare il diario serve il tuo consenso' });
    return;
  }

  const { pasti, sensazioni } = risultato.data;
  const olioCucchiai = mezzoQuarto(risultato.data.olioCucchiai, 0.5);
  const acquaLitri = mezzoQuarto(risultato.data.acquaLitri, 0.25);
  const pastiPieni: { tipo: (typeof TIPI_PASTO)[number] | 'EXTRA'; nome: string | null; ordine: number; testo: string; ora: string | null }[] = [
    ...TIPI_PASTO.flatMap((tipo) => {
      const p = pasti[tipo];
      return p && p.testo ? [{ tipo, nome: null, ordine: 0, testo: p.testo, ora: p.ora ?? null }] : [];
    }),
    ...(risultato.data.extra ?? [])
      .filter((x) => x.testo)
      .map((x, i) => ({ tipo: 'EXTRA' as const, nome: x.nome, ordine: i, testo: x.testo, ora: x.ora ?? null })),
  ];
  const vuota = pastiPieni.length === 0 && !olioCucchiai && !acquaLitri && !sensazioni;
  const giorno = giornoDaTesto(data.data);
  const chiave = { clienteId_data: { clienteId, data: giorno } };

  const esistente = await prisma.giornoDiario.findUnique({ where: chiave, select: { id: true, commentoTrainer: true } });
  if (vuota && (!esistente || !esistente.commentoTrainer)) {
    if (esistente) await prisma.giornoDiario.delete({ where: { id: esistente.id } });
    res.json(null);
    return;
  }

  const salvata = await prisma.$transaction(async (tx) => {
    const g = await tx.giornoDiario.upsert({
      where: chiave,
      create: { clienteId, data: giorno, olioCucchiai, acquaLitri, sensazioni: sensazioni || null },
      update: { olioCucchiai, acquaLitri, sensazioni: sensazioni || null },
      select: { id: true },
    });
    await tx.pastoDiario.deleteMany({ where: { giornoId: g.id } });
    if (pastiPieni.length) await tx.pastoDiario.createMany({ data: pastiPieni.map((p) => ({ ...p, giornoId: g.id })) });
    return tx.giornoDiario.findUnique({ where: { id: g.id }, select: campiGiorno });
  });
  res.json(salvata);
});

// Il trainer commenta una giornata del diario di un suo cliente (o toglie il commento).
router.put('/diario/:data/commento', autentica, async (req, res) => {
  if ((req as any).ruolo !== 'TRAINER') {
    res.status(403).json({ errore: 'Il commento lo scrive il trainer' });
    return;
  }
  const data = giornoSchema.safeParse(req.params.data);
  const risultato = commentoSchema.safeParse(req.body);
  if (!data.success || !risultato.success) {
    res.status(400).json({ errori: [...(data.error?.issues ?? []), ...(risultato.error?.issues ?? [])] });
    return;
  }
  const clienteId = await clienteDelDiario(req, res, risultato.data.clienteId);
  if (clienteId === null) return;
  const cliente = await prisma.user.findUnique({ where: { id: clienteId }, select: { consensoDiarioIl: true } });
  const dal = await visibileDal(clienteId);
  const giorno = cliente?.consensoDiarioIl && !(dal && giornoDaTesto(data.data) < dal)
    ? await prisma.giornoDiario.findUnique({ where: { clienteId_data: { clienteId, data: giornoDaTesto(data.data) } }, select: { id: true } })
    : null;
  if (!giorno) {
    res.status(404).json({ errore: 'Il cliente non ha compilato il diario di quel giorno' });
    return;
  }
  const commento = risultato.data.commento || null;
  const salvata = await prisma.giornoDiario.update({
    where: { id: giorno.id },
    data: { commentoTrainer: commento, commentatoIl: commento ? new Date() : null },
    select: campiGiorno,
  });
  res.json(salvata);
});

export default router;
