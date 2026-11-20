-- 0091_revertir_movimiento_de_dinero: deshace 0091 (PR-M1, acto «movimiento de dinero»).
--
-- PIERDE los actos cargados y deja sus cobros y egresos sin acto; no revertir con datos; AVISAR AL DUEÑO antes de revertir en una base con datos.
-- Se frena SIEMPRE (no hay confirmación que lo salte, porque la base anterior no admite ese estado) si existen:
--   · egresos manuales de un medio que no es efectivo (los dejaría en un estado que la base anterior rechaza), o
--   · anulaciones de cobros con origen `caja.movimiento_de_dinero` (la base anterior no permite anular un cobro).
-- Si solo hay actos cargados, se frena salvo `SET LOCAL pedernal.confirmar_reversion = 'SI'` (con respaldo).
-- Restituye el cuerpo anterior de `movimiento_caja_validar_alta` (el de 0027: un solo cuerpo para los AVISOS 3 y 4), y borra disparadores,
-- funciones y tabla. No usa CASCADE.
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0091_revertir_movimiento_de_dinero.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
DECLARE
  v_actos bigint := 0;
  v_egresos bigint := 0;
  v_anulaciones bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.movimiento_de_dinero') IS NOT NULL THEN
    SELECT count(*) INTO v_actos FROM public.movimiento_de_dinero;
  END IF;
  SELECT count(*) INTO v_egresos
    FROM public.movimiento_caja m JOIN public.medio_de_pago d ON d.id = m.medio_de_pago_id AND d.empresa_id = m.empresa_id
   WHERE m.clase = 'EGRESO_MANUAL' AND d.tipo <> 'EFECTIVO';
  SELECT count(*) INTO v_anulaciones
    FROM public.movimiento_caja a JOIN public.cobro c ON c.movimiento_id = a.anula_a AND c.empresa_id = a.empresa_id
   WHERE a.clase = 'ANULACION' AND c.origen_tipo = 'caja.movimiento_de_dinero';
  IF v_egresos > 0 OR v_anulaciones > 0 THEN
    RAISE EXCEPTION 'hay % egresos de un medio que no es efectivo y % anulaciones de cobros de entradas de dinero: la base anterior no los admite; no se revierte', v_egresos, v_anulaciones USING ERRCODE = '55000';
  END IF;
  IF v_actos > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % actos de movimiento de dinero que esta reversión borraría: avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_actos USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS movimiento_caja_egreso_con_acto ON movimiento_caja;
DROP TRIGGER IF EXISTS cobro_de_movimiento_de_dinero_cuadre ON cobro;

-- Cuerpo anterior (el de 0027): sin los cambios de 0091. Va antes de borrar las funciones que el cuerpo nuevo usa.
CREATE OR REPLACE FUNCTION movimiento_caja_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_sesion record;
  v_sucursal uuid;
  v_estado_de_jornada text;
  v_tipo text;
  v_original record;
  v_estado_a_corregir text;
