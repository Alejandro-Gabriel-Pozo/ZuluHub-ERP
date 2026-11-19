-- 0091_revertir_datos_que_se_piden: deshace 0091 (PR-7-caja).
--
-- PIERDE qué datos pedía cada medio (`avisa_si_falta_*`) y qué cobros quedaron con datos pendientes (`cobro.datos_pendientes`): AVISAR AL DUEÑO antes de revertir en una base con datos.
-- Si hay medios con algún dato en «se pide» o cobros con datos pendientes, se frena salvo `SET LOCAL pedernal.confirmar_reversion = 'SI'` (con respaldo). Restituye el cuerpo anterior de
-- `cobro_validar_alta` (el de 0027) y borra las seis columnas (las cinco de `medio_de_pago` con su CHECK y la de `cobro`). No usa CASCADE.
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0091_revertir_datos_que_se_piden.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
DECLARE
  v_medios bigint := 0;
  v_cobros bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'medio_de_pago' AND column_name = 'avisa_si_falta_cupon') THEN
    SELECT count(*) INTO v_medios FROM public.medio_de_pago
     WHERE avisa_si_falta_cupon OR avisa_si_falta_ultimos4 OR avisa_si_falta_marca OR avisa_si_falta_cuotas OR avisa_si_falta_dni;
    SELECT count(*) INTO v_cobros FROM public.cobro WHERE cardinality(datos_pendientes) > 0;
  END IF;
  IF (v_medios > 0 OR v_cobros > 0) AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % medios con datos que se piden y % cobros con datos pendientes que esta reversión borraría: avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_medios, v_cobros USING ERRCODE = '55000';
  END IF;
END
$$;

-- Cuerpo anterior (el de 0027): sin las columnas de 0091. Va antes de borrarlas.
CREATE OR REPLACE FUNCTION cobro_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_mov record;
  v_medio record;
BEGIN
  SELECT m.clase, m.medio_de_pago_id INTO v_mov
    FROM public.movimiento_caja m WHERE m.id = NEW.movimiento_id AND m.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_mov.clase <> 'COBRO' THEN
    RAISE EXCEPTION 'la fila de cobro es de un movimiento de clase COBRO'
      USING ERRCODE = '23514', CONSTRAINT = 'cobro_clase_invalida';
  END IF;
  SELECT d.pide_cupon, d.pide_ultimos4, d.pide_marca, d.pide_cuotas, d.pide_dni INTO v_medio
    FROM public.medio_de_pago d WHERE d.id = v_mov.medio_de_pago_id AND d.empresa_id = NEW.empresa_id;
  -- Cada dato presente tiene que estar habilitado en el medio del movimiento (la pantalla no lo ofrece y el servidor no lo confía).
  IF (NEW.cupon IS NOT NULL AND NOT v_medio.pide_cupon)
     OR (NEW.ultimos4 IS NOT NULL AND NOT v_medio.pide_ultimos4)
     OR (NEW.marca_de_tarjeta_id IS NOT NULL AND NOT v_medio.pide_marca)
     OR (NEW.cuotas IS NOT NULL AND NOT v_medio.pide_cuotas)
     OR (NEW.dni IS NOT NULL AND NOT v_medio.pide_dni) THEN
    RAISE EXCEPTION 'el medio de pago no habilitó ese dato'
      USING ERRCODE = '23514', CONSTRAINT = 'cobro_dato_no_habilitado';
  END IF;
  -- La marca es de la lista de marcas y está activa al cobrar (los cobros viejos conservan la que se desactivó después).
  IF NEW.marca_de_tarjeta_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.valor_de_lista v
     WHERE v.id = NEW.marca_de_tarjeta_id AND v.lista = 'MARCAS_DE_TARJETA' AND v.activo
  ) THEN
    RAISE EXCEPTION 'la marca no es una marca de tarjeta activa'
      USING ERRCODE = '23514', CONSTRAINT = 'cobro_marca_invalida';
  END IF;
  RETURN NEW;
END
$$;
ALTER TABLE medio_de_pago DROP CONSTRAINT IF EXISTS medio_de_pago_avisa_ck;
ALTER TABLE medio_de_pago
  DROP COLUMN IF EXISTS avisa_si_falta_cupon,
  DROP COLUMN IF EXISTS avisa_si_falta_ultimos4,
  DROP COLUMN IF EXISTS avisa_si_falta_marca,
  DROP COLUMN IF EXISTS avisa_si_falta_cuotas,
  DROP COLUMN IF EXISTS avisa_si_falta_dni;
ALTER TABLE cobro DROP CONSTRAINT IF EXISTS cobro_datos_pendientes_ck;
ALTER TABLE cobro DROP COLUMN IF EXISTS datos_pendientes;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (el nombre lleva el «.sql», como lo guarda el registro).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0091_datos_que_se_piden.sql';
  END IF;
END
$$;
