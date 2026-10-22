import { NextFunction, Request, Response } from 'express';

// Messaggi del server in inglese, per chi usa l'app in inglese.
// Il codice resta scritto in italiano (come sempre): l'app manda "Accept-Language: en" e questo
// middleware, appena prima di rispondere, traduce i campi "errore" e "errori[].message".
// Senza l'intestazione (o con "it") la risposta resta in italiano, esattamente come prima.

// Testo italiano → testo inglese. Un test (tests/traduzioni.test.ts) controlla che ogni messaggio
// scritto nel codice sia qui: se ne aggiungi uno nuovo e dimentichi la traduzione, il test fallisce.
export const INGLESE: Record<string, string> = {
  // Accesso e account
  'Credenziali non valide': 'Invalid email or password',
  'Email già registrata': 'Email already registered',
  'Email non valida': 'Invalid email',
  'Il nome deve avere almeno 2 caratteri': 'The name must be at least 2 characters',
  'La password deve avere almeno 8 caratteri': 'The password must be at least 8 characters',
  'Serve il codice invito che ti ha dato il tuo trainer': 'You need the invite code your trainer gave you',
  'Codice invito non valido, scaduto o già usato': 'Invite code invalid, expired or already used',
  'Indica quanti clienti segui': 'Tell us how many clients you train',
  'La presentazione può avere al massimo 500 caratteri': 'The introduction can be at most 500 characters',
  'Token mancante': 'Missing token',
  'Token non valido o scaduto': 'Invalid or expired token',
  'Sessione non più valida, accedi di nuovo': 'Session no longer valid, sign in again',
  'Devi prima scegliere una nuova password': 'You need to choose a new password first',
  'Il tuo account trainer è in attesa di approvazione': 'Your trainer account is awaiting approval',
  'Il tuo account è sospeso: contatta il tuo trainer.': 'Your account is suspended: contact your trainer.',
  "Il tuo account trainer è sospeso: contatta l'amministratore di Liftio.": 'Your trainer account is suspended: contact the Liftio administrator.',
  'Il tuo trainer al momento non è attivo su Liftio, quindi non puoi accedere. Contattalo per sapere di più.':
    'Your trainer isn’t active on Liftio at the moment, so you can’t sign in. Contact them to find out more.',
  'Non hai i permessi per questa azione': 'You don’t have permission for this action',
  'Scrivi la password attuale': 'Enter your current password',
  'Scrivi la tua password': 'Enter your password',
  'La password attuale non è corretta': 'The current password is incorrect',
  'La password non è corretta': 'The password is incorrect',
  'La nuova password deve essere diversa da quella attuale': 'The new password must be different from the current one',
  'Per confermare scrivi ELIMINA': 'To confirm, type DELETE',
  "L'account amministratore non si può eliminare dall'app": 'The administrator account can’t be deleted from the app',
  'Questa email è già usata da un altro account': 'This email is already used by another account',
  'Utente non trovato': 'User not found',

  // Limiti ai tentativi
  'Troppi tentativi sbagliati. Riprova tra 15 minuti.': 'Too many wrong attempts. Try again in 15 minutes.',
  'Troppi tentativi sbagliati su questo account. Riprova tra un’ora o chiedi al tuo trainer.':
    'Too many wrong attempts on this account. Try again in an hour or ask your trainer.',
  'Troppe registrazioni da questa rete. Riprova tra un’ora.': 'Too many sign-ups from this network. Try again in an hour.',
  'Troppe richieste in poco tempo. Riprova tra un minuto.': 'Too many requests in a short time. Try again in a minute.',
  'Troppi tentativi. Riprova tra 15 minuti.': 'Too many attempts. Try again in 15 minutes.',

  // Clienti, trainer e inviti
  'Cliente non trovato': 'Client not found',
  'Cliente non valido: controlla l’ID del cliente': 'Invalid client: check the client ID',
  'Indica il cliente': 'Specify the client',
  'Trainer non trovato': 'Trainer not found',
  'Richiesta non trovata (forse è già stata gestita)': 'Request not found (it may already have been handled)',
  'Invito non trovato, già usato o già annullato': 'Invite not found, already used or already cancelled',
  'Non è stato possibile creare il codice, riprova': 'The code couldn’t be created, try again',

  // Schede ed esercizi
  'Scheda non trovata': 'Programme not found',
  'Scheda non trovata o già archiviata': 'Programme not found or already archived',
  'Scheda non trovata o non archiviata': 'Programme not found or not archived',
  'La scheda è archiviata: ripristinala prima di modificarla': 'The programme is archived: restore it before editing it',
  'Archivia la scheda prima di eliminarla definitivamente': 'Archive the programme before deleting it permanently',
  'Questa scheda ha allenamenti registrati: per proteggere i dati del cliente resta in archivio':
    'This programme has logged workouts: to protect the client’s data it stays in the archive',
  'Questa scheda ha già allenamenti registrati: non si può assegnare a un altro cliente. Creane una nuova per lui.':
    'This programme already has logged workouts: it can’t be assigned to another client. Create a new one for them.',
  'Il nome della scheda non può essere vuoto': 'The programme name can’t be empty',
  'Il nome dell’esercizio non può essere vuoto': 'The exercise name can’t be empty',
  'Serve almeno un esercizio': 'At least one exercise is needed',
  'Esercizio non trovato': 'Exercise not found',
  'Esercizio non appartenente a questa scheda': 'Exercise doesn’t belong to this programme',
  'Esercizio non trovato, non archiviato, o scheda archiviata': 'Exercise not found, not archived, or programme archived',
  'Questo esercizio non fa più parte della tua scheda': 'This exercise is no longer part of your programme',
  'Il link del video deve iniziare con https://': 'The video link must start with https://',
  'Link video non valido': 'Invalid video link',
  'Preset non trovato': 'Saved exercise not found',
  'Nota non trovata': 'Note not found',
  'La nota non può essere vuota': 'The note can’t be empty',

  // Serie, allenamenti e misure
  'Serie non trovata': 'Set not found',
  'Il peso non può essere negativo': 'The weight can’t be negative',
  'Non puoi vedere lo storico di un altro cliente': 'You can’t see another client’s history',
  'Allenamento non trovato': 'Workout not found',
  'inizioGiornata non valido': 'Invalid inizioGiornata',
  'Misura non trovata': 'Measurement not found',
  'Il peso corporeo lo inserisce il cliente': 'Body weight is entered by the client',
  'La massa grassa la inserisce il trainer': 'Body fat is entered by the trainer',
  'Il peso deve essere tra 20 e 350 kg': 'Weight must be between 20 and 350 kg',
  'La massa grassa deve essere tra 2 e 70 %': 'Body fat must be between 2 and 70 %',
  'Data non valida': 'Invalid date',
  'Data non valida o nel futuro': 'Invalid date or in the future',

  // Cardio e passi
  'Il piano cardio lo decide il trainer': 'The cardio plan is set by the trainer',
  'Cardio fatto e passi li inserisce il cliente': 'Cardio done and steps are entered by the client',
  'Scrivi l’attività': 'Enter the activity',
  'Il nome dell’attività è troppo lungo': 'The activity name is too long',
  'La nota può avere al massimo 200 caratteri': 'The note can be at most 200 characters',
  'Minuti tra 1 e 600': 'Minutes between 1 and 600',
  'Da 1 a 14 volte a settimana': 'From 1 to 14 times a week',
  'Distanza tra 0 e 300 km': 'Distance between 0 and 300 km',
  'Passi tra 0 e 100.000': 'Steps between 0 and 100,000',
  'Obiettivo tra 1.000 e 50.000 passi': 'Target between 1,000 and 50,000 steps',
  'Il piano cardio può avere al massimo 10 attività': 'The cardio plan can have at most 10 activities',
  'Attività cardio non trovata': 'Cardio activity not found',
  'Sessione di cardio non trovata': 'Cardio session not found',

  // Diario alimentare
  'Ogni pasto può avere al massimo 500 caratteri': 'Each meal can be at most 500 characters',
  'Ora non valida': 'Invalid time',
  'Dai un nome alla voce': 'Give the entry a name',
  'Il nome della voce può avere al massimo 40 caratteri': 'The entry name can be at most 40 characters',
  'Al massimo 6 voci in più al giorno': 'At most 6 extra entries per day',
  'Olio tra 0 e 20 cucchiai': 'Oil between 0 and 20 tablespoons',
  'Acqua tra 0 e 10 litri': 'Water between 0 and 10 litres',
  'Le note possono avere al massimo 300 caratteri': 'Notes can be at most 300 characters',
  'Il commento può avere al massimo 1000 caratteri': 'The comment can be at most 1000 characters',
  'Il consenso al diario lo dà il cliente': 'Consent to the diary is given by the client',
  'Il diario lo scrive il cliente': 'The diary is written by the client',
  'Per usare il diario serve il tuo consenso': 'To use the diary we need your consent',
  'Il commento lo scrive il trainer': 'The comment is written by the trainer',
  'Il cliente non ha compilato il diario di quel giorno': 'The client hasn’t filled in the diary for that day',

  // Allenarsi da soli e collegarsi a un trainer
  'Le tue schede le prepara il tuo trainer': 'Your programmes are prepared by your trainer',
  'Hai già 30 schede attive: archiviane qualcuna per crearne altre': 'You already have 30 active programmes: archive some to create more',
  'Scrivi il codice invito': 'Enter the invite code',
  'Sei già seguito da questo trainer': 'This trainer already coaches you',
  'Ti alleni già da solo': 'You already train on your own',

  // Programmi in arrivo
  'Programma non trovato': 'Programme not found',
  'Scrivi il messaggio': 'Write the message',
  'Il messaggio può avere al massimo 300 caratteri': 'The message can be at most 300 characters',

  // Generici
  'Identificativo non valido': 'Invalid identifier',
  'Dati della richiesta non validi': 'Invalid request data',
  'Errore interno del server, riprova tra poco': 'Internal server error, try again shortly',
};

