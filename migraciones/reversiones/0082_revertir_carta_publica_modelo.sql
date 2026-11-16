-- 0082_revertir_carta_publica_modelo: deshace 0082: quita `carta_publica.modelo` (y sus permisos y su CHECK).
--
-- FRENA (55000) si hay cartas con `modelo = 'LIBRO'`: sin la columna volverían a verse como Lista sin que nadie lo decida. AVISAR AL DUEÑO antes y, si se decide seguir, repetir con
-- SET LOCAL pedernal.confirmar_reversion = 'SI'. Se corre a mano, revisada, en una transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay cartas en Libro
--     \i migraciones/reversiones/0082_revertir_carta_publica_modelo.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_filas bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'carta_publica' AND column_name = 'modelo'
  ) THEN
    SELECT count(*) INTO v_filas FROM public.carta_publica WHERE modelo <> 'LISTA';
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % cartas en un modelo distinto de Lista que volverían a verse como Lista: avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE carta_publica DROP COLUMN IF EXISTS modelo;

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0082_carta_publica_modelo.sql';
  END IF;
END
$$;
