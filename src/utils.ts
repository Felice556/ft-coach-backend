import { Response } from 'express';

// Legge un id dall'URL (es. /schede/12). Se non è un intero positivo valido
// (es. /schede/abc) risponde subito 400 e restituisce null: la rotta deve fermarsi.
// Senza questo controllo, "abc" diventerebbe NaN e farebbe fallire la query al database.
export function leggiId(valore: string | string[] | undefined, res: Response): number | null {
  // Con Express 5 un parametro può anche essere un elenco: per noi è sempre non valido.
  const id = typeof valore === 'string' ? Number(valore) : NaN;
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
    res.status(400).json({ errore: 'Identificativo non valido' });
    return null;
  }
  return id;
}

// Come leggiId, ma per parametri FACOLTATIVI della query (es. ?clienteId=3):
// - assente → undefined (nessun filtro)
// - valido  → il numero
// - non valido (es. ?clienteId=abc) → risponde 400 e restituisce null: la rotta deve fermarsi.
export function leggiIdFacoltativo(valore: unknown, res: Response): number | undefined | null {
  if (valore === undefined || valore === '') return undefined;
  return leggiId(typeof valore === 'string' ? valore : undefined, res);
}
