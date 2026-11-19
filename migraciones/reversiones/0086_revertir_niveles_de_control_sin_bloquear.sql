-- 0086_revertir_niveles_de_control_sin_bloquear: deshace 0086 (ADR-008 opción b): vuelve a ampliar `nivel_de_control_nivel_ck` a PERMITIR / AVISAR / BLOQUEAR.
--
-- NO restituye datos: las filas que 0086 pasó de `BLOQUEAR` a `AVISAR` quedan en `AVISAR` (la migración no guardó cuáles eran). Si se necesitan de vuelta, hay que volver a cargarlas a mano con el
-- respaldo o con el `RAISE NOTICE` de la corrida de 0086 (solo informa cuántas eran). Revertir no cambia ninguna fila; solo vuelve a admitir `BLOQUEAR`. No usa CASCADE.
--
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0086_revertir_niveles_de_control_sin_bloquear.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
BEGIN
  IF to_regclass('public.nivel_de_control') IS NOT NULL THEN
    ALTER TABLE public.nivel_de_control DROP CONSTRAINT IF EXISTS nivel_de_control_nivel_ck;
    ALTER TABLE public.nivel_de_control ADD CONSTRAINT nivel_de_control_nivel_ck CHECK (nivel IN ('PERMITIR', 'AVISAR', 'BLOQUEAR'));
  END IF;
END
$$;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (el nombre lleva el «.sql», como lo guarda el registro).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0086_niveles_de_control_sin_bloquear.sql';
  END IF;
END
$$;
