-- 0078_portal_de_la_empresa (PROPUESTA, sin aplicar): el portal de la empresa (variantes A y B), con su código propio para el QR.
-- ADITIVA: tres tablas nuevas, dos políticas nuevas sobre tablas existentes (lectura pública del portal) y nada más. No toca filas existentes.
-- Reversión: migraciones/reversiones/0078_revertir_portal_de_la_empresa.sql (FRENA si hay un portal cargado: su código está impreso en QR).
-- DEPENDE de 0001, 0043, 0044 y 0077 (`imagen_externa_valida`, `color_de_carta_valido`); se comprueba al empezar.
--
-- Reglas (las de 0043): nadie recibe DELETE ni TRUNCATE (lo oculto se oculta, no se borra); RLS activa y forzada; una política por comando; INSERT y UPDATE por columna;
-- claves foráneas compuestas (x_id, empresa_id); toda única lleva `empresa_id`, SALVO `portal_de_empresa_codigo_uk` (el código es la llave pública del QR: único en toda
-- la plataforma, excepción declarada igual que `carta_publica_codigo_uk`).
-- Lectura pública: `app.codigo_de_portal` (lo fija la lectura pública del portal dentro de su transacción con set_config(…, true)). Sin ese valor, ninguna tabla devuelve filas.

DO $$
BEGIN
  IF to_regclass('public.carta_publica') IS NULL OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL
     OR to_regprocedure('public.sin_borrado()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL
     OR to_regprocedure('public.app_persona_id()') IS NULL OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'el portal requiere 0001, 0025 y 0043 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.imagen_externa_valida(text, text, text, text, text)') IS NULL
     OR to_regprocedure('public.color_de_carta_valido(text)') IS NULL THEN
    RAISE EXCEPTION 'el portal requiere 0077_identidad_de_la_carta aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_publico') THEN
    RAISE EXCEPTION 'el portal requiere el rol pedernal_publico (0007)' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- El portal: una fila por empresa.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_de_empresa (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: idempotencia del alta
  empresa_id       uuid NOT NULL REFERENCES empresa (id),
  codigo           text NOT NULL CONSTRAINT portal_de_empresa_codigo_ck CHECK (codigo ~ '^[A-Za-z0-9_-]{22,64}$'),
  variante         text NOT NULL DEFAULT 'A' CONSTRAINT portal_de_empresa_variante_ck CHECK (variante IN ('A', 'B')),
  -- NULL = el texto por defecto («Nuestros restaurantes», «Hacé clic en el restaurante»), que vive UNA vez en el vocabulario del código.
  linea_superior   text CONSTRAINT portal_de_empresa_linea_ck CHECK (linea_superior IS NULL OR texto_de_catalogo_valido(linea_superior, 40)),
  titulo           text CONSTRAINT portal_de_empresa_titulo_ck CHECK (titulo IS NULL OR texto_de_catalogo_valido(titulo, 60)),
  -- NULL = el color neutro del sistema.
  color_encabezado text CONSTRAINT portal_de_empresa_color_encabezado_ck CHECK (color_encabezado IS NULL OR color_de_carta_valido(color_encabezado)),
  color_pagina     text CONSTRAINT portal_de_empresa_color_pagina_ck CHECK (color_pagina IS NULL OR color_de_carta_valido(color_pagina)),
  color_detras     text CONSTRAINT portal_de_empresa_color_detras_ck CHECK (color_detras IS NULL OR color_de_carta_valido(color_detras)),
  -- El logo es el de la empresa (marca): acá solo si se muestra (encabezado y QR del portal).
  logo_visible     boolean NOT NULL DEFAULT true,
  imagen_proveedor text,
  imagen_cuenta    text,
  imagen_id_publico text,
  imagen_version   text,
  imagen_extension text,
  creado_por       uuid REFERENCES persona (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT portal_de_empresa_imagen_ck CHECK (imagen_externa_valida(imagen_proveedor, imagen_cuenta, imagen_id_publico, imagen_version, imagen_extension)),
  CONSTRAINT portal_de_empresa_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT portal_de_empresa_empresa_uk UNIQUE (empresa_id),   -- un portal por empresa: dos administradores que lo crean a la vez no pueden tener dos
  CONSTRAINT portal_de_empresa_codigo_uk UNIQUE (codigo)         -- única excepción sin empresa_id: es la llave pública del QR
);

-- Tarjetas de la variante A: una fila por (portal, sucursal). Se ocultan, no se borran.
CREATE TABLE IF NOT EXISTS portal_tarjeta (
  portal_id      uuid NOT NULL,
  sucursal_id    uuid NOT NULL,
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  orden          integer NOT NULL CONSTRAINT portal_tarjeta_orden_ck CHECK (orden >= 0),
  visible        boolean NOT NULL DEFAULT true,
  -- NULL = el nombre de la carta de esa sucursal.
  nombre         text CONSTRAINT portal_tarjeta_nombre_ck CHECK (nombre IS NULL OR texto_de_catalogo_valido(nombre, 80)),
  -- Misma regla que `sucursal_telefono_ck` (0019): una línea, 1 a 40, sin controles.
  telefono       text CONSTRAINT portal_tarjeta_telefono_ck CHECK (
                   telefono IS NULL OR (telefono = btrim(telefono) AND char_length(telefono) BETWEEN 1 AND 40 AND telefono !~ '[\x01-\x1F\x7F-\x9F]')),
  foto_proveedor text,
  foto_cuenta    text,
  foto_id_publico text,
  foto_version   text,
  foto_extension text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  PRIMARY KEY (portal_id, sucursal_id),
  CONSTRAINT portal_tarjeta_foto_ck CHECK (imagen_externa_valida(foto_proveedor, foto_cuenta, foto_id_publico, foto_version, foto_extension)),
  CONSTRAINT portal_tarjeta_portal_fkey FOREIGN KEY (portal_id, empresa_id) REFERENCES portal_de_empresa (id, empresa_id),
  CONSTRAINT portal_tarjeta_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id)
);

