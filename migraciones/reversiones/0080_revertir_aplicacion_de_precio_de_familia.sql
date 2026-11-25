-- 0080_revertir_aplicacion_de_precio_de_familia: deshace 0080: borra `aplicacion_de_precio_de_familia`.
-- DESTRUCTIVA si hay filas: se pierde el registro de qué aplicaciones se hicieron (las claves de idempotencia: una repetición tardía de una aplicación vieja ya no se reconocería) y su
-- autor. Los PRECIOS escritos quedan (son filas de `precio_de_venta`) y la auditoría de la acción también. AVISAR AL DUEÑO si hay filas.
-- Se corre a mano, revisada, en una transacción y con el rol dueño (evade RLS): BEGIN; SET LOCAL pedernal.confirmar_reversion = 'SI'; \i este_archivo; COMMIT;
-- No usa CASCADE. Se puede repetir.
DO $$
DECLARE
  v_filas bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.aplicacion_de_precio_de_familia') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.aplicacion_de_precio_de_familia' INTO v_filas;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % aplicaciones de precio registradas que esta reversión borraría: avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;
DROP TABLE IF EXISTS aplicacion_de_precio_de_familia;
DROP FUNCTION IF EXISTS aplicacion_de_precio_de_familia_inmutable();
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0080_aplicacion_de_precio_de_familia.sql';
  END IF;
END
$$;
