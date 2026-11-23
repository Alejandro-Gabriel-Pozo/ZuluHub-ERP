-- 0065_revertir_producto_en_la_linea_de_la_factura: deshace 0065 (quita `linea_de_comprobante.producto_id` con su clave foránea, su índice y su permiso).
--
-- DESTRUCTIVA si hay líneas con producto: BORRA ese dato y NO se recupera (las facturas de N3 pierden la propuesta de conciliación por producto; las conciliaciones ya hechas no cambian).
-- FRENA (55000) si hay alguna y no se confirma con `SET LOCAL pedernal.confirmar_reversion = 'SI'`: avisar al dueño y tener un respaldo antes. Se corre a mano, revisada, en una sola
-- transacción y con el rol dueño de la base (que evade RLS):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay líneas con producto
--     \i migraciones/reversiones/0065_revertir_producto_en_la_linea_de_la_factura.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
DECLARE
  v_filas bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'linea_de_comprobante' AND column_name = 'producto_id') THEN
    SELECT count(*) INTO v_filas FROM public.linea_de_comprobante WHERE producto_id IS NOT NULL;
    IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
      RAISE EXCEPTION 'hay % líneas de factura con producto que esta reversión borraría: avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas USING ERRCODE = '55000';
    END IF;
    DROP INDEX IF EXISTS public.linea_de_comprobante_producto_ix;
    REVOKE INSERT (producto_id) ON public.linea_de_comprobante FROM pedernal_app;
    ALTER TABLE public.linea_de_comprobante DROP CONSTRAINT linea_de_comprobante_producto_fkey;
    ALTER TABLE public.linea_de_comprobante DROP COLUMN producto_id;
  END IF;
END
$$;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0065_producto_en_la_linea_de_la_factura.sql';
  END IF;
END
$$;
