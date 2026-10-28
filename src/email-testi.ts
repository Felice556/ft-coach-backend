// I testi delle email che Liftio manda (per ora solo "Password dimenticata?").
// Non sono messaggi d'errore delle risposte: l'italiano e l'inglese stanno qui insieme,
// e il controllo delle traduzioni (tests/traduzioni.test.ts) salta questo file e email.ts.

// Il testo dell'email, in italiano o in inglese come l'app di chi l'ha chiesta.
export function emailReset(a: string, nome: string, link: string, lingua: 'it' | 'en', durataMinuti: number) {
  const it = lingua === 'it';
  const saluto = it ? `Ciao ${nome},` : `Hi ${nome},`;
  const righe = it
    ? [
        'hai chiesto di reimpostare la password del tuo account Liftio.',
        `Tocca il pulsante qui sotto per sceglierne una nuova: il link vale ${durataMinuti} minuti e si può usare una volta sola.`,
        'Se non sei stato tu, ignora questa email: la tua password resta quella di prima.',
      ]
    : [
        'you asked to reset the password of your Liftio account.',
        `Tap the button below to choose a new one: the link is valid for ${durataMinuti} minutes and can be used only once.`,
        "If it wasn't you, ignore this email: your password stays the same.",
      ];
  const pulsante = it ? 'Scegli una nuova password' : 'Choose a new password';
  const oggetto = it ? 'Reimposta la password di Liftio' : 'Reset your Liftio password';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#e9eefb;font-family:Arial,Helvetica,sans-serif;color:#0a1430">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">
<p style="margin:0 0 20px;font-size:20px;font-weight:900;letter-spacing:-0.5px">LIFTIO<span style="color:#b45309">.</span></p>
<p style="margin:0 0 12px;font-size:16px">${esc(saluto)}</p>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(righe[0])}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">${esc(righe[1])}</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${esc(pulsante)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#4b5563;line-height:1.5">${esc(righe[2])}</p>
<p style="margin:0;font-size:12px;color:#6b7280;word-break:break-all">${esc(link)}</p>
</div></body></html>`;
  const testo = `${saluto}\n\n${righe[0]}\n${righe[1]}\n\n${link}\n\n${righe[2]}\n\nLiftio`;
  return { a, oggetto, testo, html };
}
