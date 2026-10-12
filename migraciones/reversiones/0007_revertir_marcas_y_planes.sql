-- 0007_revertir_marcas_y_planes: deshace la migración 0007_marcas_y_planes (marcas, planes y módulos
-- activados, más el tramo previo común).
--
-- DESTRUCTIVA: borra las marcas (con sus dominios y versiones), los planes (con sus versiones, las
-- asignaciones a tenants y los ajustes de perillas), los módulos activados por empresa, el nivel de cada
-- control, la hora de corte de cada sucursal, la marca de cada tenant y el registro de los intentos
-- fallidos de la vista de grupo. Hay que AVISAR AL DUEÑO antes de correrla.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la
-- carpeta `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base
-- (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL zuluhub.confirmar_reversion = 'SI';   -- solo si hay datos de marcas, planes o niveles
--     \i migraciones/reversiones/0007_revertir_marcas_y_planes.sql
--     COMMIT;
--
-- Deja el catálogo de 0001 a 0006 como estaba: quita las columnas, la restricción y la política que 0007
-- agregó a tablas viejas, restaura la política original de `auditoria_acceso_grupo`, y borra las tablas
-- nuevas (con sus disparadores, índices y políticas) en orden inverso al de creación, y las funciones
-- nuevas. No usa CASCADE: si otro objeto depende de lo que se borra (una clave foránea de una migración
-- posterior), el DROP falla y no se pierde nada.
--
-- Los intentos fallidos de la vista de grupo ('DENEGADO') NO se borran (la auditoría es de solo inserción):
-- quedan como filas de acceso sin su marca de resultado.
--
-- NO borra el rol `zuluhub_publico`: los roles son del clúster y otras bases pueden usarlo. Le quita el
-- acceso al esquema de esta base; si hace falta eliminarlo, se hace a mano cuando ninguna otra base lo use
-- (`DROP OWNED BY zuluhub_publico; DROP ROLE zuluhub_publico;`).

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

  SELECT (SELECT count(*) FROM public.marca WHERE NOT es_principal)
       + (SELECT count(*) FROM public.dominio_de_marca)
       + (SELECT count(*) FROM public.version_de_marca)
       + (SELECT count(*) FROM public.plan)
       + (SELECT count(*) FROM public.version_de_plan)
       + (SELECT count(*) FROM public.plan_de_tenant)
       + (SELECT count(*) FROM public.ajuste_de_perilla)
       + (SELECT count(*) FROM public.modulo_de_empresa)
       + (SELECT count(*) FROM public.nivel_de_control)
       + (SELECT count(*) FROM public.sucursal WHERE hora_de_corte <> time '00:00')
       + (SELECT count(*) FROM public.tenant t JOIN public.marca m ON m.id = t.marca_id WHERE NOT m.es_principal)
       + (SELECT count(*) FROM public.auditoria_acceso_grupo WHERE resultado = 'DENEGADO')
    INTO v_datos;
  IF v_datos > 0 AND coalesce(current_setting('zuluhub.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de marcas, planes, módulos, niveles de control, horas de corte o intentos fallidos que esta reversión borraría: avisar al dueño y repetir con SET LOCAL zuluhub.confirmar_reversion = ''SI''', v_datos
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Parte 1, en orden inverso al de creación.
DROP TRIGGER tenant_marca_inmutable ON tenant;
ALTER TABLE tenant DROP COLUMN marca_id;

-- La única política que mira otra tabla nueva (las versiones de plan que el tenant tiene asignadas): se quita
-- antes, o `plan_de_tenant` no se podría borrar.
DROP POLICY version_de_plan_app_leer ON version_de_plan;

DROP TABLE nivel_de_control;
DROP TABLE modulo_de_empresa;
DROP TABLE ajuste_de_perilla;
DROP TABLE plan_de_tenant;
DROP TABLE version_de_marca;
DROP TABLE version_de_plan;
DROP TABLE plan;
DROP TABLE dominio_de_marca;
DROP TABLE marca;

DROP FUNCTION tenant_validar_marca();
DROP FUNCTION ajuste_de_perilla_validar_alta();
DROP FUNCTION plan_de_tenant_validar_alta();
DROP FUNCTION version_de_marca_validar_cambio();
DROP FUNCTION version_de_marca_validar_alta();
DROP FUNCTION version_de_plan_validar_cambio();
DROP FUNCTION version_de_plan_validar_alta();
DROP FUNCTION plan_validar_cambio();
DROP FUNCTION dominio_de_marca_validar_cambio();
DROP FUNCTION dominio_de_marca_validar_alta();
DROP FUNCTION marca_validar_cambio();
DROP FUNCTION marca_validar_alta();
DROP FUNCTION version_congelada_no_se_borra();
DROP FUNCTION sin_borrado();
DROP FUNCTION claves_de_modulo_validas(text[]);
DROP FUNCTION perillas_validas(jsonb, boolean);
DROP FUNCTION vocabulario_valido(jsonb);
DROP FUNCTION tema_valido(jsonb);
DROP FUNCTION texto_visible_valido(text, integer);
DROP FUNCTION host_valido(text);

-- Parte 0: la política original de 0001 (solo un propietario activo registra su acceso) y adiós a la columna.
DROP POLICY auditoria_acceso_grupo_denegado ON auditoria_acceso_grupo;
ALTER POLICY auditoria_acceso_grupo_alta ON auditoria_acceso_grupo
  WITH CHECK (
    tenant_id = (SELECT app_tenant_id()) AND persona_id = (SELECT app_persona_id())
    AND es_propietario_activo(tenant_id)
  );
ALTER TABLE auditoria_acceso_grupo DROP COLUMN resultado;
ALTER TABLE referencia_de_error DROP CONSTRAINT referencia_de_error_referencia_uk;
ALTER TABLE sucursal DROP COLUMN hora_de_corte;

-- El rol público queda sin acceso al esquema de esta base (el rol es del clúster y no se borra).
REVOKE USAGE ON SCHEMA public FROM zuluhub_publico;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0007_marcas_y_planes.sql';
  END IF;
END
$$;
