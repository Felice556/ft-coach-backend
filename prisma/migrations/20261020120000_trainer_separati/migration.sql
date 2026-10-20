-- Trainer separati: ogni cliente appartiene a un trainer, e c'è un solo amministratore.
-- Migrazione solo "additiva": aggiunge colonne, non cancella né modifica dati esistenti
-- (a parte assegnare i clienti al trainer attuale, vedi sotto).

-- Sicurezza: se nel database ci fosse più di un trainer ci fermiamo PRIMA di toccare
-- qualsiasi cosa, perché non sapremmo a chi assegnare i clienti.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "User" WHERE "ruolo" = 'TRAINER') > 1 THEN
    RAISE EXCEPTION 'Nel database c''è più di un trainer: migrazione fermata, nessun dato modificato';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "admin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trainerId" INTEGER;

-- AlterTable
ALTER TABLE "Invito" ADD COLUMN     "ruolo" "Ruolo" NOT NULL DEFAULT 'CLIENTE';

-- CreateIndex
CREATE INDEX "User_trainerId_idx" ON "User"("trainerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Dati: l'unico trainer di oggi (Felice) diventa l'amministratore
-- e tutti i clienti già registrati diventano suoi. Nessun dato viene perso.
UPDATE "User" SET "admin" = true
WHERE "id" = (SELECT MIN("id") FROM "User" WHERE "ruolo" = 'TRAINER');

UPDATE "User" SET "trainerId" = (SELECT MIN("id") FROM "User" WHERE "ruolo" = 'TRAINER')
WHERE "ruolo" = 'CLIENTE';
