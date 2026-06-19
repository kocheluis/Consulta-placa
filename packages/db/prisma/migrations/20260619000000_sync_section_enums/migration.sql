-- Sincroniza los enums de la base con @app/shared (fuentes y secciones PRO).
-- En Postgres 12+ ALTER TYPE ... ADD VALUE es seguro mientras no se use el
-- valor nuevo en la misma transacción (aquí solo se agregan).

ALTER TYPE "SectionKind" ADD VALUE 'CAPTURA';
ALTER TYPE "SectionKind" ADD VALUE 'REVISION_TECNICA';
ALTER TYPE "SectionKind" ADD VALUE 'TRANSPORTE';
ALTER TYPE "SectionKind" ADD VALUE 'MULTAS_ELECTORALES';
ALTER TYPE "SectionKind" ADD VALUE 'GRAVAMENES';

ALTER TYPE "SourceId" ADD VALUE 'SAT';
ALTER TYPE "SourceId" ADD VALUE 'SUTRAN';
ALTER TYPE "SourceId" ADD VALUE 'MTC';
ALTER TYPE "SourceId" ADD VALUE 'ATU';
ALTER TYPE "SourceId" ADD VALUE 'ONPE';
ALTER TYPE "SourceId" ADD VALUE 'SIGM';
