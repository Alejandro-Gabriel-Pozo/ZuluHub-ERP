-- 0047_revertir_camino_en_el_renglon: deshace la migración 0047_camino_en_el_renglon: quita de `linea_cuenta` las columnas `departamento_id` y `camino_de_clasificacion` (con su
-- CHECK, su clave foránea y su índice), devuelve `linea_validar_cambio` a la versión de 0038 y borra `camino_de_clasificacion_valido`.
--
-- DESTRUCTIVA si hay datos: BORRA el camino de clasificación sellado en cada renglón de venta (no se recupera: lo que tenía el producto al venderse no se puede reconstruir
-- después, porque el producto se reclasifica y los nodos se renombran). Hay que AVISAR AL DUEÑO antes de correrla si algún renglón tiene camino. Conviene bajar primero el
-- código que escribe esas columnas (`agregarLinea` y `copiarLinea`).
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño
-- de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si algún renglón tiene camino
--     \i migraciones/reversiones/0047_revertir_camino_en_el_renglon.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

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
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name = 'camino_de_clasificacion'
  ) THEN
    SELECT count(*) INTO v_filas FROM public.linea_cuenta WHERE camino_de_clasificacion IS NOT NULL;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % renglones de venta con camino de clasificación que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- La función de cambio, como la dejó 0038 (sin las dos columnas): primero la función, para que nada la lea mientras se sacan las columnas.
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
     OR NEW.importe_fijo IS DISTINCT FROM OLD.importe_fijo
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

DROP INDEX IF EXISTS linea_departamento_ix;
ALTER TABLE linea_cuenta DROP CONSTRAINT IF EXISTS linea_departamento_fkey;
ALTER TABLE linea_cuenta DROP CONSTRAINT IF EXISTS linea_clasificacion_ck;
ALTER TABLE linea_cuenta DROP COLUMN IF EXISTS camino_de_clasificacion;
ALTER TABLE linea_cuenta DROP COLUMN IF EXISTS departamento_id;
DROP FUNCTION IF EXISTS camino_de_clasificacion_valido(jsonb, uuid);

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0047_camino_en_el_renglon.sql';
  END IF;
END
$$;
