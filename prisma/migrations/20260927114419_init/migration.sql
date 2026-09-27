-- CreateEnum
CREATE TYPE "Ruolo" AS ENUM ('TRAINER', 'CLIENTE');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "ruolo" "Ruolo" NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scheda" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "clienteId" INTEGER NOT NULL,

    CONSTRAINT "Scheda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Esercizio" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "videoUrl" TEXT,
    "serieTarget" INTEGER NOT NULL,
    "repsTarget" INTEGER NOT NULL,
    "recuperoSecondi" INTEGER NOT NULL,
    "schedaId" INTEGER NOT NULL,

    CONSTRAINT "Esercizio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroAllenamento" (
    "id" SERIAL NOT NULL,
    "pesoUsato" DOUBLE PRECISION NOT NULL,
    "repsFatte" INTEGER NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "esercizioId" INTEGER NOT NULL,
    "clienteId" INTEGER NOT NULL,

    CONSTRAINT "RegistroAllenamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Scheda" ADD CONSTRAINT "Scheda_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Esercizio" ADD CONSTRAINT "Esercizio_schedaId_fkey" FOREIGN KEY ("schedaId") REFERENCES "Scheda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroAllenamento" ADD CONSTRAINT "RegistroAllenamento_esercizioId_fkey" FOREIGN KEY ("esercizioId") REFERENCES "Esercizio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroAllenamento" ADD CONSTRAINT "RegistroAllenamento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