-- Zonas de la variante B: rectángulos transparentes sobre la imagen. Posición y tamaño en % (0 a 100), con dos decimales.
CREATE TABLE IF NOT EXISTS portal_zona (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: idempotencia del alta
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  portal_id      uuid NOT NULL,
  sucursal_id    uuid NOT NULL,                                -- la sucursal a la que lleva
  x              numeric(5, 2) NOT NULL CONSTRAINT portal_zona_x_ck CHECK (x >= 0 AND x <= 100),
  y              numeric(5, 2) NOT NULL CONSTRAINT portal_zona_y_ck CHECK (y >= 0 AND y <= 100),
  ancho          numeric(5, 2) NOT NULL CONSTRAINT portal_zona_ancho_ck CHECK (ancho > 0 AND ancho <= 100),
  alto           numeric(5, 2) NOT NULL CONSTRAINT portal_zona_alto_ck CHECK (alto > 0 AND alto <= 100),
  visible        boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT portal_zona_dentro_ck CHECK (x + ancho <= 100 AND y + alto <= 100),
  CONSTRAINT portal_zona_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT portal_zona_destino_uk UNIQUE (portal_id, sucursal_id),   -- SUPUESTO (DEC-0481): una zona por sucursal (la maqueta dibuja una por restaurante)
  CONSTRAINT portal_zona_portal_fkey FOREIGN KEY (portal_id, empresa_id) REFERENCES portal_de_empresa (id, empresa_id),
  CONSTRAINT portal_zona_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Disparadores: la identidad no cambia; la versión sube sola; nada se borra ni se vacía.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION portal_de_empresa_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION 'el código de un portal no cambia: los QR impresos dejarían de andar'
      USING ERRCODE = '23514', CONSTRAINT = 'portal_de_empresa_codigo_inmutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'la identidad de un portal no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'portal_de_empresa_identidad_inmutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION portal_hijo_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  -- Sirve a `portal_tarjeta` y a `portal_zona`: el portal y la empresa no cambian (mover una fila a otro portal mostraría lo que nadie pidió mostrar).
  IF NEW.portal_id IS DISTINCT FROM OLD.portal_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'el portal y la empresa de una tarjeta o una zona no cambian'
      USING ERRCODE = '23514', CONSTRAINT = 'portal_hijo_identidad_inmutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION portal_tarjeta_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id THEN
    RAISE EXCEPTION 'la sucursal de una tarjeta no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'portal_tarjeta_sucursal_inmutable';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS portal_de_empresa_cambio ON portal_de_empresa;
CREATE TRIGGER portal_de_empresa_cambio BEFORE UPDATE ON portal_de_empresa FOR EACH ROW EXECUTE FUNCTION portal_de_empresa_validar();
DROP TRIGGER IF EXISTS portal_de_empresa_version ON portal_de_empresa;
CREATE TRIGGER portal_de_empresa_version BEFORE UPDATE ON portal_de_empresa FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
DROP TRIGGER IF EXISTS portal_tarjeta_cambio ON portal_tarjeta;
CREATE TRIGGER portal_tarjeta_cambio BEFORE UPDATE ON portal_tarjeta FOR EACH ROW EXECUTE FUNCTION portal_hijo_validar();
DROP TRIGGER IF EXISTS portal_tarjeta_cambio_sucursal ON portal_tarjeta;
CREATE TRIGGER portal_tarjeta_cambio_sucursal BEFORE UPDATE ON portal_tarjeta FOR EACH ROW EXECUTE FUNCTION portal_tarjeta_validar();
DROP TRIGGER IF EXISTS portal_tarjeta_version ON portal_tarjeta;
CREATE TRIGGER portal_tarjeta_version BEFORE UPDATE ON portal_tarjeta FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
DROP TRIGGER IF EXISTS portal_zona_cambio ON portal_zona;
CREATE TRIGGER portal_zona_cambio BEFORE UPDATE ON portal_zona FOR EACH ROW EXECUTE FUNCTION portal_hijo_validar();
DROP TRIGGER IF EXISTS portal_zona_version ON portal_zona;
CREATE TRIGGER portal_zona_version BEFORE UPDATE ON portal_zona FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

DROP TRIGGER IF EXISTS portal_de_empresa_sin_borrado ON portal_de_empresa;
CREATE TRIGGER portal_de_empresa_sin_borrado BEFORE DELETE ON portal_de_empresa FOR EACH ROW EXECUTE FUNCTION sin_borrado();
DROP TRIGGER IF EXISTS portal_de_empresa_sin_truncate ON portal_de_empresa;
CREATE TRIGGER portal_de_empresa_sin_truncate BEFORE TRUNCATE ON portal_de_empresa FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
DROP TRIGGER IF EXISTS portal_tarjeta_sin_borrado ON portal_tarjeta;
CREATE TRIGGER portal_tarjeta_sin_borrado BEFORE DELETE ON portal_tarjeta FOR EACH ROW EXECUTE FUNCTION sin_borrado();
DROP TRIGGER IF EXISTS portal_tarjeta_sin_truncate ON portal_tarjeta;
CREATE TRIGGER portal_tarjeta_sin_truncate BEFORE TRUNCATE ON portal_tarjeta FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
DROP TRIGGER IF EXISTS portal_zona_sin_borrado ON portal_zona;
CREATE TRIGGER portal_zona_sin_borrado BEFORE DELETE ON portal_zona FOR EACH ROW EXECUTE FUNCTION sin_borrado();
DROP TRIGGER IF EXISTS portal_zona_sin_truncate ON portal_zona;
CREATE TRIGGER portal_zona_sin_truncate BEFORE TRUNCATE ON portal_zona FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna; nadie recibe DELETE ni TRUNCATE.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON portal_de_empresa, portal_tarjeta, portal_zona FROM PUBLIC;

GRANT SELECT ON portal_de_empresa, portal_tarjeta, portal_zona TO pedernal_app;
GRANT INSERT (id, empresa_id, codigo, variante, linea_superior, titulo, color_encabezado, color_pagina, color_detras, logo_visible,
              imagen_proveedor, imagen_cuenta, imagen_id_publico, imagen_version, imagen_extension, creado_por) ON portal_de_empresa TO pedernal_app;
GRANT UPDATE (variante, linea_superior, titulo, color_encabezado, color_pagina, color_detras, logo_visible,
              imagen_proveedor, imagen_cuenta, imagen_id_publico, imagen_version, imagen_extension) ON portal_de_empresa TO pedernal_app;
GRANT INSERT (portal_id, sucursal_id, empresa_id, orden, visible, nombre, telefono, foto_proveedor, foto_cuenta, foto_id_publico, foto_version, foto_extension)
  ON portal_tarjeta TO pedernal_app;
GRANT UPDATE (orden, visible, nombre, telefono, foto_proveedor, foto_cuenta, foto_id_publico, foto_version, foto_extension) ON portal_tarjeta TO pedernal_app;
GRANT INSERT (id, empresa_id, portal_id, sucursal_id, x, y, ancho, alto, visible) ON portal_zona TO pedernal_app;
GRANT UPDATE (sucursal_id, x, y, ancho, alto, visible) ON portal_zona TO pedernal_app;

-- El rol público: solo lo que el portal muestra de sí mismo. Ni quién lo creó, ni cuándo, ni la versión.
GRANT SELECT (id, empresa_id, codigo, variante, linea_superior, titulo, color_encabezado, color_pagina, color_detras, logo_visible,
              imagen_proveedor, imagen_cuenta, imagen_id_publico, imagen_version, imagen_extension) ON portal_de_empresa TO pedernal_publico;
GRANT SELECT (portal_id, sucursal_id, empresa_id, orden, visible, nombre, telefono, foto_proveedor, foto_cuenta, foto_id_publico, foto_version, foto_extension)
  ON portal_tarjeta TO pedernal_publico;
GRANT SELECT (id, empresa_id, portal_id, sucursal_id, x, y, ancho, alto, visible) ON portal_zona TO pedernal_publico;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada; sin política no hay acceso.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE portal_de_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_de_empresa FORCE ROW LEVEL SECURITY;
ALTER TABLE portal_tarjeta ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_tarjeta FORCE ROW LEVEL SECURITY;
ALTER TABLE portal_zona ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_zona FORCE ROW LEVEL SECURITY;

-- Políticas de la aplicación (mismo patrón que carta_publica).
DROP POLICY IF EXISTS portal_de_empresa_app_leer ON portal_de_empresa;
CREATE POLICY portal_de_empresa_app_leer ON portal_de_empresa FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
DROP POLICY IF EXISTS portal_de_empresa_app_alta ON portal_de_empresa;
CREATE POLICY portal_de_empresa_app_alta ON portal_de_empresa FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
DROP POLICY IF EXISTS portal_de_empresa_app_cambiar ON portal_de_empresa;
CREATE POLICY portal_de_empresa_app_cambiar ON portal_de_empresa FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

DROP POLICY IF EXISTS portal_tarjeta_app_leer ON portal_tarjeta;
CREATE POLICY portal_tarjeta_app_leer ON portal_tarjeta FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
DROP POLICY IF EXISTS portal_tarjeta_app_alta ON portal_tarjeta;
CREATE POLICY portal_tarjeta_app_alta ON portal_tarjeta FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
DROP POLICY IF EXISTS portal_tarjeta_app_cambiar ON portal_tarjeta;
CREATE POLICY portal_tarjeta_app_cambiar ON portal_tarjeta FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

DROP POLICY IF EXISTS portal_zona_app_leer ON portal_zona;
CREATE POLICY portal_zona_app_leer ON portal_zona FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
DROP POLICY IF EXISTS portal_zona_app_alta ON portal_zona;
CREATE POLICY portal_zona_app_alta ON portal_zona FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
DROP POLICY IF EXISTS portal_zona_app_cambiar ON portal_zona;
CREATE POLICY portal_zona_app_cambiar ON portal_zona FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

-- Políticas del rol público. `current_setting(…, true)` da NULL si no se fijó: no compara igual a nada (no se pueden recorrer portales probando códigos).
DROP POLICY IF EXISTS portal_de_empresa_publico_leer ON portal_de_empresa;
CREATE POLICY portal_de_empresa_publico_leer ON portal_de_empresa FOR SELECT TO pedernal_publico
  USING (codigo = current_setting('app.codigo_de_portal', true));

-- Quien lee UNA carta (con su código) puede leer el portal de SU empresa: lo necesita para el enlace «volver al portal» (`hrefDelPortal`, pedido de la sesión del Libro).
-- Expone solo las columnas ya otorgadas (el código del portal es público por diseño: está en su QR).
DROP POLICY IF EXISTS portal_de_empresa_publico_de_carta ON portal_de_empresa;
CREATE POLICY portal_de_empresa_publico_de_carta ON portal_de_empresa FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = portal_de_empresa.empresa_id
  ));

