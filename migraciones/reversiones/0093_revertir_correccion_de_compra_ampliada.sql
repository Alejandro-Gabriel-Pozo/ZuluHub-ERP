-- 0093_revertir_correccion_de_compra_ampliada: deshace 0093: quita `precio_por_tipo`, `unidad_de_precio_id`, `peso_real_anterior` y `peso_real_nuevo` de `correccion_de_compra`
-- (con sus CHECK y su permiso) y devuelve `correccion_de_compra_cambia_algo_ck` a «precio o cantidad».
--
-- DESTRUCTIVA si hay correcciones que usan las columnas nuevas: PIERDE el «precio por» de lo completado y el peso real de antes y de después (no se recupera). FRENA (55000) si existe alguna
-- (por ejemplo una corrección solo de peso, que además dejaría de cumplir el CHECK anterior); hay que AVISAR AL DUEÑO y, si se decide seguir, repetir con
-- SET LOCAL pedernal.confirmar_reversion = 'SI' (las correcciones que solo cambiaron el peso se vuelven a mirar a mano: ya movieron el stock). Se corre a mano, revisada, en una sola
-- transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si alguna corrección usa las columnas nuevas
--     \i migraciones/reversiones/0093_revertir_correccion_de_compra_ampliada.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.
-- La tabla es de solo inserción (disparador `correccion_solo_insercion`): la reversión no actualiza ni borra filas, solo cambia columnas y restricciones.

DO $$
DECLARE
  v_filas bigint := 0;
  v_solo_peso bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'correccion_de_compra' AND column_name = 'peso_real_nuevo'
  ) THEN
    SELECT count(*) INTO v_filas FROM public.correccion_de_compra
     WHERE precio_por_tipo IS NOT NULL OR unidad_de_precio_id IS NOT NULL OR peso_real_nuevo IS NOT NULL;
    SELECT count(*) INTO v_solo_peso FROM public.correccion_de_compra
     WHERE precio_nuevo IS NULL AND cantidad_nueva IS NULL AND peso_real_nuevo IS NOT NULL;
  END IF;
  IF v_solo_peso > 0 THEN
    RAISE EXCEPTION 'hay % correcciones que solo cambiaron el peso real: no cumplen el CHECK anterior y no se pueden conservar; resolverlas a mano antes', v_solo_peso
      USING ERRCODE = '55000';
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % correcciones con el «precio por» o el peso real que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- El permiso de INSERT de las columnas nuevas se va con ellas al quitarlas.
ALTER TABLE correccion_de_compra DROP CONSTRAINT IF EXISTS correccion_de_compra_cambia_algo_ck;
ALTER TABLE correccion_de_compra
  DROP COLUMN IF EXISTS precio_por_tipo,
  DROP COLUMN IF EXISTS unidad_de_precio_id,
  DROP COLUMN IF EXISTS peso_real_anterior,
  DROP COLUMN IF EXISTS peso_real_nuevo;
ALTER TABLE correccion_de_compra
  ADD CONSTRAINT correccion_de_compra_cambia_algo_ck CHECK (precio_nuevo IS NOT NULL OR cantidad_nueva IS NOT NULL);

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0093_correccion_de_compra_ampliada.sql';
  END IF;
END
$$;
