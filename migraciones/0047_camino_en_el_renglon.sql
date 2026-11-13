-- 0047_camino_en_el_renglon: el renglón de venta (`linea_cuenta`) congela el CAMINO de clasificación comercial del producto al momento de venderlo (A2b, tramo T-D).
-- Ficha de concepto: Pedernal-docs/11-especificaciones/conceptos/clasificacion-comercial-y-seccion-de-la-carta.md §2 («el camino completo, departamento y categoría, se copia a la
-- venta»); decisión 60 («un departamento principal por ítem, con fechas, que se copia a la venta; cambiarlo no toca lo vendido», contrato 5); plan aprobado por el dueño el 12/11/2026
-- (la copia entra en la PRIMERA entrega). `linea_cuenta` ya congelaba la descripción, la alícuota, el precio y la unidad; el camino se suma al mismo sellado.
--
-- Reglas de esta migración (las mismas de 0036):
--  * Es ADITIVA y compatible hacia atrás: dos columnas nullable. Las filas que ya existen quedan en NULL (válido: «sin clasificar»; se vendieron antes de esta migración y no
--    hay de dónde reconstruir el camino que tenía el producto en ese momento). No se rellena ni se borra nada.
--  * No agrega funciones SECURITY DEFINER. La función de validación fija `search_path`, califica con `public.` y solo se otorga a la aplicación (la usa un CHECK, que corre con
--    los permisos de quien escribe). La función de disparador que reemplaza (`CREATE OR REPLACE`, misma firma) conserva su `search_path` y su nombre de restricción.
--  * Su reversión es un script aparte, revisado: `migraciones/reversiones/0047_revertir_camino_en_el_renglon.sql` (DESTRUCTIVA si hay renglones con camino). El ejecutor no la aplica.
--
-- Decisiones de diseño (probadas por `test/integracion/clasificacion-en-la-venta.test.ts`):
--  K1. Dos columnas: `departamento_id` (el primer nodo del camino, con índice para los reportes por departamento) y `camino_de_clasificacion` (un arreglo JSON ordenado del
--      departamento al nodo del producto, con el `id` y el `nombre` de cada uno al vender). Los nombres se copian: renombrar o desactivar un nodo después no cambia el renglón.
--      Ambas son nulas o ambas tienen valor; un camino tiene de 1 a `tope_de_niveles_de_clasificacion()` nodos y su primer `id` es el departamento.
--  K2. `departamento_id` es una clave foránea COMPUESTA `(id, empresa_id)` a `nodo_de_clasificacion`: el renglón no puede apuntar a un nodo de otra empresa ni inexistente (los nodos
--      no se borran nunca, así que la referencia no se rompe).
--  K3. Se sellan solo al INSERTAR la línea (privilegio de INSERT por columna; ningún UPDATE) y no cambian nunca: `linea_validar_cambio` las suma a lo que no se edita. Lo que se
--      vendió no cambia aunque el producto se reclasifique o el nodo se mueva.
-- DEPENDE de 0028 (ventas), 0036 y 0038 (las versiones vigentes de la función de cambio) y 0045 (nodos); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.linea_cuenta') IS NULL OR to_regclass('public.nodo_de_clasificacion') IS NULL
     OR to_regprocedure('public.tope_de_niveles_de_clasificacion()') IS NULL
     OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'el camino en el renglón requiere 0028_ventas y 0045_clasificacion_comercial aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name IN ('departamento_id', 'camino_de_clasificacion')
  ) THEN
    RAISE EXCEPTION 'el camino en el renglón nace en 0047: las columnas ya existen (alguien las creó a mano); hay que revisarlas antes de migrar'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- K1. La forma del camino: un arreglo de 1 a tope objetos `{id, nombre}` (ni una clave más ni una menos), con el primer `id` igual al departamento.
CREATE FUNCTION camino_de_clasificacion_valido(p_camino jsonb, p_departamento uuid) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN p_camino IS NULL OR p_departamento IS NULL OR jsonb_typeof(p_camino) <> 'array' THEN false
    WHEN jsonb_array_length(p_camino) NOT BETWEEN 1 AND public.tope_de_niveles_de_clasificacion() THEN false
    WHEN p_camino #>> '{0,id}' IS DISTINCT FROM p_departamento::text THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_camino) AS e
       WHERE jsonb_typeof(e) <> 'object'
          OR (SELECT count(*) FROM jsonb_object_keys(e)) <> 2
          OR jsonb_typeof(e -> 'id') IS DISTINCT FROM 'string'
          OR jsonb_typeof(e -> 'nombre') IS DISTINCT FROM 'string'
          OR (e ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          OR NOT public.texto_de_catalogo_valido(e ->> 'nombre', 80)
    )
  END
$$;
REVOKE ALL ON FUNCTION camino_de_clasificacion_valido(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION camino_de_clasificacion_valido(jsonb, uuid) TO pedernal_app;

ALTER TABLE linea_cuenta ADD COLUMN departamento_id uuid;
ALTER TABLE linea_cuenta ADD COLUMN camino_de_clasificacion jsonb;
ALTER TABLE linea_cuenta ADD CONSTRAINT linea_clasificacion_ck CHECK (
  (departamento_id IS NULL AND camino_de_clasificacion IS NULL)
  OR (departamento_id IS NOT NULL AND camino_de_clasificacion IS NOT NULL AND camino_de_clasificacion_valido(camino_de_clasificacion, departamento_id))
);
-- K2. El departamento es un nodo de la misma empresa.
ALTER TABLE linea_cuenta ADD CONSTRAINT linea_departamento_fkey
  FOREIGN KEY (departamento_id, empresa_id) REFERENCES nodo_de_clasificacion (id, empresa_id);
CREATE INDEX linea_departamento_ix ON linea_cuenta (empresa_id, departamento_id) WHERE departamento_id IS NOT NULL;

-- K3. Cambio: lo sellado queda como está (mismo cuerpo de 0038 más estas dos columnas en lo inmutable).
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
     OR NEW.creada_en IS DISTINCT FROM OLD.creada_en OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
     OR NEW.departamento_id IS DISTINCT FROM OLD.departamento_id
     OR NEW.camino_de_clasificacion IS DISTINCT FROM OLD.camino_de_clasificacion THEN
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

-- Privilegio: INSERT por columna, como el resto de la línea (ningún UPDATE de estas columnas).
GRANT INSERT (departamento_id, camino_de_clasificacion) ON linea_cuenta TO pedernal_app;
