-- 0108_revertir_facturar_antes_de_cobrar: deshace 0108: `documento_validar_alta()` vuelve a ser la de 0029 (el ticket tiene que estar COBRADO), con el cuerpo literal de 0029.
--
-- FRENA (55000) si existe algún documento VIGENTE sobre un ticket que no está COBRADO (una factura de un ticket emitido sin cobrar): con la función vieja esa situación sería imposible y el sistema
-- no sabría tratarla (por ejemplo, no se podría emitir un reemplazo). Hay que acreditar esas facturas (nota de crédito) o cobrar esos tickets antes, y AVISAR AL DUEÑO. Si no hay ninguna, la reversión no
-- cambia ningún dato: el disparador es de alta y no revalida filas; los documentos históricos (también los de tickets ya anulados) quedan como están. Lo único que cambia es que dejan de poder emitirse
-- facturas de tickets sin cobrar, aunque la perilla `facturar_antes_de_cobrar` de alguna empresa siga encendida (la base las rechaza con TICKET_NO_FACTURABLE: falla cerrado; apagar esa perilla es del plan).
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade
-- RLS, o el conteo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0108_revertir_facturar_antes_de_cobrar.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicar 0108. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_vigentes bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.documento_de_ticket') IS NULL OR to_regprocedure('public.documento_validar_alta()') IS NULL THEN
    RAISE EXCEPTION 'no existe documento_de_ticket o documento_validar_alta(): no hay nada que revertir' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_vigentes
    FROM public.documento_de_ticket d
    JOIN public.ticket t ON t.empresa_id = d.empresa_id AND t.id = d.ticket_id
   WHERE d.vigente AND t.estado IS DISTINCT FROM 'COBRADO';
  IF v_vigentes > 0 THEN
    RAISE EXCEPTION 'hay % documentos vigentes sobre tickets no cobrados: no se revierte; acreditarlos o cobrar esos tickets antes (y avisar al dueño)', v_vigentes USING ERRCODE = '55000';
  END IF;
END
$$;

-- La función de 0029, tal cual estaba (el disparador `documento_alta` no se toca).
CREATE OR REPLACE FUNCTION documento_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_vigente integer;
  v_numero integer;
BEGIN
  SELECT t.estado, t.ejemplar_vigente INTO v_estado, v_vigente
    FROM public.ticket t WHERE t.id = NEW.ticket_id AND t.empresa_id = NEW.empresa_id FOR SHARE;
  IF v_estado IS DISTINCT FROM 'COBRADO' THEN
    RAISE EXCEPTION 'documento_ticket_no_facturable: el ticket % no está cobrado', NEW.ticket_id
      USING ERRCODE = '23514', CONSTRAINT = 'documento_ticket_no_facturable';
  END IF;
  SELECT e.numero_de_ejemplar INTO v_numero
    FROM public.ticket_ejemplar e WHERE e.id = NEW.ejemplar_id AND e.empresa_id = NEW.empresa_id AND e.ticket_id = NEW.ticket_id;
  IF v_numero IS DISTINCT FROM v_vigente THEN
    RAISE EXCEPTION 'documento_ejemplar_no_vigente: el ejemplar % no es el vigente del ticket %', NEW.ejemplar_id, NEW.ticket_id
      USING ERRCODE = '23514', CONSTRAINT = 'documento_ejemplar_no_vigente';
  END IF;
  IF NEW.vigente IS NOT TRUE THEN
    RAISE EXCEPTION 'documento_cambio_invalido: un documento nace vigente'
      USING ERRCODE = '23514', CONSTRAINT = 'documento_cambio_invalido';
  END IF;
  RETURN NEW;
END
$$;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0108_facturar_antes_de_cobrar.sql';
  END IF;
END
$$;
