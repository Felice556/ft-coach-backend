import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo, creaToken } from '../middleware/auth.js';
import { leggiId } from '../utils.js';

const router = Router();

// Stesse regole della registrazione per ogni nuova password.
const passwordSchema = z.string().min(8, 'La password deve avere almeno 8 caratteri').max(72);

const registerSchema = z.object({
  nome: z.string().trim().min(2, 'Il nome deve avere almeno 2 caratteri').max(60),
  email: z.string().trim().toLowerCase().email('Email non valida'),
  password: z.string().min(8, 'La password deve avere almeno 8 caratteri').max(72), // bcrypt usa solo i primi 72 byte
  ruolo: z.enum(['TRAINER', 'CLIENTE']).default('CLIENTE'),
  codiceTrainer: z.string().optional(),
});

router.post('/register', async (req, res) => {
  const risultato = registerSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { nome, email, password, ruolo, codiceTrainer } = risultato.data;

  // Chiunque può registrarsi come CLIENTE (vede solo i propri dati).
  // Un TRAINER invece vede i dati di tutti i clienti: si può creare solo con il
  // codice segreto CODICE_TRAINER del file .env. Senza codice configurato, nessuno può.
  if (ruolo === 'TRAINER') {
    const codice = process.env.CODICE_TRAINER;
    if (!codice || codiceTrainer !== codice) {
      res.status(403).json({ errore: 'Registrazione come trainer non consentita' });
      return;
    }
  }

  // Confronto senza distinguere maiuscole/minuscole: "Alessio@Test.com" = "alessio@test.com".
  const esistente = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (esistente) {
    res.status(400).json({ errore: 'Email già registrata' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const utente = await prisma.user.create({
    data: { nome, email, password: passwordHash, ruolo },
  });

  // Non restituiamo mai la password, nemmeno hashata.
  res.status(201).json({ id: utente.id, nome: utente.nome, ruolo: utente.ruolo });
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string(),
});

router.post('/login', async (req, res) => {
  const risultato = loginSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { email, password } = risultato.data;

  // Ricerca senza distinguere maiuscole/minuscole (funziona anche per account creati prima).
  const utente = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (!utente) {
    res.status(401).json({ errore: 'Credenziali non valide' });
    return;
  }

  const passwordCorretta = await bcrypt.compare(password, utente.password);
  if (!passwordCorretta) {
    res.status(401).json({ errore: 'Credenziali non valide' });
    return;
  }

  // passwordTemporanea = true → il frontend mostra subito "Scegli una nuova password".
  res.json({
    token: creaToken(utente),
    ruolo: utente.ruolo,
    nome: utente.nome,
    passwordTemporanea: utente.passwordTemporanea,
  });
});

// ---------- Cambio della propria password (trainer e clienti) ----------

const cambioPasswordSchema = z.object({
  passwordAttuale: z.string().min(1, 'Scrivi la password attuale'),
  nuovaPassword: passwordSchema,
});

router.put('/me/password', autentica, async (req, res) => {
  const risultato = cambioPasswordSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { passwordAttuale, nuovaPassword } = risultato.data;
  const utente = await prisma.user.findUnique({ where: { id: (req as any).userId as number } });
  if (!utente) {
    res.status(404).json({ errore: 'Utente non trovato' });
    return;
  }
  // Serve la password attuale: chi trova un telefono sbloccato non può cambiarla e chiudere fuori il proprietario.
  if (!(await bcrypt.compare(passwordAttuale, utente.password))) {
    res.status(400).json({ errore: 'La password attuale non è corretta' });
    return;
  }
  if (await bcrypt.compare(nuovaPassword, utente.password)) {
    res.status(400).json({ errore: 'La nuova password deve essere diversa da quella attuale' });
    return;
  }

  // versioneToken + 1: gli altri dispositivi collegati vengono disconnessi.
  const aggiornato = await prisma.user.update({
    where: { id: utente.id },
    data: {
      password: await bcrypt.hash(nuovaPassword, 10),
      passwordTemporanea: false,
      versioneToken: { increment: 1 },
    },
  });
  // Nuovo token per questo dispositivo, così chi ha appena cambiato la password resta dentro.
  res.json({ token: creaToken(aggiornato) });
});

// ---------- Il trainer gestisce l'accesso dei clienti ----------
// Il trainer NON vede mai le password (nel database c'è solo una versione cifrata
// che non si può leggere): può solo impostarne una nuova, temporanea.

// Trova un utente CLIENTE: un trainer non può toccare l'account di un altro trainer.
async function trovaCliente(id: number) {
  const utente = await prisma.user.findUnique({ where: { id } });
  return utente?.ruolo === 'CLIENTE' ? utente : null;
}

router.put('/clienti/:id/password', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const risultato = z.object({ nuovaPassword: passwordSchema }).safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  if (!(await trovaCliente(id))) {
    res.status(404).json({ errore: 'Cliente non trovato' });
    return;
  }
  await prisma.user.update({
    where: { id },
    data: {
      password: await bcrypt.hash(risultato.data.nuovaPassword, 10),
      passwordTemporanea: true, // al prossimo accesso il cliente ne sceglie una sua
      versioneToken: { increment: 1 }, // disconnette tutti i suoi dispositivi
    },
  });
  res.status(204).send();
});

router.put('/clienti/:id/email', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const risultato = z
    .object({ email: z.string().trim().toLowerCase().email('Email non valida').max(254) })
    .safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { email } = risultato.data;
  if (!(await trovaCliente(id))) {
    res.status(404).json({ errore: 'Cliente non trovato' });
    return;
  }
  const giaUsata = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, NOT: { id } },
  });
  if (giaUsata) {
    res.status(409).json({ errore: 'Questa email è già usata da un altro account' });
    return;
  }
  const aggiornato = await prisma.user.update({
    where: { id },
    data: { email },
    select: { id: true, nome: true, email: true },
  });
  res.json(aggiornato);
});

// Elenco dei clienti per il trainer: serve al menu a tendina quando assegna una scheda,
// così non deve scrivere l'ID a mano (e non rischia di assegnarla alla persona sbagliata).
router.get('/clienti', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const clienti = await prisma.user.findMany({
    where: { ruolo: 'CLIENTE' },
    select: { id: true, nome: true, email: true }, // mai la password
    orderBy: { nome: 'asc' },
  });
  res.json(clienti);
});

export default router;
