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
-- NO borra el rol `zuluhub_respaldo`: los roles son del clúster y otras bases (por ejemplo una rama restaurada)
-- pueden usarlo. Le quita todo acceso a esta base y su LOGIN; si hace falta eliminarlo, se hace a mano cuando
-- ninguna otra base lo use (`DROP OWNED BY zuluhub_respaldo; DROP ROLE zuluhub_respaldo;`).

ALTER DEFAULT PRIVILEGES IN SCHEMA public, autenticacion REVOKE SELECT ON TABLES FROM zuluhub_respaldo;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, autenticacion REVOKE SELECT ON SEQUENCES FROM zuluhub_respaldo;
REVOKE SELECT ON ALL SEQUENCES IN SCHEMA public, autenticacion FROM zuluhub_respaldo;
REVOKE SELECT ON ALL TABLES IN SCHEMA public, autenticacion FROM zuluhub_respaldo;
REVOKE USAGE ON SCHEMA public, autenticacion FROM zuluhub_respaldo;
ALTER ROLE zuluhub_respaldo NOLOGIN;

-- La migración deja de figurar como aplicada (con el sufijo del nombre: el número es provisorio).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_respaldo.sql' ESCAPE '\';
  END IF;
END
$$;
