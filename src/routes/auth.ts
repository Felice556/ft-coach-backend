import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo, creaToken } from '../middleware/auth.js';
import { leggiId } from '../utils.js';
import { limiteCambioPassword, limiteLoginPerEmail, limiteLoginPerIp, limiteRegistrazione } from '../limiti.js';
import { normalizzaCodice } from './inviti.js';
import { clienteDelTrainer } from '../proprieta.js';

const router = Router();

// Stesse regole della registrazione per ogni nuova password.
const passwordSchema = z.string().min(8, 'La password deve avere almeno 8 caratteri').max(72);

const registerSchema = z.object({
  nome: z.string().trim().min(2, 'Il nome deve avere almeno 2 caratteri').max(60),
  email: z.string().trim().toLowerCase().email('Email non valida'),
  password: z.string().min(8, 'La password deve avere almeno 8 caratteri').max(72), // bcrypt usa solo i primi 72 byte
  ruolo: z.enum(['TRAINER', 'CLIENTE']).default('CLIENTE'),
  codiceInvito: z.string().max(20).optional(),
  // Solo per i trainer senza invito: due righe per presentarsi all'amministratore.
  presentazione: z.string().trim().max(500, 'La presentazione può avere al massimo 500 caratteri').optional(),
});

// Con INVITI_OBBLIGATORI=1 (variabile su Render) un cliente può registrarsi solo con un invito.
const invitiObbligatori = () => process.env.INVITI_OBBLIGATORI === '1';

// Serve alla schermata di registrazione: sapere se il campo "Codice invito" è obbligatorio.
router.get('/registrazione/info', (_req, res) => {
  res.json({ invitoObbligatorio: invitiObbligatori() });
});