-- Las cartas EN_LINEA de la empresa del portal pedido (el portal las lista y enlaza). Se SUMA a la política de 0043 (las políticas permisivas se combinan con «o»):
-- el código de la carta sigue siendo la llave para ver UNA carta; esta deja ver, con las mismas columnas ya otorgadas, las cartas en línea de ESA empresa y de ninguna otra.
DROP POLICY IF EXISTS carta_publica_publico_de_portal ON carta_publica;
CREATE POLICY carta_publica_publico_de_portal ON carta_publica FOR SELECT TO pedernal_publico
  USING (estado = 'EN_LINEA' AND EXISTS (
    SELECT 1 FROM public.portal_de_empresa p
     WHERE p.codigo = current_setting('app.codigo_de_portal', true) AND p.empresa_id = carta_publica.empresa_id
  ));

-- La sucursal solo si está abierta Y tiene su carta en línea (la subconsulta pasa por la política anterior): una sucursal cerrada no aparece en el portal.
DROP POLICY IF EXISTS sucursal_publico_de_portal ON sucursal;
CREATE POLICY sucursal_publico_de_portal ON sucursal FOR SELECT TO pedernal_publico
  USING (activa AND EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.sucursal_id = sucursal.id AND c.empresa_id = sucursal.empresa_id
       AND c.estado = 'EN_LINEA'
       AND EXISTS (SELECT 1 FROM public.portal_de_empresa p
                    WHERE p.codigo = current_setting('app.codigo_de_portal', true) AND p.empresa_id = c.empresa_id)
  ));

