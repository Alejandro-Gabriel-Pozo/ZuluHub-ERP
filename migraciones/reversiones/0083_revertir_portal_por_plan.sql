-- migraciones/reversiones/0083_revertir_portal_por_plan.sql  (sin pérdida de datos; se puede repetir)
--   BEGIN;
--   \i migraciones/reversiones/0083_revertir_portal_por_plan.sql
--   COMMIT;
-- Efecto de revertir: el portal deja de poder leer el plan de la empresa; el lector tiene que cerrar (denegar por defecto), o sea que el portal DEJA DE VERSE. Bajar primero ese código.
DROP POLICY IF EXISTS tenant_publico_de_portal ON tenant;
DROP POLICY IF EXISTS empresa_publico_de_portal ON empresa;
DROP POLICY IF EXISTS ajuste_de_perilla_publico_de_portal ON ajuste_de_perilla;
DROP POLICY IF EXISTS version_de_plan_publico_de_portal ON version_de_plan;
DROP POLICY IF EXISTS plan_de_tenant_publico_de_portal ON plan_de_tenant;
DROP POLICY IF EXISTS modulo_de_empresa_publico_de_portal ON modulo_de_empresa;
DELETE FROM migracion WHERE nombre = '0083_portal_por_plan.sql';   -- † ídem §5
