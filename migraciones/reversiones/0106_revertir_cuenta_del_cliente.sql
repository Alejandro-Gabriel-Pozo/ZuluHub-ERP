-- 0106_revertir_cuenta_del_cliente: deshace 0106 (CC-1, la ficha de habilitación del cliente a deber).
--
-- PIERDE todas las fichas de cuenta corriente (plazo, límite y estado de cada cliente); NO revertir con datos; AVISAR AL DUEÑO.
-- Se frena SIEMPRE si existe al menos una ficha (no hay confirmación que lo salte): decidir con respaldo, fuera de esta reversión.
-- NO revierte la siembra de las clases A_COBRAR en `clase_de_asiento`: es una tabla de solo inserción (disparador) y una clase sin asientos no hace daño;
-- si ya hay asientos de esas clases en el libro, borrarlas rompería la clave foránea. La migración 0106 se puede volver a correr después (la siembra es `ON CONFLICT DO NOTHING`).
-- No toca ninguna tabla anterior ni usa CASCADE.
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0106_revertir_cuenta_del_cliente.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
DECLARE
  v_fichas bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.cuenta_del_cliente') IS NOT NULL THEN
    SELECT count(*) INTO v_fichas FROM public.cuenta_del_cliente;
  END IF;
  IF v_fichas > 0 THEN
    RAISE EXCEPTION 'hay % fichas de cuenta corriente: esta reversión las borraría; avisar al dueño y decidir con respaldo, fuera de esta reversión', v_fichas USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TABLE IF EXISTS cuenta_del_cliente;
DROP FUNCTION IF EXISTS cuenta_del_cliente_validar();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (el nombre lleva el «.sql», como lo guarda el registro).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0106_cuenta_del_cliente.sql';
  END IF;
END
$$;
