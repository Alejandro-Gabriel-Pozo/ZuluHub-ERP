-- 0081_revertir_orden_y_destacado_de_la_carta: deshace 0081: borra `lugar_en_carta_de_producto` y las columnas `orden`/`destacada` de `familia_de_producto` y
-- `orden_de_renglones`/`version_del_orden` de `seccion_de_carta`.
-- DESTRUCTIVA si hay datos: se pierde el orden a mano y las estrellas cargadas (la carta vuelve al orden alfabético sin estrellas). Los productos, secciones y familias NO se borran.
-- AVISAR AL DUEÑO si hay datos. Se corre a mano, revisada, en una transacción y con el rol dueño (evade RLS):
--     BEGIN; SET LOCAL pedernal.confirmar_reversion = 'SI'; \i este_archivo; COMMIT;
-- No usa CASCADE. Se puede repetir.
DO $$
DECLARE
  v_total bigint := 0;
  v_n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.lugar_en_carta_de_producto') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.lugar_en_carta_de_producto' INTO v_n;
    v_total := v_total + v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'familia_de_producto' AND column_name = 'destacada') THEN
    EXECUTE 'SELECT count(*) FROM public.familia_de_producto WHERE destacada OR orden <> 0' INTO v_n;
    v_total := v_total + v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'seccion_de_carta' AND column_name = 'orden_de_renglones') THEN
    EXECUTE 'SELECT count(*) FROM public.seccion_de_carta WHERE orden_de_renglones <> ''ALFABETICO''' INTO v_n;
    v_total := v_total + v_n;
  END IF;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % ordenes o estrellas cargados que esta reversión borraría: avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;
DROP TABLE IF EXISTS lugar_en_carta_de_producto;
DROP FUNCTION IF EXISTS lugar_en_carta_de_producto_validar();
DROP TRIGGER IF EXISTS seccion_de_carta_orden ON seccion_de_carta;
DROP FUNCTION IF EXISTS seccion_de_carta_orden_validar();
ALTER TABLE seccion_de_carta DROP COLUMN IF EXISTS orden_de_renglones, DROP COLUMN IF EXISTS version_del_orden;
ALTER TABLE familia_de_producto DROP COLUMN IF EXISTS orden, DROP COLUMN IF EXISTS destacada;
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0081_orden_y_destacado_de_la_carta.sql';
  END IF;
END
$$;
