-- 0034_revertir_clientes: deshace 0034_clientes (parte, parte_rol, parte_vinculo y los dos vocabularios, con sus disparadores, índices y políticas; las cuatro funciones).
-- DESTRUCTIVA SI HAY FILAS: borra el directorio de partes de todas las empresas (datos personales, roles, vínculos). Se avisa al dueño y se tiene un respaldo antes.
-- La salida normal es HACIA ADELANTE: una migración nueva que corrija lo que haga falta. Este script NO lo aplica el ejecutor de migraciones: se corre a mano,
-- revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay filas
--     \i migraciones/reversiones/0034_revertir_clientes.sql
--     COMMIT;
-- Se puede repetir sin que cambie nada. No usa CASCADE: si otro objeto depende de lo que se borra (la clave foránea compuesta de compras hacia `parte`, o una extensión), el DROP falla y no se pierde nada.

DO $$
DECLARE
  v_tabla text;
  v_filas bigint;
  v_total bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  -- Con las tablas ya borradas (una repetición) no hay nada que contar.
  FOREACH v_tabla IN ARRAY ARRAY['parte', 'parte_rol', 'parte_vinculo'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas del directorio de partes que esta reversión borraría: avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TABLE IF EXISTS parte_vinculo;
DROP TABLE IF EXISTS parte_rol;
DROP TABLE IF EXISTS parte;
DROP TABLE IF EXISTS tipo_de_vinculo;
DROP TABLE IF EXISTS rol_de_parte;
DROP FUNCTION IF EXISTS parte_vinculo_validar();
DROP FUNCTION IF EXISTS parte_rol_validar();
DROP FUNCTION IF EXISTS parte_anonimizada_sin_relaciones();
DROP FUNCTION IF EXISTS parte_validar_cambio();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0034_clientes.sql';
  END IF;
END
$$;
