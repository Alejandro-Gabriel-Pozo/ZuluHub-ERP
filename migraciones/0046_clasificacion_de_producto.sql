-- 0046_clasificacion_de_producto: a qué nodo de la clasificación comercial pertenece un producto, con vigencia (A2b, tramo T-C).
-- Ficha de concepto: Pedernal-docs/11-especificaciones/conceptos/clasificacion-comercial-y-seccion-de-la-carta.md §2; plan aprobado por el dueño el 12/11/2026 («vínculo con
-- vigencia de solo inserción», decisión 60: un ítem tiene UN departamento principal con fechas, y cambiarlo no altera lo vendido); maqueta `clasificacion.html` (carpeta de
-- prototipos de Pedernal-docs, 10-ux-ui). El camino que se copia al renglón de venta es el tramo siguiente (0047).
--
-- Qué es: una lista de solo inserción, como `precio_de_venta`: cada fila es «desde este instante el producto está en este nodo». El cambio rige DESDE AHORA (decisión del dueño del
-- 13/11/2026: sin fecha futura ni cambios programados): `vigente_desde` es el instante del guardado y rige la última fila. `nodo_id` nulo = «Sin elegir». Una fila no se
-- edita ni se borra (ni el dueño de la base): se agrega otra más nueva; lo anterior queda además en la auditoría. El departamento es la raíz del camino del nodo: hay UN solo
-- vínculo, no dos columnas que puedan contradecirse. El producto sin fila está «Sin elegir».
--
-- Reglas que impone la base (la regla de negocio vive en el caso de uso):
--  * El producto y el nodo son de la MISMA empresa que la fila (claves foráneas compuestas) y el nodo, al asignarlo, está activo (un nodo desactivado después no altera el
--    historial: el producto lo conserva). Un nodo con productos vinculados no se borra de todos modos: no se borra nunca.
--  * Una vigencia no se repite por producto: `UNIQUE (empresa_id, producto_id, vigente_desde)`. El `id` lo manda la aplicación: es la clave de idempotencia del cambio.
--  * `cargado_por` es la persona del contexto (la política de alta lo exige), como en el precio.
--
-- Reglas de esta migración (las mismas de 0025 y 0045): sin funciones SECURITY DEFINER (la función fija `search_path` y califica con `public.`); nadie recibe UPDATE, DELETE ni
-- TRUNCATE (los disparadores los frenan aun al dueño); RLS activa y forzada, una política por comando; INSERT por columna. Solo la aplicación (`pedernal_app`) recibe algo.
-- Su reversión es un script aparte: `migraciones/reversiones/0046_revertir_clasificacion_de_producto.sql` (DESTRUCTIVA si hay vínculos). DEPENDE de 0025 y de 0045.

DO $$
BEGIN
  IF to_regclass('public.nodo_de_clasificacion') IS NULL OR to_regclass('public.producto') IS NULL
     OR to_regprocedure('public.solo_insercion()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL THEN
    RAISE EXCEPTION 'la clasificación del producto requiere 0045_clasificacion_comercial aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.clasificacion_de_producto') IS NOT NULL THEN
    RAISE EXCEPTION 'la clasificación del producto nace en 0046: la tabla clasificacion_de_producto ya existe (alguien la creó a mano); hay que revisarla antes de migrar'
      USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE TABLE clasificacion_de_producto (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la clave de idempotencia del cambio
  empresa_id    uuid NOT NULL REFERENCES empresa (id),
  producto_id   uuid NOT NULL,
  nodo_id       uuid,                                          -- nulo = «Sin elegir»
  vigente_desde timestamptz NOT NULL,
  cargado_por   uuid NOT NULL REFERENCES persona (id),
  creado_en     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clasificacion_de_producto_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT clasificacion_de_producto_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT clasificacion_de_producto_nodo_fkey FOREIGN KEY (nodo_id, empresa_id) REFERENCES nodo_de_clasificacion (id, empresa_id),
  CONSTRAINT clasificacion_de_producto_vigencia_uk UNIQUE (empresa_id, producto_id, vigente_desde)
);
CREATE INDEX clasificacion_de_producto_vigente_ix ON clasificacion_de_producto (empresa_id, producto_id, vigente_desde DESC);
CREATE INDEX clasificacion_de_producto_nodo_ix ON clasificacion_de_producto (empresa_id, nodo_id) WHERE nodo_id IS NOT NULL;

-- Al asignar, el nodo está activo (defensa en profundidad; la regla vive en el caso de uso). Lee con los permisos de quien escribe.
CREATE FUNCTION clasificacion_de_producto_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_activo boolean;
BEGIN
  IF NEW.nodo_id IS NOT NULL THEN
    SELECT n.activo INTO v_activo FROM public.nodo_de_clasificacion n WHERE n.id = NEW.nodo_id AND n.empresa_id = NEW.empresa_id;
    IF v_activo IS NOT NULL AND NOT v_activo THEN
      RAISE EXCEPTION 'no se asigna un nodo desactivado'
        USING ERRCODE = '23514', CONSTRAINT = 'clasificacion_de_producto_nodo_desactivado';
    END IF;
  END IF;
  RETURN NEW;  -- un nodo que no existe o es de otra empresa lo rechaza la clave foránea
END
$$;

CREATE TRIGGER clasificacion_de_producto_alta BEFORE INSERT ON clasificacion_de_producto
  FOR EACH ROW EXECUTE FUNCTION clasificacion_de_producto_validar();
CREATE TRIGGER clasificacion_de_producto_solo_insercion BEFORE UPDATE OR DELETE ON clasificacion_de_producto
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER clasificacion_de_producto_sin_truncate BEFORE TRUNCATE ON clasificacion_de_producto
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

REVOKE ALL ON clasificacion_de_producto FROM PUBLIC;
GRANT SELECT ON clasificacion_de_producto TO pedernal_app;
GRANT INSERT (id, empresa_id, producto_id, nodo_id, vigente_desde, cargado_por) ON clasificacion_de_producto TO pedernal_app;

ALTER TABLE clasificacion_de_producto ENABLE ROW LEVEL SECURITY;
ALTER TABLE clasificacion_de_producto FORCE ROW LEVEL SECURITY;

CREATE POLICY clasificacion_de_producto_app_leer ON clasificacion_de_producto FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY clasificacion_de_producto_app_alta ON clasificacion_de_producto FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND cargado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
