-- CreateTable
CREATE TABLE "Invito" (
    "id" SERIAL NOT NULL,
    "codice" TEXT NOT NULL,
    "nota" TEXT,
    "creatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scadeIl" TIMESTAMP(3) NOT NULL,
    "usatoIl" TIMESTAMP(3),
    "annullatoIl" TIMESTAMP(3),
    "trainerId" INTEGER NOT NULL,
    "usatoDaId" INTEGER,

    CONSTRAINT "Invito_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invito_codice_key" ON "Invito"("codice");

-- CreateIndex
CREATE UNIQUE INDEX "Invito_usatoDaId_key" ON "Invito"("usatoDaId");

-- AddForeignKey
ALTER TABLE "Invito" ADD CONSTRAINT "Invito_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invito" ADD CONSTRAINT "Invito_usatoDaId_fkey" FOREIGN KEY ("usatoDaId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
