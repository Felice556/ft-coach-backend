-- CreateEnum
CREATE TYPE "TipoMisura" AS ENUM ('PESO', 'MASSA_GRASSA');

-- CreateTable
CREATE TABLE "MisuraCorporea" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoMisura" NOT NULL,
    "valore" DOUBLE PRECISION NOT NULL,
    "data" DATE NOT NULL,
    "creataIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornataIl" TIMESTAMP(3) NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "inseritaDaId" INTEGER NOT NULL,

    CONSTRAINT "MisuraCorporea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MisuraCorporea_clienteId_tipo_data_key" ON "MisuraCorporea"("clienteId", "tipo", "data");

-- AddForeignKey
ALTER TABLE "MisuraCorporea" ADD CONSTRAINT "MisuraCorporea_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisuraCorporea" ADD CONSTRAINT "MisuraCorporea_inseritaDaId_fkey" FOREIGN KEY ("inseritaDaId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
