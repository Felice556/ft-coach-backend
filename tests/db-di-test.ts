// Quale database usano i test, e il controllo che lo rende IMPOSSIBILE usare quello vero.
//
// I test cancellano e ricreano i dati a ogni giro: per questo accettiamo solo un database
// sul proprio computer (localhost) e con "test" nel nome. Qualsiasi altro indirizzo
// (es. Supabase) viene rifiutato prima di toccare qualcosa.

export const URL_PREDEFINITO = 'postgresql://postgres:postgres@localhost:5432/ftcoach_test';

export function urlDatabaseDiTest(): string {
  return process.env.TEST_DATABASE_URL || URL_PREDEFINITO;
}

export function controllaDatabaseDiTest(url: string): void {
  let indirizzo: URL;
  try {
    indirizzo = new URL(url);
  } catch {
    throw new Error('TEST_DATABASE_URL non è un indirizzo valido');
  }
  const locale = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(indirizzo.hostname);
  const nome = indirizzo.pathname.replace(/^\//, '');
  if (!locale || !/test/i.test(nome)) {
    throw new Error(
      `I test si rifiutano di partire: "${indirizzo.hostname}/${nome}" non è un database di prova.\n` +
        'Serve un database su localhost con "test" nel nome (es. ftcoach_test), così i dati veri non si toccano mai.',
    );
  }
}
