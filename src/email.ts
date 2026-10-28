// Invio delle email di servizio (per ora solo "Password dimenticata?") con Resend (resend.com).
// Chiamiamo direttamente la sua API con fetch: nessuna libreria in più da installare.
//
// Variabili d'ambiente, da impostare su Render (mai nel codice, mai su GitHub):
// - RESEND_API_KEY: la chiave segreta presa dal pannello di Resend;
// - EMAIL_MITTENTE: chi spedisce, es. "Liftio <noreply@liftio.it>" (dominio verificato su Resend).
// Senza RESEND_API_KEY (sviluppo, test) l'email non parte: lo scriviamo nel log e restituiamo false.

export type Email = { a: string; oggetto: string; testo: string; html: string };

// Solo per i test: raccoglie le email invece di spedirle.
let intercetta: ((email: Email) => void) | null = null;
export function intercettaEmail(f: ((email: Email) => void) | null) {
  intercetta = f;
}

export async function inviaEmail(email: Email): Promise<boolean> {
  if (intercetta) {
    intercetta(email);
    return true;
  }
  const chiave = process.env.RESEND_API_KEY;
  if (!chiave) {
    if (!process.env.VITEST) console.warn('RESEND_API_KEY non impostata: email non inviata.');
    return false;
  }
  try {
    const risposta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chiave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_MITTENTE || 'Liftio <noreply@liftio.it>',
        to: [email.a],
        subject: email.oggetto,
        text: email.testo,
        html: email.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!risposta.ok) {
      // Mai l'indirizzo del destinatario nei log: basta il codice d'errore di Resend.
      console.error('Resend ha rifiutato l’email:', risposta.status, (await risposta.text().catch(() => '')).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error('Invio email non riuscito:', err instanceof Error ? err.message : err);
    return false;
  }
}
