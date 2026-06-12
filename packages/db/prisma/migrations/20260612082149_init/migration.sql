-- CreateEnum
CREATE TYPE "SectionKind" AS ENUM ('REGISTRAL', 'SEGUROS', 'SINIESTRALIDAD', 'PAPELETAS', 'GNV', 'DEUDA_BANCARIA', 'PNP');

-- CreateEnum
CREATE TYPE "SourceId" AS ENUM ('SUNARP', 'SBS', 'APESEG');

-- CreateEnum
CREATE TYPE "SectionStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'COMING_SOON', 'NOT_FOUND');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('COMPLETE', 'PARTIAL');

-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('ACCESS', 'DELETION', 'RECTIFICATION', 'OPPOSITION');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('RECEIVED', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "plateNormalized" TEXT NOT NULL,
    "plateDisplay" TEXT NOT NULL,
    "platePrevious" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "color" TEXT,
    "serie" TEXT,
    "vin" TEXT,
    "engineNumber" TEXT,
    "stolenAlert" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerRecord" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT,
    "plateNormalized" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionResult" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "kind" "SectionKind" NOT NULL,
    "source" "SourceId",
    "status" "SectionStatus" NOT NULL,
    "fetchedAt" TIMESTAMP(3),
    "errorReason" TEXT,
    "payload" JSONB,

    CONSTRAINT "SectionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryJob" (
    "id" TEXT NOT NULL,
    "plateNormalized" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "forceRefresh" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL,
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "QueryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "plateNormalized" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "accessedOwnerData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "contactEmail" TEXT NOT NULL,
    "plateOrSubject" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plateNormalized_key" ON "Vehicle"("plateNormalized");

-- CreateIndex
CREATE INDEX "OwnerRecord_vehicleId_idx" ON "OwnerRecord"("vehicleId");

-- CreateIndex
CREATE INDEX "OwnerRecord_expiresAt_idx" ON "OwnerRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "Report_plateNormalized_idx" ON "Report"("plateNormalized");

-- CreateIndex
CREATE INDEX "SectionResult_reportId_idx" ON "SectionResult"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "QueryJob_reportId_key" ON "QueryJob"("reportId");

-- CreateIndex
CREATE INDEX "QueryJob_plateNormalized_idx" ON "QueryJob"("plateNormalized");

-- CreateIndex
CREATE INDEX "AuditLog_plateNormalized_idx" ON "AuditLog"("plateNormalized");

-- AddForeignKey
ALTER TABLE "OwnerRecord" ADD CONSTRAINT "OwnerRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionResult" ADD CONSTRAINT "SectionResult_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryJob" ADD CONSTRAINT "QueryJob_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
