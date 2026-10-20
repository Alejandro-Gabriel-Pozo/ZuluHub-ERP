-- 0009_revertir_facturacion: deshace la migración 0009_facturacion (el comprobante fiscal, sus renglones y su
-- desglose, los certificados de ARCA, el ticket de acceso, los intentos y el ambiente de la serie).
--
-- DESTRUCTIVA PARA TODO LO FACTURADO: borra los comprobantes (autorizados por ARCA, con su CAE), sus renglones y
-- su desglose, los intentos contra ARCA (la única evidencia de un CAE si el cierre falló), los certificados de ARCA
-- con la clave privada cifrada y el ticket de acceso; y quita el ambiente de las series y de los puntos de venta
-- (los de producción vuelven a ser puntos de venta sin ambiente). Un comprobante autorizado es un hecho fiscal ante
-- ARCA que esta base no puede recrear: hay que AVISAR AL DUEÑO y tener un respaldo (rama de Neon `antes-de-0009`)
-- antes de correrla. La salida normal es HACIA ADELANTE: una migración nueva que corrija lo que haga falta.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta
-- `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS,
-- o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay datos de facturación o series de producción
--     \i migraciones/reversiones/0009_revertir_facturacion.sql
--     COMMIT;
--
-- Deja el catálogo de 0001 a 0008 como estaba: quita los tres disparadores que 0009 puso sobre `serie_comprobante` y
-- `punto_de_venta`, las tablas nuevas (con sus disparadores, índices y políticas), las funciones nuevas, el ambiente
-- de la serie y del punto de venta, la clave primaria de la serie con su forma de 0006, la única que 0009 agregó a
-- `datos_fiscales`, y devuelve `serie_comprobante_validar_cambio` a su versión de 0006 (sin la salida de BLOQUEADA).
-- No usa CASCADE: si otro objeto depende de lo que se borra (una clave foránea de una migración posterior), el DROP
-- falla y no se pierde nada.
--
-- NO se puede revertir si algún punto de venta tiene series de los dos ambientes para el mismo tipo: la clave de
-- 0006 no las distingue. Hay que resolverlo a mano (qué serie se queda), y por eso el script frena antes de borrar.

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

  IF EXISTS (
    SELECT 1 FROM public.serie_comprobante
     GROUP BY empresa_id, punto_de_venta_id, tipo_comprobante
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'hay puntos de venta con series de los dos ambientes para un mismo tipo: la clave de 0006 no las distingue; resolverlo a mano antes de revertir'
      USING ERRCODE = '55000';
  END IF;

  SELECT (SELECT count(*) FROM public.comprobante)
       + (SELECT count(*) FROM public.comprobante_linea)
       + (SELECT count(*) FROM public.comprobante_alicuota)
       + (SELECT count(*) FROM public.intento_arca)
       + (SELECT count(*) FROM public.certificado_arca)
       + (SELECT count(*) FROM public.acceso_arca)
       + (SELECT count(*) FROM public.serie_comprobante WHERE ambiente = 'PRODUCCION')
       + (SELECT count(*) FROM public.punto_de_venta WHERE ambiente = 'PRODUCCION')
    INTO v_datos;
  IF v_datos > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de facturación o de producción que esta reversión borraría (comprobantes autorizados, certificados, intentos): avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_datos
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores sobre las tablas viejas, antes que las funciones que llaman y que las tablas que miran.
DROP TRIGGER serie_comprobante_con_reserva ON serie_comprobante;
DROP TRIGGER serie_comprobante_alta ON serie_comprobante;
DROP TRIGGER punto_de_venta_ambiente ON punto_de_venta;

-- Las tablas nuevas, de las hijas a la madre (con sus disparadores, índices y políticas).
DROP TABLE acceso_arca;
DROP TABLE certificado_arca;
DROP TABLE intento_arca;
DROP TABLE comprobante_alicuota;
DROP TABLE comprobante_linea;
DROP TABLE comprobante;

-- Lo que 0009 cambió en las tablas de 0006.
ALTER TABLE datos_fiscales DROP CONSTRAINT datos_fiscales_id_empresa_emisor_uk;
ALTER TABLE serie_comprobante DROP CONSTRAINT serie_pkey,
  ADD CONSTRAINT serie_pkey PRIMARY KEY (empresa_id, punto_de_venta_id, tipo_comprobante);
ALTER TABLE serie_comprobante DROP COLUMN ambiente;
ALTER TABLE punto_de_venta DROP COLUMN ambiente;

-- La función de la serie vuelve a ser la de 0006 (exactamente: un test compara el catálogo).
CREATE OR REPLACE FUNCTION serie_comprobante_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.punto_de_venta_id IS DISTINCT FROM OLD.punto_de_venta_id
     OR NEW.emisor_id IS DISTINCT FROM OLD.emisor_id
     OR NEW.tipo_comprobante IS DISTINCT FROM OLD.tipo_comprobante
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'la identidad de una serie no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'serie_inmutable';
  END IF;

  -- El último número nunca baja, y solo sube de a uno cerrando la EN_CURSO que lo reservó.
  IF NEW.ultimo_numero < OLD.ultimo_numero THEN
    RAISE EXCEPTION 'el último número de una serie no baja'
      USING ERRCODE = '23514', CONSTRAINT = 'serie_numero_invalido';
  ELSIF NEW.ultimo_numero > OLD.ultimo_numero
        AND NOT (OLD.estado = 'EN_CURSO' AND NEW.estado = 'LIBRE' AND NEW.ultimo_numero = OLD.numero_en_curso)
  THEN
    RAISE EXCEPTION 'el último número solo sube de a uno, al cerrar la reserva de ese número'
      USING ERRCODE = '23514', CONSTRAINT = 'serie_numero_invalido';
  END IF;

  IF NEW.estado <> OLD.estado THEN
    IF NOT (
      (OLD.estado = 'LIBRE' AND NEW.estado = 'EN_CURSO')
      OR (OLD.estado = 'EN_CURSO' AND NEW.estado IN ('LIBRE', 'BLOQUEADA'))
    ) THEN
      RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
        USING ERRCODE = '23514', CONSTRAINT = 'serie_transicion_invalida';
    END IF;
    IF OLD.estado = 'LIBRE' THEN
      PERFORM pg_advisory_xact_lock_shared(hashtextextended('pedernal.fiscal.emisor:' || OLD.emisor_id::text, 0));
    END IF;
  ELSIF OLD.estado = 'EN_CURSO' THEN
    -- Una reserva incierta sigue EN_CURSO sin cambios.
    IF NEW.numero_en_curso IS DISTINCT FROM OLD.numero_en_curso
       OR NEW.solicitud_en_curso IS DISTINCT FROM OLD.solicitud_en_curso
       OR NEW.en_curso_hasta IS DISTINCT FROM OLD.en_curso_hasta
    THEN
      RAISE EXCEPTION 'una serie EN_CURSO no cambia su reserva'
        USING ERRCODE = '23514', CONSTRAINT = 'serie_transicion_invalida';
    END IF;
  ELSIF OLD.estado = 'BLOQUEADA' THEN
    IF NEW.motivo_bloqueo IS DISTINCT FROM OLD.motivo_bloqueo THEN
      RAISE EXCEPTION 'una serie BLOQUEADA no sale de ese estado ni cambia su motivo'
        USING ERRCODE = '23514', CONSTRAINT = 'serie_transicion_invalida';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP FUNCTION certificado_arca_validar_cambio();
DROP FUNCTION certificado_arca_validar_alta();
DROP FUNCTION comprobante_hijo_validar_alta();
DROP FUNCTION comprobante_verificar_cuadre();
DROP FUNCTION comprobante_serie_con_reserva();
DROP FUNCTION comprobante_verificar_serie();
DROP FUNCTION comprobante_validar_cambio();
DROP FUNCTION comprobante_validar_alta();
DROP FUNCTION punto_de_venta_validar_ambiente();
DROP FUNCTION serie_comprobante_validar_alta();
DROP FUNCTION texto_fiscal_valido(text, integer);

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0009_facturacion.sql';
  END IF;
END
$$;
