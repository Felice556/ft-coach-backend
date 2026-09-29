import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo } from '../middleware/auth.js';
import { leggiId } from '../utils.js';

const router = Router();

// Peso 0 ammesso: esercizi a corpo libero (trazioni, piegamenti…).
// Limiti alti ma realistici, per scartare errori di battitura evidenti (es. 6000 kg).
const pesoSchema = z.number().min(0, 'Il peso non può essere negativo').max(1000);
const repsSchema = z.number().int().positive().max(1000);
const notaSchema = z.string().max(500).optional();

const registroSchema = z.object({
  esercizioId: z.number().int().positive().max(2147483647),
  pesoUsato: pesoSchema,
  repsFatte: repsSchema,
  nota: notaSchema,
});

// Solo il CLIENTE registra i propri allenamenti — non ha senso che lo faccia il trainer.
router.post('/registro', autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const risultato = registroSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { esercizioId, pesoUsato, repsFatte, nota } = risultato.data;
  const clienteId = (req as any).userId as number;

  // Isolamento dati: l'esercizio deve appartenere a una scheda DI QUESTO cliente,
  // altrimenti un cliente potrebbe registrare pesi su esercizi di qualcun altro.
  const esercizio = await prisma.esercizio.findUnique({
    where: { id: esercizioId },
    include: { scheda: true },
  });
  if (!esercizio || esercizio.scheda.clienteId !== clienteId) {
    res.status(404).json({ errore: 'Esercizio non trovato' });
    return;
  }
  // Niente nuove serie su esercizi o schede archiviati: non sono più nel programma del cliente.
  if (esercizio.archiviatoIl || esercizio.scheda.archiviataIl) {
    res.status(400).json({ errore: 'Questo esercizio non fa più parte della tua scheda' });
    return;
  }

  const registro = await prisma.registroAllenamento.create({
    data: { esercizioId, pesoUsato, repsFatte, nota, clienteId },
  });

  res.status(201).json(registro);
});

// Storico di un esercizio specifico, ordinato dal più vecchio al più recente
// (comodo per disegnare poi un grafico di progressione).
router.get('/registro/:esercizioId', autentica, async (req, res) => {
  const esercizioId = leggiId(req.params.esercizioId, res);
  if (esercizioId === null) return;
  const clienteId = (req as any).userId as number;
  const ruolo = (req as any).ruolo as string;

  const esercizio = await prisma.esercizio.findUnique({
    where: { id: esercizioId },
    include: { scheda: true },
  });
  if (!esercizio) {
    res.status(404).json({ errore: 'Esercizio non trovato' });
    return;
  }

  // Un cliente può vedere solo il proprio storico; il trainer può vedere quello di ogni cliente.
  if (ruolo === 'CLIENTE' && esercizio.scheda.clienteId !== clienteId) {
    res.status(403).json({ errore: 'Non puoi vedere lo storico di un altro cliente' });
    return;
  }

  const storico = await prisma.registroAllenamento.findMany({
    // Doppia sicurezza: al cliente restituiamo SOLO le serie registrate da lui,
    // anche se in futuro una scheda cambiasse proprietario.
    where: ruolo === 'CLIENTE' ? { esercizioId, clienteId } : { esercizioId },
    orderBy: { data: 'asc' },
  });
  res.json(storico);
});

// ---- Correzione di una serie già registrata (es. 60 kg scritto al posto di 65) ----
// Il percorso è /registro/serie/:id (id della SERIE), diverso da /registro/:esercizioId
// usato sopra, così i due id non si confondono.

const correzioneSchema = z.object({
  pesoUsato: pesoSchema,
  repsFatte: repsSchema,
  nota: notaSchema,
});

router.put('/registro/serie/:id', autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const clienteId = (req as any).userId as number;
  const risultato = correzioneSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }

  // updateMany con { id, clienteId }: aggiorna SOLO se la serie è di questo cliente.
  // Se l'id è di qualcun altro, count sarà 0 e rispondiamo 404.
  const { count } = await prisma.registroAllenamento.updateMany({
    where: { id, clienteId },
    data: { ...risultato.data, nota: risultato.data.nota || null },
  });
  if (count === 0) {
    res.status(404).json({ errore: 'Serie non trovata' });
    return;
  }
  res.json(await prisma.registroAllenamento.findUnique({ where: { id } }));
});

router.delete('/registro/serie/:id', autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const clienteId = (req as any).userId as number;

  const { count } = await prisma.registroAllenamento.deleteMany({ where: { id, clienteId } });
  if (count === 0) {
    res.status(404).json({ errore: 'Serie non trovata' });
    return;
  }
  res.status(204).send();
});

export default router;
