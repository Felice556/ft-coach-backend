import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo } from '../middleware/auth.js';
import { leggiId } from '../utils.js';

const router = Router();

// Caratteri dei codici: niente lettere/cifre che si confondono (0/O, 1/I/L).
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Codice casuale "K7M3-Q9TX": 8 caratteri su 31 possibili = oltre 800 miliardi di combinazioni.
// randomInt di node:crypto è casuale "vero" (non prevedibile come Math.random).
function nuovoCodice(): string {
  let c = '';
  for (let i = 0; i < 8; i++) c += ALFABETO[randomInt(ALFABETO.length)];
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

// Da quello che scrive il cliente al formato salvato: "k7m3 q9tx" → "K7M3-Q9TX".
export function normalizzaCodice(testo: string): string {
  const pulito = testo.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return pulito.length === 8 ? `${pulito.slice(0, 4)}-${pulito.slice(4)}` : pulito;
}

// Stato leggibile di un invito, calcolato dalle date.
function stato(i: { usatoIl: Date | null; annullatoIl: Date | null; scadeIl: Date }) {
  if (i.usatoIl) return 'usato';
  if (i.annullatoIl) return 'annullato';
  if (i.scadeIl.getTime() <= Date.now()) return 'scaduto';
  return 'attivo';
}

const creaSchema = z.object({
  nota: z.string().trim().max(80).optional(),
  giorni: z.number().int().min(1).max(60).default(14),
});

// Il trainer crea un invito (facoltativo: per chi è, e quanti giorni vale).
router.post('/inviti', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const risultato = creaSchema.safeParse(req.body ?? {});
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { nota, giorni } = risultato.data;
  const scadeIl = new Date(Date.now() + giorni * 24 * 60 * 60 * 1000);

  // Un codice uguale a uno esistente è quasi impossibile, ma se capita ne generiamo un altro.
  for (let tentativo = 0; tentativo < 5; tentativo++) {
    const codice = nuovoCodice();
    if (await prisma.invito.findUnique({ where: { codice } })) continue;
    const invito = await prisma.invito.create({
      data: { codice, nota: nota || null, scadeIl, trainerId: (req as any).userId as number },
    });
    res.status(201).json({ ...invito, stato: stato(invito), usatoDa: null });
    return;
  }
  res.status(500).json({ errore: 'Non è stato possibile creare il codice, riprova' });
});

// Elenco inviti, dal più recente, con lo stato e chi l'ha usato.
router.get('/inviti', autentica, richiedeRuolo('TRAINER'), async (_req, res) => {
  const inviti = await prisma.invito.findMany({
    orderBy: { creatoIl: 'desc' },
    take: 100,
    include: { usatoDa: { select: { nome: true, email: true } } },
  });
  res.json(inviti.map((i) => ({ ...i, stato: stato(i) })));
});

// Annulla un invito non ancora usato (es. dato alla persona sbagliata). Non si cancella: resta nello storico.
router.post('/inviti/:id/annulla', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const { count } = await prisma.invito.updateMany({
    where: { id, usatoIl: null, annullatoIl: null },
    data: { annullatoIl: new Date() },
  });
  if (count === 0) {
    res.status(404).json({ errore: 'Invito non trovato, già usato o già annullato' });
    return;
  }
  res.status(204).send();
});

export default router;
