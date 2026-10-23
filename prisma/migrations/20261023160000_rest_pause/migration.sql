-- "+ rp" (rest-pause) con la pausa in secondi, es. "6-9 + rp 15". Solo due colonne nuove, vuote: nessun dato viene toccato.

-- AlterTable
ALTER TABLE "Esercizio" ADD COLUMN     "rpSecondi" INTEGER;

-- AlterTable
ALTER TABLE "SerieExtra" ADD COLUMN     "rpSecondi" INTEGER;