router.post('/register', limiteRegistrazione, async (req, res) => {
  const risultato = registerSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { nome, email, password, ruolo } = risultato.data;
  const codiceInvito = risultato.data.codiceInvito?.trim() ? normalizzaCodice(risultato.data.codiceInvito) : undefined;

  // Un TRAINER con un invito trainer (lo crea solo l'amministratore) è subito attivo.
  // Un TRAINER SENZA invito può registrarsi, ma resta "in attesa" finché l'amministratore non lo
  // approva: per questo deve presentarsi in due righe. Fino ad allora non può fare niente.
  // Un CLIENTE si registra con l'invito del suo trainer (con INVITI_OBBLIGATORI=1 è obbligatorio).
  const inAttesa = ruolo === 'TRAINER' && !codiceInvito;
  const presentazione = risultato.data.presentazione || null;
  if (inAttesa && (!presentazione || presentazione.length < 10)) {
    res.status(400).json({ errore: 'Presentati in poche righe (almeno 10 caratteri): palestra, città, quanti clienti segui' });
    return;
  }

  // Confronto senza distinguere maiuscole/minuscole: "Alessio@Test.com" = "alessio@test.com".
  const esistente = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (esistente) {
    res.status(400).json({ errore: 'Email già registrata' });
    return;
  }

  if (ruolo === 'CLIENTE' && invitiObbligatori() && !codiceInvito) {
    res.status(400).json({ errore: 'Serve il codice invito che ti ha dato il tuo trainer' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const erroreInvito = 'Codice invito non valido, scaduto o già usato';

  // Account e invito insieme, in una "transazione": o succedono entrambi o nessuno.
  // L'invito si consuma con un updateMany condizionato: se due persone usano lo stesso
  // codice nello stesso istante, solo una ci riesce.
  let utente;
  try {
    utente = await prisma.$transaction(async (tx) => {
      // A quale trainer appartiene il nuovo cliente:
      // - con un invito: al trainer che l'ha creato;
      // - senza invito (solo se gli inviti non sono obbligatori): all'amministratore.
      // Un nuovo trainer non appartiene a nessuno. "admin" non si imposta MAI qui.
      let trainerId: number | null = null;
      if (codiceInvito) {
        const invito = await tx.invito.findUnique({ where: { codice: codiceInvito } });
        // L'invito deve essere del tipo giusto: un invito cliente non crea un trainer, e viceversa.
        if (!invito || invito.ruolo !== ruolo) throw new Error('INVITO_NON_VALIDO');
        if (ruolo === 'CLIENTE') trainerId = invito.trainerId;
      } else if (ruolo === 'CLIENTE') {
        const amministratore = await tx.user.findFirst({ where: { admin: true }, select: { id: true } });
        trainerId = amministratore?.id ?? null;
      }

      const nuovo = await tx.user.create({
        data: {
          nome,
          email,
          password: passwordHash,
          ruolo,
          trainerId,
          ...(inAttesa ? { approvato: false, presentazione, richiestaIl: new Date() } : {}),
        },
      });
      if (codiceInvito) {
        const { count } = await tx.invito.updateMany({
          where: { codice: codiceInvito, ruolo, usatoIl: null, annullatoIl: null, scadeIl: { gt: new Date() } },
          data: { usatoIl: new Date(), usatoDaId: nuovo.id },
        });
        if (count !== 1) throw new Error('INVITO_NON_VALIDO');
      }
      return nuovo;
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVITO_NON_VALIDO') {
      res.status(400).json({ errore: erroreInvito });
      return;
    }
    throw err;
  }

  // Non restituiamo mai la password, nemmeno hashata.
  res.status(201).json({ id: utente.id, nome: utente.nome, ruolo: utente.ruolo, inAttesa });
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().max(200),
});

// Hash "finto": se l'email non esiste confrontiamo comunque la password con questo,
// così la risposta impiega lo stesso tempo e non si capisce quali email sono registrate.
const HASH_FINTO = bcrypt.hashSync('password-che-non-esiste', 10);

router.post('/login', limiteLoginPerIp, limiteLoginPerEmail, async (req, res) => {
  const risultato = loginSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { email, password } = risultato.data;

  // Ricerca senza distinguere maiuscole/minuscole (funziona anche per account creati prima).
  const utente = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (!utente) {
    await bcrypt.compare(password, HASH_FINTO);
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
    // Trainer registrato da solo, non ancora approvato: il frontend mostra la schermata d'attesa.
    inAttesa: utente.ruolo === 'TRAINER' && !utente.approvato,
  });
});

// ---------- Cambio della propria password (trainer e clienti) ----------

const cambioPasswordSchema = z.object({
  passwordAttuale: z.string().min(1, 'Scrivi la password attuale').max(200),
  nuovaPassword: passwordSchema,
});

router.put('/me/password', limiteCambioPassword, autentica, async (req, res) => {
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

// Trova un CLIENTE di questo trainer: non si toccano gli account di altri trainer
// né i clienti seguiti da un altro trainer.
function trovaCliente(req: any, id: number) {
  return clienteDelTrainer(req.userId as number, id);
}

router.put('/clienti/:id/password', autentica, richiedeRuolo('TRAINER'), async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const risultato = z.object({ nuovaPassword: passwordSchema }).safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  if (!(await trovaCliente(req, id))) {
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
  if (!(await trovaCliente(req, id))) {
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
    where: { ruolo: 'CLIENTE', trainerId: (req as any).userId as number },
    select: { id: true, nome: true, email: true }, // mai la password
    orderBy: { nome: 'asc' },
  });
  res.json(clienti);
});

// Chi sono: serve al frontend per sapere, ad esempio, se mostrare la sezione amministratore.
router.get('/me', autentica, async (req, res) => {
  const utente = await prisma.user.findUnique({
    where: { id: (req as any).userId as number },
    select: { id: true, nome: true, ruolo: true, admin: true, approvato: true }, // mai la password
  });
  if (!utente) {
    res.status(404).json({ errore: 'Utente non trovato' });
    return;
  }
  const { approvato, ...resto } = utente;
  res.json({ ...resto, inAttesa: utente.ruolo === 'TRAINER' && !approvato });
});

// ---------- Eliminare il proprio account ----------
// Chiesto da Google Play (e dal GDPR): ognuno può cancellare il proprio account dall'app.
// È definitivo, quindi servono la password e la parola "ELIMINA" scritta a mano.
// Regole di sicurezza:
// - l'amministratore NON si può eliminare dall'app (senza di lui nessuno può invitare trainer);
// - un trainer con clienti ancora collegati non può eliminarsi: i clienti resterebbero senza trainer.
const eliminaAccountSchema = z.object({
  password: z.string().min(1, 'Scrivi la tua password').max(72),
  conferma: z.string().max(20),
});

router.delete('/me', limiteCambioPassword, autentica, async (req, res) => {
  const risultato = eliminaAccountSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { password, conferma } = risultato.data;
  if (conferma.trim().toUpperCase() !== 'ELIMINA') {
    res.status(400).json({ errore: 'Per confermare scrivi ELIMINA' });
    return;
  }
  const utente = await prisma.user.findUnique({ where: { id: (req as any).userId as number } });
  if (!utente) {
    res.status(404).json({ errore: 'Utente non trovato' });
    return;
  }
  // La password serve anche qui: chi trova un telefono sbloccato non può cancellare l'account.
  if (!(await bcrypt.compare(password, utente.password))) {
    res.status(400).json({ errore: 'La password non è corretta' });
    return;
  }
  if (utente.admin) {
    res.status(403).json({ errore: "L'account amministratore non si può eliminare dall'app" });
    return;
  }
  if (utente.ruolo === 'TRAINER') {
    const clienti = await prisma.user.count({ where: { trainerId: utente.id } });
    if (clienti > 0) {
      res.status(409).json({
        errore: `Hai ancora ${clienti === 1 ? '1 cliente collegato' : `${clienti} clienti collegati`}: scrivi all'amministratore dell'app per chiudere o trasferire i loro account, poi potrai eliminare il tuo.`,
      });
      return;
    }
  }

  const id = utente.id;
  // Tutto in una transazione: o si cancella tutto, o non si cancella niente.
  await prisma.$transaction(async (tx) => {
    if (utente.ruolo === 'CLIENTE') {
      // Prima le serie e gli allenamenti conclusi (bloccano la cancellazione di esercizi e schede),
      // poi misure e schede (gli esercizi delle schede si cancellano insieme a loro).
      await tx.registroAllenamento.deleteMany({ where: { clienteId: id } });
      await tx.sessioneAllenamento.deleteMany({ where: { clienteId: id } });
      await tx.misuraCorporea.deleteMany({ where: { OR: [{ clienteId: id }, { inseritaDaId: id }] } });
      await tx.scheda.deleteMany({ where: { clienteId: id } });
    } else {
      // Trainer senza clienti: i suoi inviti (non servono più a nessuno). Libreria esercizi
      // e note salvate si cancellano da sole insieme a lui (onDelete: Cascade).
      await tx.invito.deleteMany({ where: { trainerId: id } });
    }
    // L'invito con cui si era registrato resta nello storico di chi l'ha creato, senza più il collegamento.
    await tx.invito.updateMany({ where: { usatoDaId: id }, data: { usatoDaId: null } });
    await tx.user.delete({ where: { id } });
  });
  res.status(204).send();
});

export default router;
