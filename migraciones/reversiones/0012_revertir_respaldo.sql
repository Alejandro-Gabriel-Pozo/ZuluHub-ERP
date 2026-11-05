-- 0012_revertir_respaldo: deshace la migración 0012_respaldo (lo que el rol de respaldo puede hacer en ESTA base).
-- EL NÚMERO ES PROVISORIO, como el de la migración: se renumera junto con ella.
--
-- No es destructiva: no toca datos. Deja de haber un rol que pueda copiar la base entera (la copia externa diaria
-- falla desde ese momento): hay que AVISAR AL DUEÑO antes de correrla.
--
-- Este script NO lo aplica el ejecutor de migraciones: se corre a mano, revisado, en una sola transacción y con el
-- rol dueño de la base (el mismo que corrió la migración, dueño de los privilegios por defecto):
--
--     BEGIN;
--     \i migraciones/reversiones/0012_revertir_respaldo.sql
--     COMMIT;
--
-- NO borra el rol `pedernal_respaldo`: los roles son del clúster y otras bases (por ejemplo una rama restaurada)
-- pueden usarlo. Le quita todo acceso a esta base y su LOGIN; si hace falta eliminarlo, se hace a mano cuando
-- ninguna otra base lo use (`DROP OWNED BY pedernal_respaldo; DROP ROLE pedernal_respaldo;`).
--
-- Con un dueño no superusuario (Neon, PostgreSQL 16 o más) el rol de respaldo conserva la pertenencia automática del
-- creador (admin_option, sin inherit ni SET): no es un privilegio sobre los datos y la migración 0012 la tolera al
-- repetirse. `DROP ROLE` la elimina junto con el rol; no hace falta revocarla antes.

ALTER DEFAULT PRIVILEGES IN SCHEMA public, autenticacion REVOKE SELECT ON TABLES FROM pedernal_respaldo;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, autenticacion REVOKE SELECT ON SEQUENCES FROM pedernal_respaldo;
REVOKE SELECT ON ALL SEQUENCES IN SCHEMA public, autenticacion FROM pedernal_respaldo;
REVOKE SELECT ON ALL TABLES IN SCHEMA public, autenticacion FROM pedernal_respaldo;
REVOKE USAGE ON SCHEMA public, autenticacion FROM pedernal_respaldo;
ALTER ROLE pedernal_respaldo NOLOGIN;

-- La migración deja de figurar como aplicada (con el sufijo del nombre: el número es provisorio).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_respaldo.sql' ESCAPE '\';
  END IF;
END
$$;
