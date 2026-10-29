-- Ordine degli esercizi nella scheda: il trainer (o chi si allena da solo) può trascinarli.
-- Una sola colonna nuova; agli esercizi già esistenti diamo l'ordine che hanno sempre avuto
-- (quello di inserimento, cioè per id), così nessuna scheda cambia aspetto. Nessun dato viene cancellato.

-- AlterTable
ALTER TABLE "Esercizio" ADD COLUMN     "ordine" INTEGER NOT NULL DEFAULT 0;

-- Ordine attuale (per id) di ogni scheda: 0, 1, 2…
UPDATE "Esercizio" AS e
SET "ordine" = n.posizione
FROM (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY "schedaId" ORDER BY id) - 1)::INTEGER AS posizione
  FROM "Esercizio"
) AS n
WHERE e.id = n.id;
