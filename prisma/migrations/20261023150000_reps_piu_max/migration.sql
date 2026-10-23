-- "+ max" (drop set) nelle ripetizioni, es. "6-9 + max". Solo due colonne nuove (false per tutto quello che esiste): nessun dato viene toccato.

-- AlterTable
ALTER TABLE "Esercizio" ADD COLUMN     "piuMax" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SerieExtra" ADD COLUMN     "piuMax" BOOLEAN NOT NULL DEFAULT false;
