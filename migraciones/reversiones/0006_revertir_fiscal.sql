-- 0006_revertir_fiscal: deshace la migración 0006_fiscal (H7 fiscal base, tramo T3).
--
-- DESTRUCTIVA PARA LOS DATOS FISCALES: borra los emisores (el principal de cada empresa se vuelve a
-- crear solo si se vuelve a aplicar 0006), los domicilios, los datos fiscales, la regla del emisor,
-- los puntos de venta y las series de comprobantes. Hay que AVISAR AL DUEÑO antes de correrla.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql`
-- de la carpeta `migraciones/`): se corre a mano, revisado, en una sola transacción, con el rol
-- dueño de la base:
--
--     BEGIN;
--     SET LOCAL zuluhub.confirmar_reversion = 'SI';   -- solo si hay datos fiscales cargados
--     \i migraciones/reversiones/0006_revertir_fiscal.sql
--     COMMIT;
--
-- No toca nada de 0001 a 0005: quita los dos disparadores que 0006 puso sobre `empresa`, las tablas
-- nuevas (con sus disparadores, índices y políticas) en orden inverso al de creación, las funciones
-- nuevas y el registro de la migración. Si otro objeto depende de las tablas (una clave foránea de
-- una migración posterior), el DROP falla y no se pierde nada: no usa CASCADE.

DO $$
DECLARE
  v_datos bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.domicilio)
       + (SELECT count(*) FROM public.datos_fiscales)
       + (SELECT count(*) FROM public.regla_emisor)
       + (SELECT count(*) FROM public.punto_de_venta)
       + (SELECT count(*) FROM public.serie_comprobante)
       + (SELECT count(*) FROM public.emisor WHERE NOT es_principal)
    INTO v_datos;
  IF v_datos > 0 AND coalesce(current_setting('zuluhub.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de datos fiscales que esta reversión borraría: avisar al dueño y repetir con SET LOCAL zuluhub.confirmar_reversion = ''SI''', v_datos
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER empresa_validar_cuit_fiscal ON empresa;
DROP TRIGGER empresa_crear_emisor_principal ON empresa;

DROP TABLE serie_comprobante;
DROP TABLE punto_de_venta;
DROP TABLE regla_emisor;
DROP TABLE datos_fiscales;
DROP TABLE domicilio;
DROP TABLE emisor;
DROP TABLE provincia;

DROP FUNCTION serie_comprobante_validar_cambio();
DROP FUNCTION regla_emisor_validar_cambio();
DROP FUNCTION regla_emisor_validar_alta();
DROP FUNCTION datos_fiscales_validar_cambio();
DROP FUNCTION datos_fiscales_validar_alta();
DROP FUNCTION punto_de_venta_validar_cambio();
DROP FUNCTION emisor_validar_cambio();
DROP FUNCTION empresa_validar_cuit_fiscal();
DROP FUNCTION empresa_crear_emisor_principal();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0006_fiscal.sql';
  END IF;
END
$$;
