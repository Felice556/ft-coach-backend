-- Clienti che si allenano da soli (senza trainer) e possibilità di cambiare trainer.
-- Nessun dato viene cancellato: si aggiungono solo colonne e indici, e si compilano quelle nuove.

-- Un cliente può usare più inviti nel tempo (registrazione, poi un altro trainer...):
-- l'indice "unico" diventa un indice normale. I collegamenti esistenti restano tutti.
DROP INDEX "Invito_usatoDaId_key";
CREATE INDEX "Invito_usatoDaId_idx" ON "Invito"("usatoDaId");

-- Da quando il cliente è collegato al trainer attuale (null = da sempre: vale per tutti i clienti di oggi).
ALTER TABLE "User" ADD COLUMN     "collegatoIl" TIMESTAMP(3);

-- Chi ha preparato la scheda (trainer) e se è una scheda che il cliente si è creato da solo.
ALTER TABLE "Scheda" ADD COLUMN     "personale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trainerId" INTEGER;

-- Schede esistenti: le ha preparate il trainer attuale del cliente (oggi è sempre così).
UPDATE "Scheda" AS s SET "trainerId" = u."trainerId"
FROM "User" AS u
WHERE s."clienteId" = u."id" AND u."trainerId" IS NOT NULL;

-- Rete di sicurezza: se un cliente non avesse un trainer, le sue schede restano sue e visibili a lui.
UPDATE "Scheda" AS s SET "personale" = true
FROM "User" AS u
WHERE s."clienteId" = u."id" AND u."trainerId" IS NULL;

CREATE INDEX "Scheda_clienteId_idx" ON "Scheda"("clienteId");
CREATE INDEX "Scheda_trainerId_idx" ON "Scheda"("trainerId");

ALTER TABLE "Scheda" ADD CONSTRAINT "Scheda_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
