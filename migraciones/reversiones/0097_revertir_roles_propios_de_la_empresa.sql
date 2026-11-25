-- 0097_revertir_roles_propios_de_la_empresa: deshace la migración 0097_roles_propios_de_la_empresa: saca de `membresia` el vínculo al rol propio y deja el disparador de cambio de rol
-- como estaba en 0005 (el rol cambia solo por un traspaso de gerencia aceptado en la misma transacción).
--
-- FRENA (55000) si alguna membresía tiene un rol propio (PROPIO): volverla a un rol base cambia lo que esa persona puede hacer, y eso lo decide el dueño: AVISARLE antes.
-- También FRENA si la plataforma cambió alguno de los cinco pisos que la migración sembró (se perdería lo que decidió).
-- Los roles propios que existan (rol_de_empresa) y sus versiones NO se borran (son de 0094); quedan sin personas. Para revertir también 0094, correr antes esta.
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol
-- dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0097_revertir_roles_propios_de_la_empresa.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla.

DO $$
DECLARE
  v_propios bigint := 0;
  v_cambios bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'membresia' AND column_name = 'rol_propio_id') THEN
    RAISE EXCEPTION '0097 no está aplicada (membresia.rol_propio_id no existe)' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_propios FROM public.membresia WHERE rol = 'PROPIO' OR rol_propio_id IS NOT NULL;
  IF v_propios > 0 THEN
    RAISE EXCEPTION 'hay % membresías con un rol propio: volverlas a un rol base cambia lo que pueden hacer; avisar al dueño antes', v_propios
      USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_cambios FROM public.piso_de_plataforma
   WHERE accion IN ('roles.ver', 'roles.crear', 'roles.editar', 'roles.archivar', 'usuarios.asignar_rol')
     AND (version > 1 OR autor <> 'migracion:0097' OR tipo <> 'SOLO_GERENTE');
  IF v_cambios > 0 THEN
    RAISE EXCEPTION 'la plataforma cambió % de los pisos que sembró 0097: avisar al dueño antes de perder lo que decidió', v_cambios
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS rol_de_empresa_archivado ON rol_de_empresa;
DROP FUNCTION IF EXISTS rol_de_empresa_validar_archivado();
DROP POLICY IF EXISTS membresia_app_asignar_rol ON membresia;

ALTER TABLE membresia DROP CONSTRAINT membresia_rol_propio_fkey;
ALTER TABLE membresia DROP CONSTRAINT membresia_rol_propio_ck;
DROP INDEX IF EXISTS membresia_rol_propio_ix;
ALTER TABLE membresia DROP COLUMN rol_propio_id;
ALTER TABLE membresia DROP CONSTRAINT membresia_rol_ck;
ALTER TABLE membresia ADD CONSTRAINT membresia_rol_ck CHECK (rol IN ('GERENTE', 'ADMINISTRADOR', 'OPERADOR'));

-- El disparador de 0005, tal cual estaba.
CREATE OR REPLACE FUNCTION membresia_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF OLD.rol = 'GERENTE' AND OLD.activo AND NOT NEW.activo THEN
    RAISE EXCEPTION 'el gerente no se apaga: se traspasa'
      USING ERRCODE = '23514', CONSTRAINT = 'membresia_gerente_no_se_apaga';
  END IF;

  IF NEW.rol IS DISTINCT FROM OLD.rol THEN
    IF NOT (OLD.activo AND NEW.activo) OR NOT EXISTS (
      SELECT 1 FROM public.traspaso_gerencia t
       WHERE t.empresa_id = OLD.empresa_id
         AND t.estado = 'ACEPTADO'
         AND t.xmin = pg_current_xact_id()::xid
         AND (
           (OLD.rol = 'GERENTE' AND NEW.rol = 'ADMINISTRADOR' AND t.saliente_persona_id = OLD.persona_id)
           OR (NEW.rol = 'GERENTE' AND t.entrante_persona_id = OLD.persona_id)
         )
    ) THEN
      RAISE EXCEPTION 'el rol de una membresía solo cambia al aceptar un traspaso de gerencia'
        USING ERRCODE = '23514', CONSTRAINT = 'membresia_rol_sin_traspaso';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Los pisos no se borran (disparador `sin_borrado`): acá se apaga ese disparador SOLO para sacar las cinco filas que esta migración sembró, y se vuelve a encender.
ALTER TABLE piso_de_plataforma DISABLE TRIGGER piso_de_plataforma_sin_borrado;
DELETE FROM piso_de_plataforma
 WHERE accion IN ('roles.ver', 'roles.crear', 'roles.editar', 'roles.archivar', 'usuarios.asignar_rol') AND autor = 'migracion:0097';
ALTER TABLE piso_de_plataforma ENABLE TRIGGER piso_de_plataforma_sin_borrado;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0097_roles_propios_de_la_empresa.sql';
  END IF;
END
$$;
