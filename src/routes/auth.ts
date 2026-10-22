import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica, richiedeRuolo, creaToken, motivoSospensione } from '../middleware/auth.js';
import { leggiId } from '../utils.js';
import { limiteCambioPassword, limiteCollegamento, limiteLoginPerEmail, limiteLoginPerIp, limiteRegistrazione } from '../limiti.js';
import { normalizzaCodice } from './inviti.js';
import { clienteDelTrainer, LIMITE_SCHEDE_GRATIS, schedePersonali } from '../proprieta.js';

const router = Router();

// Stesse regole della registrazione per ogni nuova password.
const passwordSchema = z.string().min(8, 'La password deve avere almeno 8 caratteri').max(72);

// Fasce di clienti seguiti, chieste ai trainer che si registrano senza invito.
export const FASCE_CLIENTI = ['1-10', '11-30', '31-50', '50+'] as const;

const registerSchema = z.object({
  nome: z.string().trim().min(2, 'Il nome deve avere almeno 2 caratteri').max(60),
  email: z.string().trim().toLowerCase().email('Email non valida'),
  password: z.string().min(8, 'La password deve avere almeno 8 caratteri').max(72), // bcrypt usa solo i primi 72 byte
  ruolo: z.enum(['TRAINER', 'CLIENTE']).default('CLIENTE'),
  codiceInvito: z.string().max(20).optional(),
  // Solo per i trainer senza invito: due righe (facoltative) per presentarsi all'amministratore.
  presentazione: z.string().trim().max(500, 'La presentazione può avere al massimo 500 caratteri').optional(),
  // Solo per i trainer senza invito (obbligatoria per loro): quanti clienti seguono, a fasce.
  fasciaClienti: z.enum(FASCE_CLIENTI).optional(),
});

