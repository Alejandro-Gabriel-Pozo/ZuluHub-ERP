-- 0024_revertir_pasaporte_con_letras: deshace la migración 0024_pasaporte_con_letras (el CHECK `comprobante_receptor_documento_ck`
-- vuelve a la forma de 0009: el documento del receptor son solo dígitos, de 1 a 11, y el CUIT/CUIL/CDI con su verificador).
--
-- NO borra ni cambia ningún dato: si ya hay un pasaporte con letras guardado, SE NIEGA a correr (volver atrás dejaría una fila inválida
-- y un comprobante emitido es inmutable: no se puede corregir ni convertir sin inventar el número). En ese caso hay que decidir con el
-- dueño qué hacer con esos comprobantes ANTES; no se arreglan con este script. Ojo con el código: si el código nuevo está desplegado,
-- volver a un CHECK que no admite letras rompe emitir a un turista con pasaporte con letras; conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0024_revertir_pasaporte_con_letras.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0023. Solo borra su propia fila del registro `migracion`, para que la migración se pueda
-- volver a aplicar. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_con_letras bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_con_letras
    FROM public.comprobante
   WHERE receptor_documento_numero IS NOT NULL AND receptor_documento_numero !~ '^[0-9]{1,11}$';
  IF v_con_letras > 0 THEN
    RAISE EXCEPTION 'hay % comprobantes con un documento del receptor que no es solo dígitos (pasaporte con letras): no se revierte (decidir con el dueño qué hacer con ellos antes)',
      v_con_letras USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE public.comprobante
  DROP CONSTRAINT IF EXISTS comprobante_receptor_documento_ck,
  ADD CONSTRAINT comprobante_receptor_documento_ck CHECK (
    receptor_documento_numero IS NULL
    OR (receptor_documento_numero ~ '^[0-9]{1,11}$'
        AND (receptor_documento_tipo NOT IN ('CUIT', 'CUIL', 'CDI') OR cuit_valido(receptor_documento_numero))));

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_pasaporte_con_letras.sql' ESCAPE '\';
  END IF;
END
$$;
