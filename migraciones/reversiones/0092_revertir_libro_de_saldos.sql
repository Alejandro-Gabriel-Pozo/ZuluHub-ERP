-- 0092_revertir_libro_de_saldos: deshace 0092 (LB-3, libro de saldos por parte).
--
-- PIERDE todos los asientos, distribuciones, imputaciones y saldos; NO revertir con datos; AVISAR AL DUEÑO.
-- Se frena SIEMPRE si existe al menos un asiento (el libro es el registro del dinero: no hay confirmación que lo salte).
-- No toca ninguna tabla anterior, así que el esquema vuelve al de 0091. No usa CASCADE.
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0092_revertir_libro_de_saldos.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
DECLARE
  v_asientos bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.asiento_de_saldo') IS NOT NULL THEN
    SELECT count(*) INTO v_asientos FROM public.asiento_de_saldo;
  END IF;
  IF v_asientos > 0 THEN
    RAISE EXCEPTION 'hay % asientos en el libro de saldos: esta reversión los borraría; avisar al dueño y decidir con respaldo, fuera de esta reversión', v_asientos USING ERRCODE = '55000';
  END IF;
END
$$;

-- Hijas primero (los disparadores se van con sus tablas).
DROP TABLE IF EXISTS saldo_de_parte_por_centro_de_costo;
DROP TABLE IF EXISTS saldo_de_parte;
DROP TABLE IF EXISTS saldo_de_imputacion;
DROP TABLE IF EXISTS saldo_de_asiento;
DROP TABLE IF EXISTS imputacion_de_saldo;
DROP TABLE IF EXISTS distribucion_de_asiento;
DROP TABLE IF EXISTS asiento_de_saldo;
DROP TABLE IF EXISTS clase_de_asiento;
DROP FUNCTION IF EXISTS asiento_de_saldo_verificar_distribucion();
DROP FUNCTION IF EXISTS distribucion_de_asiento_aplicar();
DROP FUNCTION IF EXISTS imputacion_de_saldo_aplicar();
DROP FUNCTION IF EXISTS asiento_de_saldo_aplicar();
DROP FUNCTION IF EXISTS asiento_de_saldo_validar_alta();
DROP FUNCTION IF EXISTS libro_saldo_guardia();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (el nombre lleva el «.sql», como lo guarda el registro).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0092_libro_de_saldos.sql';
  END IF;
END
$$;
