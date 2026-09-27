import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../prisma.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET!;

const registerSchema = z.object({
  nome: z.string().min(2, 'Il nome deve avere almeno 2 caratteri'),
  email: z.string().email('Email non valida'),
  password: z.string().min(8, 'La password deve avere almeno 8 caratteri'),
  ruolo: z.enum(['TRAINER', 'CLIENTE']),
});

router.post('/register', async (req, res) => {
  const risultato = registerSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { nome, email, password, ruolo } = risultato.data;

  const esistente = await prisma.user.findUnique({ where: { email } });
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
  email: z.string().email(),
  password: z.string(),
});

router.post('/login', async (req, res) => {
  const risultato = loginSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { email, password } = risultato.data;

  const utente = await prisma.user.findUnique({ where: { email } });
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
    { expiresIn: '7d' }
  );

  res.json({ token, ruolo: utente.ruolo, nome: utente.nome });
});

export default router;