// Serve alla schermata di registrazione (versioni vecchie dell'app): il codice invito
// non è più obbligatorio, perché senza codice ci si iscrive per allenarsi da soli.
router.get('/registrazione/info', (_req, res) => {
  res.json({ invitoObbligatorio: false });
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
  // approva (può presentarsi in due righe, se vuole). Fino ad allora non può fare niente.
  // Un CLIENTE si registra con l'invito del suo trainer, oppure SENZA invito per allenarsi da solo
  // (si crea le sue schede; potrà collegarsi a un trainer più avanti, con un suo codice).
  const inAttesa = ruolo === 'TRAINER' && !codiceInvito;
  const presentazione = risultato.data.presentazione || null; // facoltativa
  const fasciaClienti = risultato.data.fasciaClienti ?? null;
  if (inAttesa && !fasciaClienti) {
    res.status(400).json({ errore: 'Indica quanti clienti segui' });
    return;
  }

  // Confronto senza distinguere maiuscole/minuscole: "Alessio@Test.com" = "alessio@test.com".
  const esistente = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (esistente) {
    res.status(400).json({ errore: 'Email già registrata' });
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
      // - senza invito: a nessuno, si allena da solo.
      // Un nuovo trainer non appartiene a nessuno. "admin" non si imposta MAI qui.
      let trainerId: number | null = null;
      if (codiceInvito) {
        const invito = await tx.invito.findUnique({ where: { codice: codiceInvito }, include: { trainer: { select: { sospeso: true } } } });
        // L'invito deve essere del tipo giusto: un invito cliente non crea un trainer, e viceversa.
        // E non vale se chi l'ha creato è stato sospeso.
        if (!invito || invito.ruolo !== ruolo || invito.trainer.sospeso) throw new Error('INVITO_NON_VALIDO');
        if (ruolo === 'CLIENTE') trainerId = invito.trainerId;
      }

      const nuovo = await tx.user.create({
        data: {
          nome,
          email,
          password: passwordHash,
          ruolo,
          trainerId,
          ...(inAttesa ? { approvato: false, presentazione, fasciaClienti, richiestaIl: new Date() } : {}),
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
  const utente = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    include: { trainer: { select: { sospeso: true } } },
  });
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

  // Account sospeso (o cliente di un trainer sospeso): password giusta, ma niente accesso.
  // Lo diciamo solo DOPO aver controllato la password, così non si scopre chi è sospeso.
  const motivo = motivoSospensione(utente);
  if (motivo) {
    res.status(403).json({ errore: motivo, codice: 'SOSPESO' });
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
    select: { id: true, nome: true, email: true, sospeso: true }, // mai la password
    orderBy: { nome: 'asc' },
  });
  res.json(clienti);
});

// Il trainer sospende o riattiva un SUO cliente. Nessun dato viene toccato: il cliente
// semplicemente non può accedere finché non viene riattivato.
for (const [azione, sospeso] of [['sospendi', true], ['riattiva', false]] as const) {
  router.post(`/clienti/:id/${azione}`, autentica, richiedeRuolo('TRAINER'), async (req, res) => {
    const id = leggiId(req.params.id, res);
    if (id === null) return;
    if (!(await trovaCliente(req, id))) {
      res.status(404).json({ errore: 'Cliente non trovato' });
      return;
    }
    const aggiornato = await prisma.user.update({
      where: { id },
      data: { sospeso, sospesoIl: sospeso ? new Date() : null },
      select: { id: true, nome: true, email: true, sospeso: true },
    });
    res.json(aggiornato);
  });
}

// Chi sono: serve al frontend per sapere, ad esempio, se mostrare la sezione amministratore,
// o (per i clienti) chi è il loro trainer e quante schede gratis hanno usato se si allenano da soli.
async function datiMe(id: number) {
  const utente = await prisma.user.findUnique({
    where: { id },
    select: { id: true, nome: true, ruolo: true, admin: true, approvato: true, trainer: { select: { nome: true } } }, // mai la password
  });
  if (!utente) return null;
  const { approvato, trainer, ...resto } = utente;
  const base = { ...resto, inAttesa: utente.ruolo === 'TRAINER' && !approvato };
  if (utente.ruolo !== 'CLIENTE') return base;
  return {
    ...base,
    trainer: trainer ? { nome: trainer.nome } : null, // null = si allena da solo
    schedePersonali: await prisma.scheda.count({ where: schedePersonali(id) }), // anche archiviate o in pausa
    limiteSchede: LIMITE_SCHEDE_GRATIS,
  };
}

router.get('/me', autentica, async (req, res) => {
  const dati = await datiMe((req as any).userId as number);
  if (!dati) {
    res.status(404).json({ errore: 'Utente non trovato' });
    return;
  }
  res.json(dati);
});

// ---------- Il cliente sceglie se allenarsi con un trainer o da solo ----------

// Collegarsi a un trainer con il codice invito che gli ha dato (anche per cambiare trainer).
// Le schede create da solo restano salvate, "in pausa": tornano se un giorno lascia il trainer.
// Il trainer vedrà misure, cardio, passi e diario SOLO da oggi in poi (collegatoIl).
router.post('/me/trainer', limiteCollegamento, autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const risultato = z.object({ codiceInvito: z.string().trim().min(1, 'Scrivi il codice invito').max(20) }).safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const codice = normalizzaCodice(risultato.data.codiceInvito);
  const id = (req as any).userId as number;
  try {
    await prisma.$transaction(async (tx) => {
      const io = await tx.user.findUnique({ where: { id }, select: { trainerId: true } });
      const invito = await tx.invito.findUnique({ where: { codice }, include: { trainer: { select: { sospeso: true, approvato: true } } } });
      if (!invito || invito.ruolo !== 'CLIENTE' || invito.trainer.sospeso || !invito.trainer.approvato) throw new Error('INVITO_NON_VALIDO');
      if (invito.trainerId === io?.trainerId) throw new Error('GIA_COLLEGATO');
      // Come alla registrazione: l'invito vale una volta sola, anche con due richieste nello stesso istante.
      const { count } = await tx.invito.updateMany({
        where: { codice, ruolo: 'CLIENTE', usatoIl: null, annullatoIl: null, scadeIl: { gt: new Date() } },
        data: { usatoIl: new Date(), usatoDaId: id },
      });
      if (count !== 1) throw new Error('INVITO_NON_VALIDO');
      await tx.user.update({ where: { id }, data: { trainerId: invito.trainerId, collegatoIl: new Date() } });
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVITO_NON_VALIDO') {
      res.status(400).json({ errore: 'Codice invito non valido, scaduto o già usato' });
      return;
    }
    if (err instanceof Error && err.message === 'GIA_COLLEGATO') {
      res.status(400).json({ errore: 'Sei già seguito da questo trainer' });
      return;
    }
    throw err;
  }
  res.json(await datiMe(id));
});

// Smettere di allenarsi con il trainer: il cliente torna ad allenarsi da solo.
// Non si cancella NIENTE: le schede del trainer (con tutto lo storico) restano salvate,
// le schede personali tornano attive, e il trainer non vede più i suoi dati.
// Serve la password: chi trova un telefono sbloccato non può staccare il cliente dal trainer.
router.delete('/me/trainer', limiteCambioPassword, autentica, richiedeRuolo('CLIENTE'), async (req, res) => {
  const risultato = z.object({ password: z.string().min(1, 'Scrivi la tua password').max(72) }).safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const id = (req as any).userId as number;
  const utente = await prisma.user.findUnique({ where: { id } });
  if (!utente) {
    res.status(404).json({ errore: 'Utente non trovato' });
    return;
  }
  if (!(await bcrypt.compare(risultato.data.password, utente.password))) {
    res.status(400).json({ errore: 'La password non è corretta' });
    return;
  }
  if (!utente.trainerId) {
    res.status(400).json({ errore: 'Ti alleni già da solo' });
    return;
  }
  await prisma.user.update({ where: { id }, data: { trainerId: null, collegatoIl: null } });
  res.json(await datiMe(id));
});

// ---------- Eliminare il proprio account ----------
// Chiesto da Google Play (e dal GDPR): ognuno può cancellare il proprio account dall'app.
// È definitivo, quindi servono la password e la parola "ELIMINA" scritta a mano
// (oppure "DELETE", la stessa parola per chi usa l'app in inglese).
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
  if (!['ELIMINA', 'DELETE'].includes(conferma.trim().toUpperCase())) {
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
      await tx.cardioFatto.deleteMany({ where: { clienteId: id } });
      await tx.obiettivoCardio.deleteMany({ where: { clienteId: id } });
      await tx.passiGiornalieri.deleteMany({ where: { clienteId: id } });
      await tx.giornoDiario.deleteMany({ where: { clienteId: id } }); // i pasti si cancellano con le giornate
      await tx.scheda.deleteMany({ where: { clienteId: id } });
    } else {
      // Trainer senza clienti: i suoi inviti (non servono più a nessuno). Libreria esercizi
      // e note salvate si cancellano da sole insieme a lui (onDelete: Cascade).
      await tx.invito.deleteMany({ where: { trainerId: id } });
      // Clienti che lo hanno lasciato: le schede che aveva preparato restano a loro con lo storico
      // (il database toglie solo il collegamento al trainer), e la massa grassa che aveva inserito
      // per loro resta, segnata come inserita dal cliente stesso.
      await tx.$executeRaw`UPDATE "MisuraCorporea" SET "inseritaDaId" = "clienteId" WHERE "inseritaDaId" = ${id}`;
    }
    // L'invito con cui si era registrato resta nello storico di chi l'ha creato, senza più il collegamento.
    await tx.invito.updateMany({ where: { usatoDaId: id }, data: { usatoDaId: null } });
    await tx.user.delete({ where: { id } });
  });
  res.status(204).send();
});

export default router;
