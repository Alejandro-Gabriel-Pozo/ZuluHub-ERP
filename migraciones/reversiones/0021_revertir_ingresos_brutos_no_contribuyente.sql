-- 0021_revertir_ingresos_brutos_no_contribuyente: deshace la migración 0021_ingresos_brutos_no_contribuyente (las restricciones
-- `datos_fiscales_iibb_eleccion_ck` y `comprobante_emisor_iibb_eleccion_ck`, y el valor `NO_CONTRIBUYENTE` de los dos CHECK de
-- condición, que vuelven a admitir solo LOCAL, CONVENIO_MULTILATERAL y EXENTO, como en 0006 y 0009).
--
-- NO borra ni cambia ningún dato: si ya hay un `NO_CONTRIBUYENTE` guardado en una versión de datos fiscales o en un comprobante, SE
-- NIEGA a correr (volver atrás dejaría una fila inválida, y un comprobante emitido no se corrige). En ese caso hay que decidir con el
-- dueño qué hacer con esas filas ANTES; no se arreglan con este script. Ojo con el código: si el código nuevo está desplegado, volver
-- a un CHECK que no admite el valor rompe confirmar y emitir; conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0021_revertir_ingresos_brutos_no_contribuyente.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0019 (la 0020 está reservada y no existe en esta rama). Solo borra su propia fila del
-- registro `migracion`, para que la migración se pueda volver a aplicar. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_datos bigint;
  v_comprobantes bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_datos FROM public.datos_fiscales WHERE iibb_condicion = 'NO_CONTRIBUYENTE';
  SELECT count(*) INTO v_comprobantes FROM public.comprobante WHERE emisor_iibb_condicion = 'NO_CONTRIBUYENTE';
  IF v_datos > 0 OR v_comprobantes > 0 THEN
    RAISE EXCEPTION 'hay % versiones de datos fiscales y % comprobantes con IIBB «No contribuyente»: no se revierte (decidir con el dueño qué hacer con ellos antes)',
      v_datos, v_comprobantes USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE public.datos_fiscales
  DROP CONSTRAINT IF EXISTS datos_fiscales_iibb_eleccion_ck,
  DROP CONSTRAINT IF EXISTS datos_fiscales_iibb_condicion_ck,
  ADD CONSTRAINT datos_fiscales_iibb_condicion_ck CHECK (iibb_condicion IN ('LOCAL', 'CONVENIO_MULTILATERAL', 'EXENTO'));

ALTER TABLE public.comprobante
  DROP CONSTRAINT IF EXISTS comprobante_emisor_iibb_eleccion_ck,
  DROP CONSTRAINT IF EXISTS comprobante_emisor_iibb_condicion_ck,
  ADD CONSTRAINT comprobante_emisor_iibb_condicion_ck CHECK (
    emisor_iibb_condicion IS NULL OR emisor_iibb_condicion IN ('LOCAL', 'CONVENIO_MULTILATERAL', 'EXENTO'));

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_ingresos_brutos_no_contribuyente.sql' ESCAPE '\';
  END IF;
END
$$;
