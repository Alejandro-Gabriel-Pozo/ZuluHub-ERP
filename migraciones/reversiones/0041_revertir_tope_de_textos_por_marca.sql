-- 0041_revertir_tope_de_textos_por_marca: deshace 0041_tope_de_textos_por_marca (el tope de textos por marca vuelve a 500).
--
-- NO borra datos, pero FRENA si alguna versión de marca tiene más de 500 claves en su vocabulario: con el tope viejo esa fila no se podría volver a
-- guardar. Hay que recortar ese vocabulario antes (y avisar al dueño de la marca).
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola
-- transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0041_revertir_tope_de_textos_por_marca.sql
--     COMMIT;
--
-- Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_excedidas bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión se corre con el rol dueño de la base (sin él no se pueden contar los vocabularios)' USING ERRCODE = '42501';
  END IF;
  IF to_regclass('public.version_de_marca') IS NOT NULL THEN
    SELECT count(*) INTO v_excedidas
      FROM public.version_de_marca
     WHERE (SELECT count(*) FROM jsonb_object_keys(vocabulario)) > 500;
    IF v_excedidas > 0 THEN
      RAISE EXCEPTION 'hay % versiones de marca con más de 500 textos: recortar esos vocabularios antes de revertir', v_excedidas
        USING ERRCODE = '55000';
    END IF;
  END IF;
END
$$;

ALTER TABLE version_de_marca DROP CONSTRAINT IF EXISTS version_de_marca_vocabulario_ck;
ALTER TABLE version_de_marca ADD CONSTRAINT version_de_marca_vocabulario_ck CHECK (vocabulario_valido(vocabulario));
DROP FUNCTION IF EXISTS vocabulario_valido_ampliado(jsonb);

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0041_tope_de_textos_por_marca.sql';
  END IF;
END
$$;
