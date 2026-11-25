-- 0079_familias_de_productos (M-A de la especificación de familias, A8): una familia reúne productos que siguen siendo independientes (receta, stock, costo, código y precio
-- propios) para mostrarlos juntos en la carta y/o en el POS. Aditiva: dos tablas nuevas; NO toca `producto` (su `version` sube con cualquier UPDATE: una familia que cambiara
-- columnas del producto haría fallar la edición simultánea de la ficha).
-- Especificación: docs/11-especificaciones/familias-especificacion.md (§4 y §7). Decisiones del dueño: 11 y 12/11/2026 (MIG §12.10 a §12.27, DDD 68 a 70) y 16/11/2026
-- (sin sección propia: la familia toma la de sus miembros; el interruptor del POS nace apagado; al desactivar una familia sus productos siguen siendo miembros).
--
-- Reglas (las de 0025 y 0043):
--  * Nace en forma final; no hay ALTER de tablas existentes ni copia de datos. Ninguna función SECURITY DEFINER; toda función fija `search_path` y nace sin EXECUTE para PUBLIC.
--  * Nadie recibe DELETE ni TRUNCATE (los disparadores lo frenan aun al dueño): una familia se desactiva; un miembro se «quita» con fecha y autor, y volver a agregarlo es una fila NUEVA.
--  * RLS activa y FORZADA; una política por comando. INSERT y UPDATE por columna. Toda única lleva `empresa_id`; toda clave foránea entre tablas de empresa es COMPUESTA.
--  * Dinero: no hay. Fechas: `timestamptz` (UTC); los instantes los pone la aplicación (el reloj de la composición).
--  * Reversión aparte y revisada: `migraciones/reversiones/0079_revertir_familias_de_productos.sql`.
--  * DEPENDE de 0001, 0005, 0007, 0025 y 0043 (carta pública, para la lectura del rol público); se comprueba al empezar.
--
-- Decisiones de diseño (las prueba un test de integración):
--  F1. Un producto está en UNA sola familia a la vez: índice único PARCIAL `(empresa_id, producto_id) WHERE quitado_en IS NULL`. Dos personas que lo agregan a la vez a familias
--      distintas: gana una (la otra recibe `miembro_vigente_producto_uk`).
--  F2. La posición dentro de la familia es única entre los miembros vigentes (la asigna la aplicación con la familia bloqueada; el índice atrapa una carrera).
--  F3. Un miembro quitado no cambia más (ni se «reactiva»): historia intacta. Solo se escribe `quitado_por` y `quitado_en`, una vez.
--  F4. El tope de miembros (50) lo impone la aplicación con la familia bloqueada `FOR UPDATE`; la base no lo cuenta (un disparador que cuente no ve la fila de otra transacción).
--  F5. Lectura pública: el rol público lee, por columna, solo las familias y los miembros vigentes de la empresa de la carta cuyo `codigo` es `app.codigo_de_carta` (como 0043).

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.producto') IS NULL OR to_regclass('public.persona') IS NULL OR to_regclass('public.carta_publica') IS NULL
     OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL OR to_regprocedure('public.sin_borrado()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL
     OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'las familias requieren 0001, 0005, 0007, 0025 y 0043 aplicadas antes (faltan el producto, la carta pública o las funciones base)'
      USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['familia_de_producto', 'miembro_de_familia'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'las familias nacen en 0079: la tabla % ya existe (alguien la creó a mano); hay que revisarla antes de migrar', v_tabla
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

CREATE TABLE familia_de_producto (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia del alta
  empresa_id       uuid NOT NULL REFERENCES empresa (id),
  nombre           text NOT NULL CONSTRAINT familia_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 120)),
  nombre_clave     text NOT NULL CONSTRAINT familia_nombre_clave_ck CHECK (char_length(nombre_clave) BETWEEN 1 AND 360),
  agrupar_en_carta boolean NOT NULL DEFAULT false,
  agrupar_en_pos   boolean NOT NULL DEFAULT false,
  activa           boolean NOT NULL DEFAULT true,
  creado_por       uuid REFERENCES persona (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT familia_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT familia_nombre_uk UNIQUE (empresa_id, nombre_clave)
);

CREATE TABLE miembro_de_familia (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES empresa (id),
  familia_id   uuid NOT NULL,
  producto_id  uuid NOT NULL,
  posicion     integer NOT NULL CONSTRAINT miembro_posicion_ck CHECK (posicion BETWEEN 1 AND 1000),
  agregado_por uuid REFERENCES persona (id),
  agregado_en  timestamptz NOT NULL,
  quitado_por  uuid REFERENCES persona (id),
  quitado_en   timestamptz,
  CONSTRAINT miembro_quitado_ck CHECK (quitado_en IS NOT NULL OR quitado_por IS NULL),
  CONSTRAINT miembro_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT miembro_familia_fkey FOREIGN KEY (familia_id, empresa_id) REFERENCES familia_de_producto (id, empresa_id),
  CONSTRAINT miembro_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id)
);
CREATE UNIQUE INDEX miembro_vigente_producto_uk ON miembro_de_familia (empresa_id, producto_id) WHERE quitado_en IS NULL;
CREATE UNIQUE INDEX miembro_vigente_posicion_uk ON miembro_de_familia (empresa_id, familia_id, posicion) WHERE quitado_en IS NULL;
CREATE INDEX miembro_de_familia_familia_ix ON miembro_de_familia (empresa_id, familia_id);

