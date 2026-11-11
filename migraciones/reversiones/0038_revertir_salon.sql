-- 0038_revertir_salon: deshace la migración 0038_salon (las tablas del salón y de las comandas: mesa, mesa_celda, union_de_mesas, linea_unida,
-- division_de_cuenta, parte_de_division, contador_de_envios, envio_de_comanda, renglon_de_envio, linea_de_comanda, aviso_de_anulacion, impresora,
-- trabajo_de_impresion, intento_de_impresion y linea_copiada; la columna `linea_cuenta.importe_fijo`; el ancla móvil de la cuenta).
--
-- DESTRUCTIVA si hay datos: BORRA las mesas, los envíos a cocina con su número, los avisos de anulación, las impresiones, las uniones y las
-- divisiones, y eso NO SE RECUPERA (los envíos son el registro de qué se pidió a cocina y a qué hora; las uniones y divisiones, de dónde vino cada
-- ítem de un ticket). Con cuentas divididas o ítems compartidos, además, las líneas con `importe_fijo` pierden su importe y el total de la cuenta
-- deja de cuadrar. Hay que AVISAR AL DUEÑO antes de correrla si hay alguna fila. Ojo con el código: los módulos `salon` y `comandas` leen estas tablas
-- y ventas lee `importe_fijo` al calcular un ticket; conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún dato de salón o comandas cargado
--     \i migraciones/reversiones/0038_revertir_salon.sql
--     COMMIT;
--
-- Deja ventas como estaba después de 0036 (las tres funciones vuelven a su cuerpo anterior). No usa CASCADE: si otro objeto depende de una tabla,
-- el DROP falla y no se pierde nada. Solo borra su propia fila del registro `migracion`, para que la migración se pueda volver a aplicar. Se puede
-- repetir sin que cambie nada.

