-- 0061_revertir_permisos_configurables: deshace la migración 0061_permisos_configurables: borra las seis tablas del modelo de permisos configurables (plantillas, versiones de
-- plantilla, pisos, acciones introducidas, roles propios y sus versiones) con sus disparadores, políticas y funciones.
--
-- DESTRUCTIVA si ya hay datos propios, así que FRENA (55000) en cualquiera de estos casos, y hay que AVISAR AL DUEÑO antes de decidir qué hacer:
--   * alguna empresa tiene roles propios (se perderían los roles y su historial de versiones);
--   * la plataforma publicó una versión de plantilla después de la semilla (número mayor a 1) o cambió un piso (versión mayor a 1, un autor que no es la migración o más pisos
--     que los de la semilla): se perdería lo que decidió.
-- Con la semilla intacta no hay nada que perder: la semilla se vuelve a generar desde la constante `PERMISOS_DE_EMPRESA` (`npm run semilla:plantillas`).
-- Si una migración posterior (por ejemplo T4, que le suma a `membresia` el vínculo al rol propio) está aplicada, hay que revertirla ANTES: sus claves foráneas hacen fallar el
-- DROP y no se pierde nada. Conviene bajar primero el código que lee estas tablas (T3): sin ellas, el guard que las lee no tendría con qué decidir y cerraría todo.
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol
-- dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0061_revertir_permisos_configurables.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_roles bigint := 0;
  v_cambios bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.rol_de_empresa') IS NOT NULL THEN
    SELECT count(*) INTO v_roles FROM public.rol_de_empresa;
  END IF;
  IF v_roles > 0 THEN
    RAISE EXCEPTION 'hay % roles propios de empresas que esta reversión borraría (con su historial de versiones): avisar al dueño antes', v_roles
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.version_de_plantilla') IS NOT NULL THEN
    SELECT count(*) INTO v_cambios FROM public.version_de_plantilla WHERE numero > 1 OR autor <> 'migracion:0061';
  END IF;
  IF to_regclass('public.piso_de_plataforma') IS NOT NULL THEN
    SELECT v_cambios + count(*) INTO v_cambios FROM public.piso_de_plataforma WHERE version > 1 OR autor <> 'migracion:0061';
  END IF;
  IF v_cambios > 0 THEN
    RAISE EXCEPTION 'la plataforma cambió % plantillas o pisos después de la semilla: avisar al dueño antes de perder lo que decidió', v_cambios
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- DROP TABLE no dispara los disparadores de borrado: se sacan junto con cada tabla. Primero las que apuntan a otras.
DROP TABLE IF EXISTS version_de_rol;
DROP TABLE IF EXISTS rol_de_empresa;
DROP TABLE IF EXISTS accion_introducida;
DROP TABLE IF EXISTS piso_de_plataforma;
DROP TABLE IF EXISTS version_de_plantilla;
DROP TABLE IF EXISTS plantilla_de_rol;

DROP FUNCTION IF EXISTS version_de_rol_validar();
DROP FUNCTION IF EXISTS version_de_plantilla_validar();
DROP FUNCTION IF EXISTS rol_de_empresa_validar_cambio();
DROP FUNCTION IF EXISTS piso_de_plataforma_validar_cambio();
DROP FUNCTION IF EXISTS incumplimiento_de_pisos(text[]);
DROP FUNCTION IF EXISTS claves_de_accion_validas(text[]);
DROP FUNCTION IF EXISTS clave_de_accion_valida(text);

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0061_permisos_configurables.sql';
  END IF;
END
$$;
