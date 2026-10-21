-- Diario alimentare: il cliente scrive i pasti di ogni giorno (con consenso apposito), il trainer li legge e commenta.
-- Solo tabelle nuove, un tipo nuovo e una colonna nuova (vuota): nessun dato esistente viene toccato.
-- CreateEnum
CREATE TYPE "TipoPasto" AS ENUM ('COLAZIONE', 'SPUNTINO_MATTINA', 'PRANZO', 'SPUNTINO_POMERIGGIO', 'CENA');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "consensoDiarioIl" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GiornoDiario" (
    "id" SERIAL NOT NULL,
    "data" DATE NOT NULL,
    "olioCucchiai" DOUBLE PRECISION,
    "acquaLitri" DOUBLE PRECISION,
    "sensazioni" TEXT,
    "commentoTrainer" TEXT,
    "commentatoIl" TIMESTAMP(3),
    "creatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" TIMESTAMP(3) NOT NULL,
    "clienteId" INTEGER NOT NULL,

    CONSTRAINT "GiornoDiario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PastoDiario" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoPasto" NOT NULL,
    "testo" TEXT NOT NULL,
    "ora" TEXT,
    "giornoId" INTEGER NOT NULL,

    CONSTRAINT "PastoDiario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiornoDiario_clienteId_data_key" ON "GiornoDiario"("clienteId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "PastoDiario_giornoId_tipo_key" ON "PastoDiario"("giornoId", "tipo");

-- AddForeignKey
ALTER TABLE "GiornoDiario" ADD CONSTRAINT "GiornoDiario_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastoDiario" ADD CONSTRAINT "PastoDiario_giornoId_fkey" FOREIGN KEY ("giornoId") REFERENCES "GiornoDiario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
