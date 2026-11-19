-- 0088_revertir_rol_autenticacion_de_plataforma: deshace 0088. Borra las políticas y las concesiones del rol
-- `pedernal_autenticacion_plataforma` y el rol mismo. NO toca `pedernal_autenticacion` ni ningún dato.
--
-- DESTRUCTIVA en un solo sentido: la consola deja de poder entrar con ese rol (su cadena `PEDERNAL_DB_AUTENTICACION` en Vercel
-- deja de servir). Antes de correrla, la consola tiene que haber vuelto a usar el rol de la web o estar apagada.
-- Si otra base del mismo servidor todavía usa el rol, solo se lo suelta de ESTA base y el rol se conserva (aviso); `DROP ROLE` no se fuerza.
--
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0088_revertir_rol_autenticacion_de_plataforma.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
DECLARE
  p record;
  restantes integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_autenticacion_plataforma') THEN
    FOR p IN
      SELECT schemaname, tablename, policyname FROM pg_policies
       WHERE schemaname = 'autenticacion' AND roles = ARRAY['pedernal_autenticacion_plataforma']::name[]
    LOOP
      EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    END LOOP;
    -- Quita las concesiones de ESTA base (esquema, tablas, columnas) y los privilegios de base del rol, sin CASCADE.
    EXECUTE 'DROP OWNED BY pedernal_autenticacion_plataforma';
    -- Los roles son del clúster entero: si otra base del mismo servidor todavía le da privilegios o políticas, el rol se conserva
    -- (`DROP ROLE` fallaría con «objects depend on it») y solo se avisa. Se borra únicamente cuando nadie más lo usa.
    SELECT count(*) INTO restantes
      FROM pg_shdepend d
     WHERE d.refclassid = 'pg_authid'::regclass
       AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'pedernal_autenticacion_plataforma');
    IF restantes = 0 THEN
      EXECUTE 'DROP ROLE pedernal_autenticacion_plataforma';
    ELSE
      RAISE NOTICE 'el rol pedernal_autenticacion_plataforma se conserva: otra base del servidor todavía depende de él (% objetos)', restantes;
    END IF;
  END IF;
END
$$;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (el nombre lleva el «.sql»).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0088_rol_autenticacion_de_plataforma.sql';
  END IF;
END
$$;
