-- CreateTable
CREATE TABLE "SessioneAllenamento" (
    "id" SERIAL NOT NULL,
    "completataIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serieFatte" INTEGER NOT NULL,
    "serieTotali" INTEGER NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "schedaId" INTEGER NOT NULL,
    "clienteId" INTEGER NOT NULL,

    CONSTRAINT "SessioneAllenamento_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SessioneAllenamento" ADD CONSTRAINT "SessioneAllenamento_schedaId_fkey" FOREIGN KEY ("schedaId") REFERENCES "Scheda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessioneAllenamento" ADD CONSTRAINT "SessioneAllenamento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
