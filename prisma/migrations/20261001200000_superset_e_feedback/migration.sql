-- CreateEnum
CREATE TYPE "TipoCollegamento" AS ENUM ('SUPERSET', 'JUMPSET');

-- AlterTable
ALTER TABLE "SessioneAllenamento" ADD COLUMN     "fatica" INTEGER,
ADD COLUMN     "nota" TEXT;

-- AlterTable
ALTER TABLE "Esercizio" ADD COLUMN     "collegamento" "TipoCollegamento";
