-- 0070_revertir_rol_de_parte_empleado: deshace 0070: quita la fila EMPLEADO de `rol_de_parte`.
--
-- FRENA (55000) si alguna parte tiene ese rol (activo o apagado: la fila de `parte_rol` queda como historia y su clave foránea no se puede dejar colgada), y
-- NO hay confirmación que lo saltee: borrar el rol dejaría a esas partes sin su rol o perdería el dato. Primero hay que decidir qué se hace con esas partes
-- (decisión del dueño). Se corre a mano, revisada, en una transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0070_revertir_rol_de_parte_empleado.sql
--     COMMIT;
--
-- `rol_de_parte` es de solo inserción: el disparador se suspende SOLO para esta fila y se vuelve a encender dentro de la misma transacción (mismo patrón que la
-- reversión de 0032); si algo falla, la transacción entera se deshace y el disparador queda como estaba. No usa CASCADE. Solo borra su propia fila del
-- registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada. Si se revierte también 0034, esta va ANTES.

DO $$
DECLARE
  v_partes bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.parte_rol') IS NOT NULL THEN
    SELECT count(*) INTO v_partes FROM public.parte_rol WHERE rol = 'EMPLEADO';
  END IF;
  IF v_partes > 0 THEN
    RAISE EXCEPTION 'hay % partes con el rol EMPLEADO: no se puede quitar el rol; avisar al dueño y decidir primero qué se hace con ellas', v_partes
      USING ERRCODE = '55000';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.rol_de_parte') IS NOT NULL THEN
    ALTER TABLE public.rol_de_parte DISABLE TRIGGER rol_de_parte_solo_insercion;
    DELETE FROM public.rol_de_parte WHERE codigo = 'EMPLEADO';
    ALTER TABLE public.rol_de_parte ENABLE TRIGGER rol_de_parte_solo_insercion;
  END IF;
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0070_rol_de_parte_empleado.sql';
  END IF;
END
$$;