BEGIN
  IF NEW.registrado_por IS DISTINCT FROM public.app_persona_id() THEN
    RAISE EXCEPTION 'el movimiento lo registra la persona del contexto'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_actor_invalido';
  END IF;

  -- C1. `iniciar cierre` y `cerrar` (UPDATE de la sesión) esperan a los movimientos en vuelo; el que llega después de un cierre ve la
  -- sesión EN_CIERRE/CERRADA. (Una CERRADA no pasa la política de UPDATE que usan los dos bloqueos: «no encontrada».)
  --  * Transacción SERIALIZABLE (la de la aplicación): `FOR SHARE`. Es una lectura de la sesión para el detector de anomalías
  --    serializables: contra un cierre serializable que ya calculó el esperado, uno de los dos falla con 40001 y se reintenta.
  --  * Cualquier otro aislamiento (SQL directo en READ COMMITTED): ese detector no ve a esta transacción, y `FOR SHARE` solo bloquea,
  --    no versiona la fila: el cierre serializable seguía, con su instantánea vieja, y cerraba la sesión sin contar este movimiento
  --    (hueco de dinero: arqueo 0,00 contra 100,00 cobrados). Por eso ahí se ESCRIBE la sesión (toque sin cambios, ver
  --    `sesion_caja_validar_cambio`): el cierre serializable choca con una versión posterior a su instantánea y falla con 40001 en vez de
  --    confirmar; si el cierre llegó primero, esta espera, ve la sesión cerrada y se rechaza.
  IF current_setting('transaction_isolation') = 'serializable' THEN
    SELECT s.estado, s.caja_id, s.fecha_negocio INTO v_sesion
      FROM public.sesion_caja s WHERE s.id = NEW.sesion_id AND s.empresa_id = NEW.empresa_id FOR SHARE;
  ELSE
    UPDATE public.sesion_caja s SET estado = s.estado
     WHERE s.id = NEW.sesion_id AND s.empresa_id = NEW.empresa_id AND s.estado = 'ABIERTA'
    RETURNING s.estado, s.caja_id, s.fecha_negocio INTO v_sesion;
  END IF;
  IF NOT FOUND OR v_sesion.estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'la sesión de caja no está abierta'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_sesion_no_abierta';
  END IF;
  SELECT c.sucursal_id INTO v_sucursal
    FROM public.caja c WHERE c.id = v_sesion.caja_id AND c.empresa_id = NEW.empresa_id;

  -- Un movimiento nunca entra en una sesión cuya jornada esté EN_AUDITORIA o CERRADA (e3b §5, «cobrar contra auditar»).
  SELECT j.estado INTO v_estado_de_jornada
    FROM public.jornada_de_sucursal j
   WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = v_sucursal AND j.fecha_negocio = v_sesion.fecha_negocio
     FOR SHARE;
  IF v_estado_de_jornada IS DISTINCT FROM 'ABIERTA' THEN
    RAISE EXCEPTION 'la jornada de la sesión no está abierta'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_jornada_no_abierta';
  END IF;

  IF NEW.clase = 'ANULACION' THEN
    -- Espejo exacto de un ingreso, egreso o ajuste de la MISMA sesión (la clave foránea compuesta rechaza otra sesión). Un cobro no se
    -- anula desde caja: todo cobro tiene origen (`caja-y-cobros.md` corrección 2). La desactivación posterior de un medio o una cuenta
    -- no impide anular.
    SELECT m.clase, m.medio_de_pago_id, m.cuenta_de_cobro_id, m.importe INTO v_original
      FROM public.movimiento_caja m
     WHERE m.id = NEW.anula_a AND m.empresa_id = NEW.empresa_id AND m.sesion_id = NEW.sesion_id;
    IF NOT FOUND THEN
      RETURN NEW;                                  -- lo rechaza la clave foránea `movimiento_caja_anula_fkey`
    END IF;
    IF v_original.clase = 'COBRO' THEN
      RAISE EXCEPTION 'un cobro con origen no se anula desde caja'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_anulacion_con_origen';
    END IF;
    IF v_original.clase NOT IN ('INGRESO_MANUAL', 'EGRESO_MANUAL', 'AJUSTE')
       OR NEW.medio_de_pago_id <> v_original.medio_de_pago_id
       OR NEW.cuenta_de_cobro_id IS DISTINCT FROM v_original.cuenta_de_cobro_id
       OR NEW.importe <> -v_original.importe THEN
      RAISE EXCEPTION 'la anulación tiene que ser el espejo exacto de un ingreso, egreso o ajuste'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_anulacion_invalida';
    END IF;
    RETURN NEW;
  END IF;

  -- C4. Medio activo y cuenta (si viene) activa, de la sucursal de la caja y de un tipo que el medio admite.
  v_tipo := public.par_de_cobro_validar('movimiento_caja', NEW.empresa_id, v_sucursal, NEW.medio_de_pago_id,
                                        NEW.cuenta_de_cobro_id, true);
  -- El fondo y los ingresos y egresos manuales son solo de efectivo.
  IF NEW.clase IN ('FONDO_INICIAL', 'INGRESO_MANUAL', 'EGRESO_MANUAL') AND v_tipo <> 'EFECTIVO' THEN
    RAISE EXCEPTION 'el fondo y los ingresos y egresos manuales son solo de efectivo'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_solo_efectivo';
  END IF;

  IF NEW.corrige_jornada IS NOT NULL THEN
    -- e3 §3.11.3: la jornada que se corrige existe, está CERRADA y es anterior a la de la sesión de hoy.
    SELECT j.estado INTO v_estado_a_corregir
      FROM public.jornada_de_sucursal j
     WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = v_sucursal AND j.fecha_negocio = NEW.corrige_jornada;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'la jornada a corregir no existe'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_corrige_jornada_inexistente';
    END IF;
    IF v_estado_a_corregir <> 'CERRADA' THEN
      RAISE EXCEPTION 'la jornada a corregir no está cerrada'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_corrige_jornada_no_cerrada';
    END IF;
    IF NEW.corrige_jornada >= v_sesion.fecha_negocio THEN
      RAISE EXCEPTION 'la jornada a corregir no es anterior a la de la sesión'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_corrige_jornada_no_anterior';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TABLE IF EXISTS movimiento_de_dinero;
DROP FUNCTION IF EXISTS movimiento_caja_verificar_egreso_con_acto();
DROP FUNCTION IF EXISTS movimiento_de_dinero_verificar_cuadre();
DROP FUNCTION IF EXISTS movimiento_de_dinero_validar_alta();
DROP FUNCTION IF EXISTS movimiento_de_dinero_devolvible(uuid, uuid);
DROP FUNCTION IF EXISTS movimiento_de_dinero_bloquear_entrada(uuid, uuid);

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (el nombre lleva el «.sql», como lo guarda el registro).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0091_movimiento_de_dinero.sql';
  END IF;
END
$$;
