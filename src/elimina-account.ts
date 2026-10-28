import { prisma } from './prisma.js';

// Cancella un account con TUTTI i suoi dati, in una sola transazione (o tutto o niente).
// La usano "Elimina account" (Impostazioni) e "Non sono stato io: annulla la registrazione"
// (link nell'email di conferma). I controlli (password, admin, trainer con clienti) li fa chi la chiama.
export async function cancellaAccount(utente: { id: number; ruolo: 'TRAINER' | 'CLIENTE' }) {
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
}
