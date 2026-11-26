-- 0105_revertir_anonimizacion_de_partes: deshace la migración 0105_anonimizacion_de_partes: deja el disparador diferido `parte_anonimizada_sin_relaciones` como estaba en 0034 (sin la
-- exigencia del cargo) y saca el piso SOLO_GERENTE de `partes.anonimizar` que sembró.
--
-- NO borra ni cambia ninguna parte, rol, vínculo ni auditoría: una parte que ya se anonimizó con la migración puesta sigue anonimizada (es terminal, ni el dueño de la base la edita).
-- FRENA (55000) si la plataforma cambió el piso que sembró 0105 (se perdería lo que decidió). Si el piso lo sembró la semilla de 0094 (una base nueva, que corre 0094 ya con la acción), no es de esta migración y no se toca: avisar al dueño antes. Si el código que usa `partes.anonimizar` sigue desplegado, el
-- piso no debería quitarse: revertir primero el código (sin el piso, esa acción quedaría delegable a un rol propio).
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de
-- la base (que evade RLS):
--
--     BEGIN;
--     \i migraciones/reversiones/0105_revertir_anonimizacion_de_partes.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_cambios bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.piso_de_plataforma') IS NULL THEN
    RAISE EXCEPTION '0094 no está aplicada (piso_de_plataforma no existe)' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_cambios FROM public.piso_de_plataforma
   WHERE accion = 'partes.anonimizar' AND autor = 'migracion:0105' AND (version > 1 OR tipo <> 'SOLO_GERENTE');
  IF v_cambios > 0 THEN
    RAISE EXCEPTION 'la plataforma cambió el piso que sembró 0105: avisar al dueño antes de perder lo que decidió'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- El disparador de 0034, tal cual estaba.
CREATE OR REPLACE FUNCTION parte_anonimizada_sin_relaciones() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF EXISTS (SELECT 1 FROM public.parte_rol r WHERE r.empresa_id = NEW.empresa_id AND r.parte_id = NEW.id AND r.activo)
     OR EXISTS (SELECT 1 FROM public.parte_vinculo v WHERE v.empresa_id = NEW.empresa_id AND v.activo
                  AND (v.parte_id = NEW.id OR v.de_parte_id = NEW.id)) THEN
    RAISE EXCEPTION 'una parte anonimizada no puede conservar roles ni vínculos activos'
      USING ERRCODE = '23514', CONSTRAINT = 'parte_anonimizada_con_relaciones';
  END IF;
  RETURN NULL;
END
$$;

-- Los pisos no se borran (disparador `sin_borrado`): acá se apaga ese disparador SOLO para sacar la fila que esta migración sembró, y se vuelve a encender.
ALTER TABLE piso_de_plataforma DISABLE TRIGGER piso_de_plataforma_sin_borrado;
DELETE FROM piso_de_plataforma WHERE accion = 'partes.anonimizar' AND autor = 'migracion:0105';
ALTER TABLE piso_de_plataforma ENABLE TRIGGER piso_de_plataforma_sin_borrado;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0105_anonimizacion_de_partes.sql';
  END IF;
END
$$;