DO $$
DECLARE
  v_tabla text;
  v_filas bigint;
  v_total bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con las tablas ya borradas (una repetición) no hay nada que contar.
  FOREACH v_tabla IN ARRAY ARRAY['mesa', 'mesa_celda', 'union_de_mesas', 'linea_unida', 'division_de_cuenta', 'parte_de_division', 'contador_de_envios',
                                 'envio_de_comanda', 'renglon_de_envio', 'linea_de_comanda', 'aviso_de_anulacion', 'impresora', 'trabajo_de_impresion',
                                 'intento_de_impresion', 'linea_copiada'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF to_regclass('public.linea_cuenta') IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name = 'importe_fijo'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.linea_cuenta WHERE importe_fijo IS NOT NULL' INTO v_filas;
    v_total := v_total + v_filas;
  END IF;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de salón y comandas (mesas, envíos, impresiones, uniones, divisiones, líneas compartidas) que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Las funciones de ventas vuelven a su cuerpo anterior (antes de borrar la columna: el cuerpo nuevo la nombra).
CREATE OR REPLACE FUNCTION cuenta_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id OR NEW.ancla_tipo IS DISTINCT FROM OLD.ancla_tipo
     OR NEW.ancla_id IS DISTINCT FROM OLD.ancla_id OR NEW.etiqueta IS DISTINCT FROM OLD.etiqueta
     OR NEW.moneda IS DISTINCT FROM OLD.moneda OR NEW.momento_de_stock IS DISTINCT FROM OLD.momento_de_stock
     OR NEW.abierta_por IS DISTINCT FROM OLD.abierta_por OR NEW.abierta_en IS DISTINCT FROM OLD.abierta_en
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la identidad de una cuenta no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_inmutable';
  END IF;
  IF OLD.estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'una cuenta cerrada o anulada no se puede modificar'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_resuelta_congelada';
  END IF;
  -- Reservar una posición sube `ultima_posicion` de a una; ninguna otra cosa la mueve.
  IF NEW.ultima_posicion IS DISTINCT FROM OLD.ultima_posicion AND NEW.ultima_posicion <> OLD.ultima_posicion + 1 THEN
    RAISE EXCEPTION 'las posiciones de una cuenta suben de a una'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_posicion_invalida';
  END IF;
  IF NEW.estado <> 'ABIERTA' THEN
    -- Quien cierra o anula es la persona del contexto firmado: la aplicación no puede poner a otra.
    IF NEW.resuelta_por IS DISTINCT FROM public.app_persona_id() THEN
      RAISE EXCEPTION 'la cuenta la resuelve la persona del contexto'
        USING ERRCODE = '23514', CONSTRAINT = 'cuenta_persona_del_contexto';
    END IF;
    IF NEW.ultima_posicion IS DISTINCT FROM OLD.ultima_posicion OR NEW.total_provisorio IS DISTINCT FROM OLD.total_provisorio THEN
      RAISE EXCEPTION 'al cerrar o anular una cuenta no se cambian sus líneas ni su total'
        USING ERRCODE = '23514', CONSTRAINT = 'cuenta_transicion_invalida';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION cuenta_total_cuadra() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_cuenta uuid;
  v_empresa uuid;
  v_total numeric;
  v_esperado numeric;
BEGIN
  IF TG_TABLE_NAME = 'cuenta_consumo' THEN
    v_cuenta := NEW.id;
  ELSE
    v_cuenta := NEW.cuenta_id;
  END IF;
  v_empresa := NEW.empresa_id;
  SELECT c.total_provisorio INTO v_total FROM public.cuenta_consumo c WHERE c.id = v_cuenta AND c.empresa_id = v_empresa;
  SELECT round(coalesce(sum(l.precio_unitario * l.cantidad), 0), 2) INTO v_esperado
    FROM public.linea_cuenta l WHERE l.cuenta_id = v_cuenta AND l.empresa_id = v_empresa AND l.estado = 'VIGENTE';
  IF v_total IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'el total de la cuenta (%) no es el de sus líneas vigentes (%)', v_total, v_esperado
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_total_cuadra';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION linea_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  -- Todo lo que se congeló al agregar la línea queda como está: solo cambia `estado` (y su marca de anulación).
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id
     OR NEW.posicion IS DISTINCT FROM OLD.posicion OR NEW.producto_id IS DISTINCT FROM OLD.producto_id
     OR NEW.descripcion IS DISTINCT FROM OLD.descripcion OR NEW.variante_opcion_id IS DISTINCT FROM OLD.variante_opcion_id
     OR NEW.variante_nombre IS DISTINCT FROM OLD.variante_nombre
     OR NEW.variante_version_de_opcion_id IS DISTINCT FROM OLD.variante_version_de_opcion_id
     OR NEW.precio_id IS DISTINCT FROM OLD.precio_id
     OR NEW.origen_del_precio IS DISTINCT FROM OLD.origen_del_precio OR NEW.moneda IS DISTINCT FROM OLD.moneda
     OR NEW.precio_base IS DISTINCT FROM OLD.precio_base OR NEW.precio_unitario IS DISTINCT FROM OLD.precio_unitario
     OR NEW.cantidad IS DISTINCT FROM OLD.cantidad OR NEW.unidad_de_venta IS DISTINCT FROM OLD.unidad_de_venta
     OR NEW.paso_de_cantidad IS DISTINCT FROM OLD.paso_de_cantidad OR NEW.alicuota IS DISTINCT FROM OLD.alicuota
     OR NEW.controla_stock IS DISTINCT FROM OLD.controla_stock OR NEW.creada_por IS DISTINCT FROM OLD.creada_por
     OR NEW.creada_en IS DISTINCT FROM OLD.creada_en OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'una línea no se edita: se anula con motivo y se agrega otra'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_inmutable';
  END IF;
  IF OLD.estado = 'ANULADA' THEN
    RAISE EXCEPTION 'una línea anulada no se puede modificar'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_anulada_congelada';
  END IF;
  IF NEW.estado = 'ANULADA' THEN
    IF NEW.anulada_por IS DISTINCT FROM public.app_persona_id() THEN
      RAISE EXCEPTION 'la línea la anula la persona del contexto'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_persona_del_contexto';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cuenta_consumo c WHERE c.id = NEW.cuenta_id AND c.empresa_id = NEW.empresa_id AND c.estado = 'ABIERTA') THEN
      RAISE EXCEPTION 'solo se anulan líneas de una cuenta abierta'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_cuenta_no_abierta';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE UPDATE (ancla_tipo, ancla_id) ON cuenta_consumo FROM pedernal_app;
DROP TRIGGER IF EXISTS linea_importe_fijo_ck_trg ON linea_cuenta;

-- Los disparadores, las políticas y los privilegios caen con las tablas (DROP TABLE no dispara los de borrado). Orden inverso de las
-- claves foráneas.
DROP TABLE IF EXISTS intento_de_impresion;
DROP TABLE IF EXISTS trabajo_de_impresion;
DROP TABLE IF EXISTS impresora;
DROP TABLE IF EXISTS aviso_de_anulacion;
DROP TABLE IF EXISTS linea_de_comanda;
DROP TABLE IF EXISTS renglon_de_envio;
DROP TABLE IF EXISTS envio_de_comanda;
DROP TABLE IF EXISTS contador_de_envios;
DROP TABLE IF EXISTS parte_de_division;
DROP TABLE IF EXISTS division_de_cuenta;
DROP TABLE IF EXISTS linea_unida;
DROP TABLE IF EXISTS union_de_mesas;
DROP TABLE IF EXISTS mesa_celda;
DROP TABLE IF EXISTS mesa;
DROP TABLE IF EXISTS linea_copiada;

-- La columna cae sin CASCADE: si algo depende de ella, falla y no se pierde nada.
ALTER TABLE linea_cuenta DROP COLUMN IF EXISTS importe_fijo;

DROP FUNCTION IF EXISTS intento_mueve_el_trabajo();
DROP FUNCTION IF EXISTS intento_validar_alta();
DROP FUNCTION IF EXISTS trabajo_de_impresion_validar_cambio();
DROP FUNCTION IF EXISTS trabajo_de_impresion_validar_alta();
DROP FUNCTION IF EXISTS linea_de_comanda_validar_cambio();
DROP FUNCTION IF EXISTS linea_de_comanda_validar_alta();
DROP FUNCTION IF EXISTS renglon_validar_alta();
DROP FUNCTION IF EXISTS envio_validar_alta();
DROP FUNCTION IF EXISTS contador_sin_huecos();
DROP FUNCTION IF EXISTS contador_validar_cambio();
DROP FUNCTION IF EXISTS contador_validar_alta();
DROP FUNCTION IF EXISTS detalle_de_cocina_valido(text[]);
DROP FUNCTION IF EXISTS division_partes_cuadran();
DROP FUNCTION IF EXISTS mesa_celdas_cuadran();
DROP FUNCTION IF EXISTS mesa_celda_validar();
DROP FUNCTION IF EXISTS mesa_validar_cambio();
DROP FUNCTION IF EXISTS linea_importe_fijo_solo_compartida();
DROP FUNCTION IF EXISTS copias_cuadran();
DROP FUNCTION IF EXISTS linea_copiada_validar_alta();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0038_salon.sql';
  END IF;
END
$$;
