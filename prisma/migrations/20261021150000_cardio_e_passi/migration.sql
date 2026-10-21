-- Cardio e passi: piano cardio del trainer, cardio fatto e passi giornalieri del cliente.
-- Solo tabelle nuove e una colonna nuova (vuota): nessun dato esistente viene toccato.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "obiettivoPassi" INTEGER;

-- CreateTable
CREATE TABLE "ObiettivoCardio" (
    "id" SERIAL NOT NULL,
    "attivita" TEXT NOT NULL,
    "minuti" INTEGER NOT NULL,
    "volteSettimana" INTEGER NOT NULL,
    "nota" TEXT,
    "creatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clienteId" INTEGER NOT NULL,

    CONSTRAINT "ObiettivoCardio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardioFatto" (
    "id" SERIAL NOT NULL,
    "attivita" TEXT NOT NULL,
    "minuti" INTEGER NOT NULL,
    "distanzaKm" DOUBLE PRECISION,
    "nota" TEXT,
    "data" DATE NOT NULL,
    "creatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "obiettivoId" INTEGER,
    "clienteId" INTEGER NOT NULL,

    CONSTRAINT "CardioFatto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassiGiornalieri" (
    "id" SERIAL NOT NULL,
    "passi" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "aggiornatoIl" TIMESTAMP(3) NOT NULL,
    "clienteId" INTEGER NOT NULL,

    CONSTRAINT "PassiGiornalieri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObiettivoCardio_clienteId_idx" ON "ObiettivoCardio"("clienteId");

-- CreateIndex
CREATE INDEX "CardioFatto_clienteId_data_idx" ON "CardioFatto"("clienteId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "PassiGiornalieri_clienteId_data_key" ON "PassiGiornalieri"("clienteId", "data");

-- AddForeignKey
ALTER TABLE "ObiettivoCardio" ADD CONSTRAINT "ObiettivoCardio_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardioFatto" ADD CONSTRAINT "CardioFatto_obiettivoId_fkey" FOREIGN KEY ("obiettivoId") REFERENCES "ObiettivoCardio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardioFatto" ADD CONSTRAINT "CardioFatto_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassiGiornalieri" ADD CONSTRAINT "PassiGiornalieri_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
