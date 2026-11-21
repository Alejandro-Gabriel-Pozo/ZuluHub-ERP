-- 0063_revertir_compras_recepcion_separada: deshace 0063 (compras N3): borra `inspeccion_de_linea_de_recepcion` y `entrada_de_linea_de_recepcion`, quita
-- `recepcion.confirmada_por` y `recepcion.confirmada_en`, vuelve el estado a CONFIRMADA | ANULADA, el índice único del remito a «solo confirmadas» y el disparador
-- de transiciones al de 0037.
--
-- FRENA SIEMPRE (55000) si hay recepciones PENDIENTE: el estado dejaría de ser válido y no hay una forma automática de confirmarlas o anularlas; hay que
-- resolverlas antes (confirmar o anular cada una). DESTRUCTIVA si hay controles, entradas por línea o recepciones ya confirmadas por N3: borra esos datos y NO se
-- recupera; hay que AVISAR AL DUEÑO, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = 'SI'. Los movimientos de stock que generaron las
-- entradas NO se tocan (son del libro de stock). No usa CASCADE.
--
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base (que evade RLS):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay filas
--     \i migraciones/reversiones/0063_revertir_compras_recepcion_separada.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
DECLARE
  v_pendientes bigint := 0;
  v_filas bigint := 0;
  v_n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recepcion' AND column_name = 'confirmada_por') THEN
    SELECT count(*) INTO v_pendientes FROM public.recepcion WHERE estado = 'PENDIENTE';
    IF v_pendientes > 0 THEN
      RAISE EXCEPTION 'hay % recepciones PENDIENTE de confirmar: confirmarlas o anularlas una por una antes de revertir', v_pendientes USING ERRCODE = '55000';
    END IF;
    SELECT count(*) INTO v_n FROM public.recepcion WHERE confirmada_por IS NOT NULL;
    v_filas := v_filas + v_n;
  END IF;
  IF to_regclass('public.inspeccion_de_linea_de_recepcion') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.inspeccion_de_linea_de_recepcion;
    v_filas := v_filas + v_n;
  END IF;
  IF to_regclass('public.entrada_de_linea_de_recepcion') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.entrada_de_linea_de_recepcion;
    v_filas := v_filas + v_n;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de compras N3 que esta reversión borraría: avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TABLE IF EXISTS entrada_de_linea_de_recepcion;
DROP TABLE IF EXISTS inspeccion_de_linea_de_recepcion;
DROP FUNCTION IF EXISTS compras_entrada_de_linea_validar();
DROP FUNCTION IF EXISTS compras_inspeccion_validar();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recepcion' AND column_name = 'confirmada_por') THEN
    DROP TRIGGER recepcion_estado ON public.recepcion;
    CREATE TRIGGER recepcion_estado BEFORE UPDATE ON public.recepcion FOR EACH ROW
      EXECUTE FUNCTION public.compras_solo_cambia_estado('estado', 'anulada_por', 'anulada_en', 'motivo_de_anulacion', 'version', 'actualizado_en');
    ALTER TABLE public.recepcion DROP CONSTRAINT recepcion_confirmada_ck;
    ALTER TABLE public.recepcion DROP CONSTRAINT recepcion_confirmada_nivel_ck;
    ALTER TABLE public.recepcion DROP CONSTRAINT recepcion_pendiente_ck;
    ALTER TABLE public.recepcion DROP CONSTRAINT recepcion_confirmacion_ck;
    ALTER TABLE public.recepcion DROP CONSTRAINT recepcion_estado_ck;
    ALTER TABLE public.recepcion ADD CONSTRAINT recepcion_estado_ck CHECK (estado IN ('CONFIRMADA', 'ANULADA'));
    ALTER TABLE public.recepcion DROP COLUMN confirmada_por;
    ALTER TABLE public.recepcion DROP COLUMN confirmada_en;
    REVOKE INSERT (estado) ON public.recepcion FROM pedernal_app;
    DROP INDEX public.recepcion_remito_uk;
    CREATE UNIQUE INDEX recepcion_remito_uk ON public.recepcion (empresa_id, proveedor_id, remito_punto_de_venta, remito_numero)
      WHERE remito_numero IS NOT NULL AND estado = 'CONFIRMADA';
  END IF;
END
$$;
DROP FUNCTION IF EXISTS compras_recepcion_cambia_estado();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0063_compras_recepcion_separada.sql';
  END IF;
END
$$;
