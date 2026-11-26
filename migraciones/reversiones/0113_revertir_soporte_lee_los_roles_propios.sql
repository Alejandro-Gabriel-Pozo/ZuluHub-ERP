-- 0113_revertir_soporte_lee_los_roles_propios: deshace 0113_soporte_lee_los_roles_propios: la plataforma deja de poder leer el rol propio de una persona y las versiones de los roles propios.
--
-- No pierde datos (0113 solo agregó privilegios de lectura y políticas). Consecuencia funcional: `soporte.explicar` no puede calcular el conjunto efectivo de una persona con rol propio;
-- hay que volver también al código anterior a PR-A (si no, esa explicación falla cerrando, que es lo seguro).
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0113_revertir_soporte_lee_los_roles_propios.sql
--     COMMIT;
--
-- No usa CASCADE. No toca el registro `migracion` de otras migraciones; borra solo la fila de 0113 para poder volver a aplicarla.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rol_de_empresa' AND policyname = 'rol_de_empresa_plataforma_leer') THEN
    RAISE EXCEPTION '0113 no está aplicada (rol_de_empresa_plataforma_leer no existe)' USING ERRCODE = '55000';
  END IF;
END
$$;

DROP POLICY IF EXISTS version_de_rol_plataforma_con_actor ON version_de_rol;
DROP POLICY IF EXISTS rol_de_empresa_plataforma_con_actor ON rol_de_empresa;
DROP POLICY IF EXISTS version_de_rol_plataforma_leer ON version_de_rol;
DROP POLICY IF EXISTS rol_de_empresa_plataforma_leer ON rol_de_empresa;

REVOKE SELECT (empresa_id, rol_id, numero, acciones) ON version_de_rol FROM pedernal_plataforma;
REVOKE SELECT (id, empresa_id, activo) ON rol_de_empresa FROM pedernal_plataforma;
REVOKE SELECT (rol_propio_id) ON membresia FROM pedernal_plataforma;

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0113_soporte_lee_los_roles_propios.sql';
  END IF;
END
$$;
