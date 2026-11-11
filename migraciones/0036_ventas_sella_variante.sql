-- 0036_ventas_sella_variante: la línea del ticket sella la VERSIÓN de la opción de la variante (el tamaño) que se vendió (E5-T12, el cableado de
-- ventas con stock). `linea_cuenta` ya sellaba `variante_opcion_id` y `variante_nombre` (0028) pero no la versión: la explosión del consumo de
-- stock necesita el `factor_de_tamano` de ESA versión (lo vendido no cambia aunque después se edite el factor, E5 §3.3 paso 5) y la versión
-- vigente de hoy puede ser otra. No se puede reconstruir desde lo ya sellado: `precio_id` apunta a `precio_de_venta` (que cuelga de la OPCIÓN, no de
-- su versión) y es NULL con precio abierto. Especificación: Pedernal-docs/11-especificaciones/e5-stock-especificacion.md §3.3.
--
-- Reglas de esta migración (las mismas de 0001 a 0031):
--  * Es ADITIVA y compatible hacia atrás: una columna nullable. Las filas que ya existen quedan en NULL (válido: se vendieron antes de que el
--    stock descontara; esas líneas nacieron con `controla_stock = false` y nunca van a stock). No se rellena ni se borra nada.
--  * No agrega funciones SECURITY DEFINER. Las dos funciones de disparador que reemplaza (`CREATE OR REPLACE`, misma firma) conservan su
--    `search_path = pg_catalog, public, pg_temp` y sus nombres de restricción; no se otorgan a nadie.
--  * Su reversión es un script aparte, revisado: `migraciones/reversiones/0036_revertir_ventas_sella_variante.sql`. El ejecutor no la aplica.
--
-- Decisiones de diseño (probadas por `test/integracion/ventas-migracion.test.ts` y `ventas-stock.test.ts`):
--
--  V1. `variante_version_de_opcion_id` es una clave foránea COMPUESTA `(id, empresa_id)` a `version_de_opcion` (la única de `linea_cuenta` hacia el
--      catálogo: las demás referencias de la línea son opacas desde 0028; esta la usa la explosión de stock y se quiere que la base impida una
--      versión de otra empresa o inexistente).
--  V2. Se sella solo al INSERTAR la línea (privilegio de INSERT por columna; ningún UPDATE) y no cambia nunca: el disparador de inmutabilidad
--      `linea_validar_cambio` la suma a lo que no se edita.
--  V3. La versión sellada es de LA opción de la variante elegida (`linea_validar_alta`): sin esto una línea podría sellar el factor de otro
--      tamaño. Sin variante no hay opción de la que sea, así que una versión sin variante también se rechaza ahí (no hace falta un CHECK aparte:
--      el disparador de alta corre antes y lo haría inalcanzable).

DO $$
BEGIN
  IF to_regclass('public.linea_cuenta') IS NULL THEN
    RAISE EXCEPTION 'el sellado de la variante requiere 0028_ventas aplicada antes (falta linea_cuenta)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.version_de_opcion') IS NULL THEN
    RAISE EXCEPTION 'el sellado de la variante requiere 0025_catalogo aplicada antes (falta version_de_opcion)'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name = 'variante_version_de_opcion_id'
  ) THEN
    RAISE EXCEPTION 'la versión de la variante nace en 0036: la columna linea_cuenta.variante_version_de_opcion_id ya existe (alguien la creó a mano); hay que revisarla antes de migrar'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- V1. La columna y su clave foránea compuesta
-- ---------------------------------------------------------------------------------------------
ALTER TABLE linea_cuenta ADD COLUMN variante_version_de_opcion_id uuid;
ALTER TABLE linea_cuenta ADD CONSTRAINT linea_variante_version_fkey
  FOREIGN KEY (variante_version_de_opcion_id, empresa_id) REFERENCES version_de_opcion (id, empresa_id);

-- ---------------------------------------------------------------------------------------------
-- V3. Alta: la versión sellada es de la opción de la variante elegida (mismo cuerpo de 0028 más ese control)
-- ---------------------------------------------------------------------------------------------
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
  IF NEW.variante_version_de_opcion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.version_de_opcion v
     WHERE v.id = NEW.variante_version_de_opcion_id AND v.empresa_id = NEW.empresa_id AND v.opcion_id = NEW.variante_opcion_id
  ) THEN
    RAISE EXCEPTION 'la versión sellada no es de la opción de la variante elegida'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_variante_version_no_corresponde';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- V2. Cambio: la versión sellada queda como está (mismo cuerpo de 0028 más esa columna en lo inmutable)
-- ---------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------
-- Privilegio: INSERT por columna, como el resto de la línea (ningún UPDATE de esta columna)
-- ---------------------------------------------------------------------------------------------
GRANT INSERT (variante_version_de_opcion_id) ON linea_cuenta TO pedernal_app;
