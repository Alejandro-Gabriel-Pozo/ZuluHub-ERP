-- 0058_oferta_vigente: la oferta de un proveedor (`oferta_de_proveedor`) puede quedar «no vigente» cuando se anula la última compra que la formó y no hay otra anterior (D11b).
-- Hasta ahora anular esa compra dejaba en la ficha del proveedor el precio de una compra que ya no existe. No se borra la fila (trazabilidad: lo que pasó queda; mínimo privilegio: la
-- aplicación sigue sin DELETE): se marca `vigente = false` y las lecturas la ignoran. Si hay una compra anterior vigente, la oferta se recalcula con ella y sigue `vigente`.
-- Previene: mostrar como «lo que nos cobra el proveedor» el precio de una compra anulada. Probado por `test/integracion/compras-oferta-vigente.test.ts`.
--
-- Reglas de esta migración (las mismas de 0036 y 0047):
--  * ADITIVA y compatible hacia atrás: una columna `boolean NOT NULL DEFAULT true` (todas las ofertas que existen quedan vigentes; el código anterior no la nombra y la
--    inserción sigue sin pasarla) y un permiso de UPDATE por columna. No toca datos, no agrega funciones ni cambia roles, no agrega DELETE.
--  * Su reversión es `migraciones/reversiones/0058_revertir_oferta_vigente.sql` (frena si hay ofertas no vigentes: quitar la columna las volvería a mostrar con el precio anulado).
-- DEPENDE de 0037 (la tabla y sus permisos); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.oferta_de_proveedor') IS NULL THEN
    RAISE EXCEPTION '0058 necesita 0037 (oferta_de_proveedor)';
  END IF;
END
$$;

ALTER TABLE oferta_de_proveedor ADD COLUMN vigente boolean NOT NULL DEFAULT true;

GRANT UPDATE (vigente) ON oferta_de_proveedor TO pedernal_app;
