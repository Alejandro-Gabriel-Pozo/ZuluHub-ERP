-- 0052_revertir_tope_de_partes_de_la_division: deshace la migración 0052_tope_de_partes_de_la_division: vuelve los dos CHECK de 0038 al tope de 4 partes.
--
-- NO es destructiva (no borra ni cambia filas), pero SE FRENA con un error claro si hay alguna división con más de 4 partes o alguna parte con número mayor que 4: el rango
-- viejo las dejaría inválidas. En ese caso hay que decidir con el dueño qué hacer con esas divisiones (no se anulan acá); no hay forma de forzarla. Conviene bajar primero el
-- código que acepta más de 4 cuentas (`src/primitivas/cuentas/limites-de-division.ts`).
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño
-- de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0052_revertir_tope_de_partes_de_la_division.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_divisiones bigint := 0;
  v_partes bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.division_de_cuenta') IS NOT NULL THEN
    SELECT count(*) INTO v_divisiones FROM public.division_de_cuenta WHERE partes > 4;
  END IF;
  IF to_regclass('public.parte_de_division') IS NOT NULL THEN
    SELECT count(*) INTO v_partes FROM public.parte_de_division WHERE numero > 4;
  END IF;
  IF v_divisiones > 0 OR v_partes > 0 THEN
    RAISE EXCEPTION 'hay % divisiones con más de 4 partes (% partes con número mayor que 4): el tope viejo las dejaría inválidas; avisar al dueño, esta reversión no las toca', v_divisiones, v_partes
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE division_de_cuenta DROP CONSTRAINT IF EXISTS division_partes_ck;
ALTER TABLE division_de_cuenta ADD CONSTRAINT division_partes_ck CHECK (partes BETWEEN 2 AND 4);
ALTER TABLE parte_de_division DROP CONSTRAINT IF EXISTS parte_de_division_numero_ck;
ALTER TABLE parte_de_division ADD CONSTRAINT parte_de_division_numero_ck CHECK (numero BETWEEN 1 AND 4);

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0052_tope_de_partes_de_la_division.sql';
  END IF;
END
$$;
