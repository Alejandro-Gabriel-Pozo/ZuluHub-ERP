-- 0026_revertir_cierre: deshace la migración 0026_cierre (las tablas `jornada_de_sucursal` y `control_de_jornada_cerrada`, sus
-- disparadores, funciones, políticas y privilegios).
--
-- SOLO corre con las dos tablas VACÍAS (especificación E3b §3.2: «bajada manual solo con tablas vacías»): una jornada, y sobre todo la
-- foto de controles de una jornada cerrada, registran un cierre que NO se puede recomputar (lo que cada módulo vio y quién lo reconoció).
-- Si hay una sola fila en cualquiera de las dos, SE NIEGA a correr y no cambia nada; en ese caso hay que decidir con el dueño qué hacer
-- con el historial ANTES, y este script no se fuerza. Ojo con el código: el módulo `cierre` y quien lo llama (caja, desde 0027) leen
-- estas tablas; sin ellas fallan, así que conviene bajar primero ese código y la migración de caja (`0027`), que depende de esta.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0026_revertir_cierre.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0024. No usa CASCADE: si otro objeto depende de estas tablas (una clave foránea o un
-- disparador de una migración posterior), el DROP falla y no se pierde nada. Solo borra su propia fila del registro `migracion`, para
-- que la migración se pueda volver a aplicar. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_jornadas bigint := 0;
  v_controles bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con las tablas ya borradas (una repetición) no hay nada que contar.
  IF to_regclass('public.jornada_de_sucursal') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.jornada_de_sucursal' INTO v_jornadas;
  END IF;
  IF to_regclass('public.control_de_jornada_cerrada') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.control_de_jornada_cerrada' INTO v_controles;
  END IF;
  IF v_jornadas + v_controles > 0 THEN
    RAISE EXCEPTION 'hay % jornadas y % controles guardados: la reversión solo corre con las tablas vacías (avisar al dueño; el historial de cierres no se recupera)', v_jornadas, v_controles
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores, las políticas y los privilegios caen con las tablas.
DROP TABLE IF EXISTS control_de_jornada_cerrada;
DROP TABLE IF EXISTS jornada_de_sucursal;
DROP FUNCTION IF EXISTS control_de_jornada_validar_alta();
DROP FUNCTION IF EXISTS jornada_no_se_borra();
DROP FUNCTION IF EXISTS jornada_validar_cambio();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_cierre.sql' ESCAPE '\';
  END IF;
END
$$;
