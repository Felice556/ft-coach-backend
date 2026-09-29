import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica } from '../middleware/auth.js';
import { leggiId, leggiIdFacoltativo } from '../utils.js';

const router = Router();

// Misure del corpo:
// - PESO (kg): lo scrive il CLIENTE, per sé.
// - MASSA_GRASSA (%): la scrive il TRAINER, per un cliente.
// Entrambi possono VEDERE tutte e due (il cliente solo le proprie).
// Una misura per tipo al giorno: se si reinserisce lo stesso giorno, il valore viene corretto.

type Tipo = 'PESO' | 'MASSA_GRASSA';
const CHI_PUO_SCRIVERE: Record<Tipo, 'CLIENTE' | 'TRAINER'> = { PESO: 'CLIENTE', MASSA_GRASSA: 'TRAINER' };

// Limiti realistici per scartare errori di battitura (es. 725 invece di 72,5).
const LIMITI: Record<Tipo, { min: number; max: number; nome: string }> = {
  PESO: { min: 20, max: 350, nome: 'Il peso deve essere tra 20 e 350 kg' },
  MASSA_GRASSA: { min: 2, max: 70, nome: 'La massa grassa deve essere tra 2 e 70 %' },
};

// "2026-09-29" → Date del giorno. Niente date future né troppo vecchie.
const giornoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
    // +1 giorno di margine per i fusi orari (in Italia è già domani quando a Londra è ancora oggi)
    return d.getTime() <= Date.now() + 24 * 60 * 60 * 1000 && d.getUTCFullYear() >= 2000;
  }, 'Data non valida o nel futuro');

const misuraSchema = z.object({
  tipo: z.enum(['PESO', 'MASSA_GRASSA']),
  valore: z.number().finite(),
  data: giornoSchema,
  clienteId: z.number().int().positive().max(2147483647).optional(),
});

const campi = { id: true, tipo: true, valore: true, data: true, clienteId: true } as const;

// A chi si riferisce la richiesta: il cliente vede/scrive solo sé stesso;
// il trainer deve indicare un cliente esistente.
async function clienteDellaRichiesta(req: any, res: any, clienteIdRichiesto: number | null | undefined) {
  const utenteId = req.userId as number;
  if (req.ruolo === 'CLIENTE') return utenteId;
  if (!clienteIdRichiesto) {
    res.status(400).json({ errore: 'Indica il cliente' });
    return null;
  }
  const cliente = await prisma.user.findUnique({ where: { id: clienteIdRichiesto }, select: { ruolo: true } });
  if (!cliente || cliente.ruolo !== 'CLIENTE') {
    res.status(404).json({ errore: 'Cliente non trovato' });
    return null;
  }
  return clienteIdRichiesto;
}

// Elenco misure (dal giorno più vecchio al più recente, comodo per i grafici).
// Cliente: GET /misure   ·   Trainer: GET /misure?clienteId=5
router.get('/misure', autentica, async (req, res) => {
  const richiesto = leggiIdFacoltativo(req.query.clienteId, res);
  if (richiesto === null) return; // id non valido: risposta 400 già inviata
  const clienteId = await clienteDellaRichiesta(req, res, richiesto);
  if (clienteId === null) return;
  const misure = await prisma.misuraCorporea.findMany({
    where: { clienteId },
    orderBy: [{ data: 'asc' }, { id: 'asc' }],
    select: campi,
  });
  res.json(misure);
});

// Salva (o corregge, se c'è già quel giorno) una misura.
router.put('/misure', autentica, async (req, res) => {
  const risultato = misuraSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { tipo, data } = risultato.data;
  const valore = Math.round(risultato.data.valore * 10) / 10; // un decimale basta
  const ruolo = (req as any).ruolo as 'CLIENTE' | 'TRAINER';

  if (CHI_PUO_SCRIVERE[tipo] !== ruolo) {
    res.status(403).json({
      errore: tipo === 'PESO' ? 'Il peso corporeo lo inserisce il cliente' : 'La massa grassa la inserisce il trainer',
    });
    return;
  }
  const limiti = LIMITI[tipo];
  if (valore < limiti.min || valore > limiti.max) {
    res.status(400).json({ errore: limiti.nome });
    return;
  }
  const clienteId = await clienteDellaRichiesta(req, res, risultato.data.clienteId);
  if (clienteId === null) return;

  const giorno = new Date(`${data}T00:00:00Z`);
  const misura = await prisma.misuraCorporea.upsert({
    where: { clienteId_tipo_data: { clienteId, tipo, data: giorno } },
    create: { tipo, valore, data: giorno, clienteId, inseritaDaId: (req as any).userId },
    update: { valore, inseritaDaId: (req as any).userId },
    select: campi,
  });
  res.json(misura);
});

// Cancella una misura sbagliata: solo chi può scrivere quel tipo, e il cliente solo le proprie.
router.delete('/misure/:id', autentica, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const ruolo = (req as any).ruolo as 'CLIENTE' | 'TRAINER';
  const utenteId = (req as any).userId as number;

  const misura = await prisma.misuraCorporea.findUnique({ where: { id } });
  const puo =
    misura && CHI_PUO_SCRIVERE[misura.tipo] === ruolo && (ruolo === 'TRAINER' || misura.clienteId === utenteId);
  if (!misura || !puo) {
    res.status(404).json({ errore: 'Misura non trovata' });
    return;
  }
  await prisma.misuraCorporea.delete({ where: { id } });
  res.status(204).send();
});

export default router;
