-- 0036_revertir_ventas_sella_variante: deshace la migración 0036_ventas_sella_variante (la columna `linea_cuenta.variante_version_de_opcion_id`, su
-- clave foránea y el control de `linea_validar_alta`; deja `linea_validar_alta` y `linea_validar_cambio` como estaban en 0028).
--
-- DESTRUCTIVA si hay datos: BORRA la versión de la variante que sellaron las líneas vendidas con stock activo, y eso NO SE RECUPERA (es el único
-- registro de qué versión del tamaño se vendió: sin ella no se puede reconstruir con qué factor se descontó el stock). Hay que AVISAR AL DUEÑO
-- antes de correrla si hay alguna fila con valor. Ojo con el código: ventas escribe y lee esa columna al agregar una línea y al cerrar la cuenta;
-- sin ella agregar líneas falla, así que conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay alguna línea con la versión sellada
--     \i migraciones/reversiones/0036_revertir_ventas_sella_variante.sql
--     COMMIT;
--
-- Deja ventas como estaba después de 0035 en lo que toca a `linea_cuenta` (es decir, como en 0028). No usa CASCADE: si otro objeto depende de
-- la columna, el DROP falla y no se pierde nada. Solo borra su propia fila del registro `migracion`, para que la migración se pueda volver
-- a aplicar. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_filas bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con la columna ya borrada (una repetición) no hay nada que contar.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name = 'variante_version_de_opcion_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.linea_cuenta WHERE variante_version_de_opcion_id IS NOT NULL' INTO v_filas;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % líneas con la versión de la variante sellada que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Las funciones vuelven a su cuerpo de 0028 (antes de borrar la columna: el cuerpo nuevo la nombra).
CREATE OR REPLACE FUNCTION linea_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_cuenta public.cuenta_consumo%ROWTYPE;
BEGIN
  SELECT * INTO v_cuenta FROM public.cuenta_consumo c WHERE c.id = NEW.cuenta_id AND c.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_cuenta.estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'solo se agregan líneas a una cuenta abierta'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_cuenta_no_abierta';
  END IF;
  -- La posición la reservó `UPDATE cuenta_consumo SET ultima_posicion = ultima_posicion + 1` en esta misma transacción.
  IF NEW.posicion > v_cuenta.ultima_posicion THEN
    RAISE EXCEPTION 'la posición % no fue reservada en la cuenta', NEW.posicion
      USING ERRCODE = '23514', CONSTRAINT = 'linea_posicion_no_reservada';
  END IF;
  IF NEW.estado <> 'VIGENTE' THEN
    RAISE EXCEPTION 'una línea nace vigente'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_alta_invalida';
  END IF;
  RETURN NEW;
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
     OR NEW.variante_nombre IS DISTINCT FROM OLD.variante_nombre OR NEW.precio_id IS DISTINCT FROM OLD.precio_id
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

-- La clave foránea y el privilegio caen con la columna (sin CASCADE: si algo depende de ella, falla y no se pierde nada).
ALTER TABLE linea_cuenta DROP CONSTRAINT IF EXISTS linea_variante_version_fkey;
ALTER TABLE linea_cuenta DROP COLUMN IF EXISTS variante_version_de_opcion_id;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0036_ventas_sella_variante.sql';
  END IF;
END
$$;
