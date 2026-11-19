-- 0089_revertir_politica_de_cambio_de_plan: deshace 0089 (política de cambio de plan, H-14a).
--
-- BORRA las tres tablas nuevas (`arrepentimiento_de_plan`, `condiciones_de_cambio_de_plan`, `politica_de_cambio_de_plan`) y sus dos funciones: se PIERDE lo registrado en ellas (el historial de políticas, con qué política nació cada cambio y los arrepentimientos).
-- NO toca `plan_de_tenant`: los cambios de plan y los arrepentimientos (que son cambios nuevos) quedan como están. AVISAR AL DUEÑO antes de correrla en una base con clientes.
-- No usa CASCADE. No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0089_revertir_politica_de_cambio_de_plan.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DROP TABLE IF EXISTS public.arrepentimiento_de_plan;
DROP TABLE IF EXISTS public.condiciones_de_cambio_de_plan;
DROP TABLE IF EXISTS public.politica_de_cambio_de_plan;
DROP FUNCTION IF EXISTS public.cambio_de_plan_validar_origen();
DROP FUNCTION IF EXISTS public.politica_de_cambio_de_plan_validar_alta();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (el nombre lleva el «.sql», como lo guarda el registro).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0089_politica_de_cambio_de_plan.sql';
  END IF;
END
$$;
