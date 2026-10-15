-- 0013_revertir_permisos_minimos: deshace la migración 0013_permisos_minimos y deja los privilegios como estaban
-- después de 0012: `zuluhub_autenticacion` vuelve a poder borrar usuarios y cuentas, y `zuluhub_app` deja de poder
-- leer la tabla de control `migracion`.
--
-- NO es destructiva: no toca ninguna fila ni ningún objeto, solo privilegios. Ojo con los dos efectos:
--  * Sin la lectura de `migracion`, la guarda de la web (`MIGRACION_REQUERIDA`) falla cerrada (`42501`) y TODA la
--    aplicación responde «En mantenimiento»: conviene bajar primero ese código, o no revertir.
--  * Devuelve un permiso de más (borrar usuarios y cuentas): es el estado que la revisión de seguridad objetó.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la
-- carpeta `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0013_revertir_permisos_minimos.sql
--     COMMIT;
--
-- Antes de 0013 `zuluhub_app` no tenía NINGÚN privilegio sobre `migracion` (ninguna migración se lo daba): por eso
-- revertir es solo quitarle la columna. Se puede repetir sin que cambie nada.

REVOKE SELECT (nombre) ON migracion FROM zuluhub_app;
GRANT DELETE ON autenticacion."user", autenticacion.account TO zuluhub_autenticacion;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_permisos_minimos.sql' ESCAPE '\';
  END IF;
END
$$;
