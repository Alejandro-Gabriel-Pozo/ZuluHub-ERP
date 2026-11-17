-- 0075_alicuota_del_producto: un producto solo guarda una de las seis alícuotas con IVA (dueño, 12/11/2026, «Recomendadas en todas»; A2e). «EXENTO» y «NO_GRAVADO» se siguen emitiendo
-- en una factura, pero no se guardan en la ficha de un producto. La lista vive una vez en el dominio (`ALICUOTAS_DEL_PRODUCTO`, fiscal/dominio/alicuota.ts) y la base la copia;
-- `test/integracion/catalogo-alicuota-del-producto-migracion.test.ts` falla si difieren. Previene: que el código rechace una alícuota y la base la acepte (o al revés).
--
-- Cambio de restricción, no de datos: reemplaza el CHECK `producto_alicuota_ck` (0025: ocho códigos) por uno de seis. ENDURECE un control, así que FRENA (55000) si ya hay productos con
-- «EXENTO» o «NO_GRAVADO»: hay que AVISAR AL DUEÑO y decidir qué alícuota se les pone antes de aplicarla. No modifica filas, no agrega funciones, no cambia roles ni permisos.
-- Todo ocurre en una transacción: DROP y ADD mantienen el bloqueo de la tabla, no queda un instante sin restricción. La tabla del catálogo es chica; ADD valida las filas en el acto.
-- Reversión: `migraciones/reversiones/0075_revertir_alicuota_del_producto.sql` (afloja el control: siempre posible).
-- DEPENDE de 0025 (la tabla y la restricción); se comprueba al empezar.

DO $$
DECLARE
  v_filas bigint;
BEGIN
  IF to_regclass('public.producto') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'producto_alicuota_ck' AND conrelid = 'public.producto'::regclass) THEN
    RAISE EXCEPTION '0075 necesita 0025 (producto y producto_alicuota_ck)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la migración necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_filas FROM public.producto WHERE alicuota_iva IN ('EXENTO', 'NO_GRAVADO');
  IF v_filas > 0 THEN
    RAISE EXCEPTION 'hay % productos con alícuota EXENTO o NO_GRAVADO: avisar al dueño y decidir qué alícuota se les pone antes de aplicar', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE producto DROP CONSTRAINT producto_alicuota_ck;
ALTER TABLE producto ADD CONSTRAINT producto_alicuota_ck
  CHECK (alicuota_iva IN ('0', '2.5', '5', '10.5', '21', '27'));