-- Disparadores: invariantes que la base impone aunque el código se olvide. `_cambio` corre antes que `_version` (orden alfabético).
CREATE FUNCTION familia_de_producto_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'la identidad de una familia no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'familia_identidad_inmutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION miembro_de_familia_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.familia_id IS DISTINCT FROM OLD.familia_id
     OR NEW.producto_id IS DISTINCT FROM OLD.producto_id OR NEW.posicion IS DISTINCT FROM OLD.posicion
     OR NEW.agregado_por IS DISTINCT FROM OLD.agregado_por OR NEW.agregado_en IS DISTINCT FROM OLD.agregado_en THEN
    RAISE EXCEPTION 'la familia, el producto y quién y cuándo lo agregó no cambian: quitar es escribir quién y cuándo'
      USING ERRCODE = '23514', CONSTRAINT = 'miembro_identidad_inmutable';
  END IF;
  IF OLD.quitado_en IS NOT NULL THEN
    RAISE EXCEPTION 'un miembro quitado no cambia más: volver a agregarlo es una fila nueva'
      USING ERRCODE = '23514', CONSTRAINT = 'miembro_quitado_inmutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER familia_de_producto_cambio BEFORE UPDATE ON familia_de_producto
  FOR EACH ROW EXECUTE FUNCTION familia_de_producto_validar();
CREATE TRIGGER familia_de_producto_version BEFORE UPDATE ON familia_de_producto
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER miembro_de_familia_cambio BEFORE UPDATE ON miembro_de_familia
  FOR EACH ROW EXECUTE FUNCTION miembro_de_familia_validar();

CREATE TRIGGER familia_de_producto_sin_borrado BEFORE DELETE ON familia_de_producto
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER familia_de_producto_sin_truncate BEFORE TRUNCATE ON familia_de_producto
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER miembro_de_familia_sin_borrado BEFORE DELETE ON miembro_de_familia
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER miembro_de_familia_sin_truncate BEFORE TRUNCATE ON miembro_de_familia
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- Privilegios: por columna; nadie recibe DELETE ni TRUNCATE.
REVOKE ALL ON familia_de_producto, miembro_de_familia FROM PUBLIC;

GRANT SELECT ON familia_de_producto, miembro_de_familia TO pedernal_app;
GRANT INSERT (id, empresa_id, nombre, nombre_clave, agrupar_en_carta, agrupar_en_pos, activa, creado_por) ON familia_de_producto TO pedernal_app;
GRANT UPDATE (nombre, nombre_clave, agrupar_en_carta, agrupar_en_pos, activa) ON familia_de_producto TO pedernal_app;
GRANT INSERT (id, empresa_id, familia_id, producto_id, posicion, agregado_por, agregado_en) ON miembro_de_familia TO pedernal_app;
GRANT UPDATE (quitado_por, quitado_en) ON miembro_de_familia TO pedernal_app;

-- El rol público: solo lo que la carta necesita, por columna.
GRANT SELECT (id, empresa_id, nombre, agrupar_en_carta, activa) ON familia_de_producto TO pedernal_publico;
GRANT SELECT (empresa_id, familia_id, producto_id, posicion, quitado_en) ON miembro_de_familia TO pedernal_publico;

ALTER TABLE familia_de_producto ENABLE ROW LEVEL SECURITY;
ALTER TABLE familia_de_producto FORCE ROW LEVEL SECURITY;
ALTER TABLE miembro_de_familia ENABLE ROW LEVEL SECURITY;
ALTER TABLE miembro_de_familia FORCE ROW LEVEL SECURITY;

CREATE POLICY familia_de_producto_app_leer ON familia_de_producto FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY familia_de_producto_app_alta ON familia_de_producto FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY familia_de_producto_app_cambiar ON familia_de_producto FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY miembro_de_familia_app_leer ON miembro_de_familia FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY miembro_de_familia_app_alta ON miembro_de_familia FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND agregado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
    AND quitado_en IS NULL
  );
CREATE POLICY miembro_de_familia_app_cambiar ON miembro_de_familia FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND quitado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );

-- Rol público: las familias de la empresa de la carta con ese código (en línea) y sus miembros vigentes.
CREATE POLICY familia_de_producto_publico_leer ON familia_de_producto FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.estado = 'EN_LINEA' AND c.empresa_id = familia_de_producto.empresa_id
  ));
CREATE POLICY miembro_de_familia_publico_leer ON miembro_de_familia FOR SELECT TO pedernal_publico
  USING (quitado_en IS NULL AND EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.estado = 'EN_LINEA' AND c.empresa_id = miembro_de_familia.empresa_id
  ));