-- Tarjetas y zonas visibles de ese portal, y solo de sucursales que el portal puede mostrar (abiertas y con carta en línea).
DROP POLICY IF EXISTS portal_tarjeta_publico_leer ON portal_tarjeta;
CREATE POLICY portal_tarjeta_publico_leer ON portal_tarjeta FOR SELECT TO pedernal_publico
  USING (visible AND EXISTS (
    SELECT 1 FROM public.portal_de_empresa p
      JOIN public.sucursal s ON s.id = portal_tarjeta.sucursal_id AND s.empresa_id = p.empresa_id
     WHERE p.id = portal_tarjeta.portal_id AND p.empresa_id = portal_tarjeta.empresa_id
       AND p.codigo = current_setting('app.codigo_de_portal', true)
  ));
DROP POLICY IF EXISTS portal_zona_publico_leer ON portal_zona;
CREATE POLICY portal_zona_publico_leer ON portal_zona FOR SELECT TO pedernal_publico
  USING (visible AND EXISTS (
    SELECT 1 FROM public.portal_de_empresa p
      JOIN public.sucursal s ON s.id = portal_zona.sucursal_id AND s.empresa_id = p.empresa_id
     WHERE p.id = portal_zona.portal_id AND p.empresa_id = portal_zona.empresa_id
       AND p.codigo = current_setting('app.codigo_de_portal', true)
  ));
