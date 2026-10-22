-- Annunci dell'amministratore a chi aspetta un programma. Solo aggiunte: nessun dato esistente viene toccato.

-- AlterTable
ALTER TABLE "AvvisoProgramma" ADD COLUMN     "annuncioVistoIl" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AnnuncioProgramma" (
    "id" SERIAL NOT NULL,
    "programma" TEXT NOT NULL,
    "messaggio" TEXT NOT NULL,
    "creatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnuncioProgramma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnnuncioProgramma_programma_creatoIl_idx" ON "AnnuncioProgramma"("programma", "creatoIl");
