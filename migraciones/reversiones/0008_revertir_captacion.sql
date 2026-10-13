-- 0008_revertir_captacion: deshace la migración 0008_captacion (la solicitud de alta, los contadores del
-- abuso y lo que el rol de la landing podía hacer sobre `trabajo` y `auditoria_plataforma`).
-- EL NÚMERO ES PROVISORIO, como el de la migración: se renumera junto con ella.
--
-- DESTRUCTIVA: borra la tabla de solicitudes (datos personales de interesados: correo, nombre, negocio,
-- teléfono, CUIT, con su consentimiento y su historia de estados) y los contadores del abuso. Hay que AVISAR
-- AL DUEÑO y tener un respaldo antes de correrla (rama de Neon `antes-de-NNNN`). La salida normal es HACIA
-- ADELANTE: una migración nueva que corrija lo que haga falta.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la
-- carpeta `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base
-- (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL zuluhub.confirmar_reversion = 'SI';   -- solo si hay solicitudes o contadores
--     \i migraciones/reversiones/0008_revertir_captacion.sql
--     COMMIT;
--
-- Deja el catálogo de 0001 a 0007 como estaba: quita las políticas de la landing sobre `trabajo` y
-- `auditoria_plataforma`, las concesiones que 0008 hizo sobre objetos viejos, las tablas nuevas (con sus
-- disparadores, índices y políticas) y las funciones nuevas. No usa CASCADE: si otro objeto depende de lo que
-- se borra (una clave foránea de una migración posterior), el DROP falla y no se pierde nada.
--
-- NO borra lo que la auditoría y la cola ya registraron (son de solo inserción o no son de esta migración):
-- las constancias `SOLICITUD_*` quedan en `auditoria_plataforma` y los trabajos `*_de_solicitud` en `trabajo`
-- (un trabajo pendiente fallará al no encontrar su solicitud). NO borra el rol `zuluhub_captacion`: los roles
-- son del clúster y otras bases pueden usarlo. Le quita todo acceso a esta base; si hace falta eliminarlo, se
-- hace a mano cuando ninguna otra base lo use (`DROP OWNED BY zuluhub_captacion; DROP ROLE zuluhub_captacion;`).

DO $$
DECLARE
  v_datos bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  SELECT (SELECT count(*) FROM public.solicitud_de_alta)
       + (SELECT count(*) FROM public.limite_de_captacion)
    INTO v_datos;
  IF v_datos > 0 AND coalesce(current_setting('zuluhub.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de solicitudes o de contadores que esta reversión borraría (datos personales de interesados): avisar al dueño, tener un respaldo y repetir con SET LOCAL zuluhub.confirmar_reversion = ''SI''', v_datos
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Las políticas que miran la tabla de solicitudes, antes que la tabla (si no, el DROP TABLE fallaría).
DROP POLICY trabajo_captacion_verificacion ON trabajo;
DROP POLICY trabajo_captacion_aviso ON trabajo;
DROP POLICY trabajo_captacion_evento ON trabajo;
DROP POLICY auditoria_plataforma_captacion ON auditoria_plataforma;
DROP INDEX auditoria_plataforma_captacion_uk;

-- Lo que 0008 le concedió a la landing sobre objetos de antes.
REVOKE INSERT (empresa_id, tipo, datos, clave_idempotencia) ON trabajo FROM zuluhub_captacion;
REVOKE INSERT (actor, accion, entidad, entidad_id, antes, despues) ON auditoria_plataforma FROM zuluhub_captacion;
REVOKE EXECUTE ON FUNCTION contexto_firmado(), cuit_valido(text) FROM zuluhub_captacion;

-- Las dos tablas nuevas, con sus disparadores, índices, políticas y privilegios.
DROP TABLE limite_de_captacion;
DROP TABLE solicitud_de_alta;

DROP FUNCTION limite_validar_cambio();
DROP FUNCTION solicitud_validar_cambio();
DROP FUNCTION datos_de_auditoria_de_captacion_validos(jsonb);
DROP FUNCTION atribucion_valida(jsonb);
DROP FUNCTION app_captacion();

-- El rol de la landing queda sin acceso al esquema de esta base (el rol es del clúster y no se borra).
REVOKE USAGE ON SCHEMA public FROM zuluhub_captacion;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_captacion.sql' ESCAPE '\';
  END IF;
END
$$;
