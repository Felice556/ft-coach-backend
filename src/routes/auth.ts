import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET!;

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

  // Il ruolo va DENTRO il token: è quello che richiedeRuolo() legge
  // ad ogni richiesta successiva, senza dover interrogare di nuovo il database.
  const token = jwt.sign(
    { userId: utente.id, ruolo: utente.ruolo },
    JWT_SECRET,
    // 30 giorni: il cliente non deve rifare il login ogni settimana in palestra.
    { expiresIn: '30d' }
  );

  res.json({ token, ruolo: utente.ruolo, nome: utente.nome });
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