// Messaggi con un numero dentro: si riconoscono dalla forma e si traducono a parte.
const CON_NUMERI: [RegExp, (...p: string[]) => string][] = [
  [
    /^Hai ancora (?:1 cliente collegato|(\d+) clienti collegati): scrivi all'amministratore dell'app per chiudere o trasferire i loro account, poi potrai eliminare il tuo\.$/,
    (n) =>
      `You still have ${n ? `${n} linked clients` : '1 linked client'}: write to the app administrator to close or transfer their accounts, then you can delete yours.`,
  ],
];

export function traduci(testo: string, lingua: 'it' | 'en'): string {
  if (lingua === 'it') return testo;
  if (INGLESE[testo]) return INGLESE[testo];
  for (const [forma, inglese] of CON_NUMERI) {
    const m = testo.match(forma);
    if (m) return inglese(...m.slice(1));
  }
  return testo; // messaggio senza traduzione (es. quelli standard della validazione, già in inglese)
}

// Lingua chiesta dall'app: "en" per l'inglese; qualsiasi altra cosa (o niente) = italiano.
export function linguaRichiesta(req: Request): 'it' | 'en' {
  return req.acceptsLanguages('it', 'en') === 'en' ? 'en' : 'it';
}

// Middleware: traduce i messaggi d'errore di ogni risposta JSON nella lingua dell'app.
export function messaggiNellaLingua(req: Request, res: Response, next: NextFunction) {
  const lingua = linguaRichiesta(req);
  if (lingua === 'it') return next();
  const jsonOriginale = res.json.bind(res);
  res.json = (corpo: unknown) => {
    if (corpo && typeof corpo === 'object') {
      const c = corpo as { errore?: unknown; errori?: unknown };
      if (typeof c.errore === 'string') c.errore = traduci(c.errore, lingua);
      if (Array.isArray(c.errori)) {
        c.errori = c.errori.map((e) =>
          e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
            ? { ...e, message: traduci((e as { message: string }).message, lingua) }
            : e,
        );
      }
    }
    return jsonOriginale(corpo);
  };
  next();
}
