-- 0043_carta_publica: lo que hace falta en la base para que la carta pública (`/s/carta/<código>`) y el botón «Ocultar» funcionen contra datos reales
-- de una empresa (T0 y T1 de la especificación de la carta real). Aditiva: dos tablas nuevas y la ampliación de UNA lista de permitidos.
-- Especificación: Pedernal-docs/11-especificaciones/carta-real-especificacion.md (§3.2, §3.2b, §3.3, §3.4, §3.5, §12 T-2, T-3, T-4 y T-8; T0 = Q3 del dueño).
--
--  T0. `texto_de_catalogo_valido` admite además `¿ ¡ ? ! % $` (dueño, Q3 del 12/11/2026): los nombres reales de una carta («¿Querés papas?», «Combo 2x1 50% $500»).
--      Es la copia en la base de la lista de CATÁLOGO de `src/primitivas/texto/texto-de-una-linea.ts` (la base más esos seis signos: `soloCaracteresPermitidosDeCatalogo`; una prueba las compara carácter por carácter). Razón social, domicilio, notas y motivos NO la usan en TypeScript y siguen sin esos signos (dueño: solo catálogo). `CREATE OR REPLACE`
--      conserva el EXECUTE de `pedernal_app` y no toca ninguna fila: lo que ya estaba guardado sigue válido (la lista solo se ensancha).
--  T1. `carta_publica`: la carta en línea de una sucursal (una fila = una sucursal), con su código de QR no adivinable. `disponibilidad_de_producto`: el botón
--      «Ocultar»: una fila = «este producto está oculto (o se volvió a mostrar) en este alcance»; `sucursal_id` NULO = toda la empresa; sin fila = visible.
--
-- Reglas de esta migración (las mismas de 0025):
--  * Nace en forma final: no hay `ALTER` de tablas existentes ni copia de datos. Lo único existente que se toca es la función de texto (T0) y se da UNA lectura
--    nueva al rol público, solo sobre estas dos tablas y por columna (ver «Lectura pública»).
--  * Ninguna función SECURITY DEFINER. Toda función fija `search_path = pg_catalog, public, pg_temp`, califica sus tablas con `public.` y nace sin EXECUTE
--    para PUBLIC (0001: `ALTER DEFAULT PRIVILEGES`); nadie las llama fuera de un disparador.
--  * Nadie recibe DELETE ni TRUNCATE: una carta se retira (`FUERA_DE_LINEA`), un producto se vuelve a mostrar (`oculto = false`); los disparadores frenan
--    el borrado y el vaciado aun al dueño de la base (como el resto del catálogo).
--  * RLS activa y FORZADA; una política por comando, ninguna `FOR ALL`. INSERT y UPDATE por columna.
--  * Toda única de una tabla con `empresa_id` lo incluye, SALVO `carta_publica_codigo_uk` (UNIQUE (codigo)): el código es la llave pública del QR y tiene
--    que ser único en TODA la plataforma, o dos empresas podrían tener el mismo QR (única excepción, declarada con su motivo en el meta-test del catálogo).
--    Toda clave foránea entre tablas de empresa es COMPUESTA `(x_id, empresa_id)`.
--  * Dinero: no hay. Fechas: `timestamptz` (UTC); la carta pública no tiene corte de día.
--  * Su reversión es un script aparte, revisado: `migraciones/reversiones/0043_revertir_carta_publica.sql` (DESTRUCTIVA con filas: los QR impresos dejarían de andar).
--  * DEPENDE de 0001, 0005, 0007 y 0025; se comprueba al empezar.
--
-- Decisiones de diseño (todas probadas por tests):
--
--  C1. El `id` de la carta lo manda la aplicación (es la idempotencia del alta y la semilla de la dirección de cada producto): no cambia nunca. El `codigo` y la
--      `sucursal_id` tampoco (disparador, aun contra el dueño de la base): cambiar el código rompería los QR impresos; cambiar la sucursal movería una carta
--      con sus precios a otro local.
--  C2. Una carta por sucursal (`UNIQUE (empresa_id, sucursal_id)`): dos personas que la crean a la vez no pueden tener dos.
--  C3. El `codigo` es texto de 22 a 64 caracteres base64url (el alfabeto `A-Za-z0-9_-`). 22 es lo que da el azar de 128 bits; este CHECK solo exige la FORMA: el
--      azar lo genera la aplicación (un puerto), y que no sea adivinable no lo puede probar la base.
--  D1. `disponibilidad_de_producto` fija un ESTADO (no alterna): dos filas para el mismo (producto, alcance) son imposibles (dos índices únicos parciales, porque
--      una clave primaria no admite el nulo de «toda la empresa»), y escribir es `INSERT … ON CONFLICT DO UPDATE`. Las dos únicas llevan `empresa_id` (regla
--      de arriba): el par (empresa, producto) es tan único como el producto.
--  D2. «Oculto» y «desactivado» (`producto.activo`) son independientes: esta tabla no toca ni el nombre, ni los precios, ni `activo`.
--  D3. `actualizado_en` lo pone la aplicación (el reloj de la composición: las pruebas fijan el instante); la `version` la sube el disparador y nadie más.
--  D4. El invariante «un producto oculto no tiene existencia distinta de cero» NO se impone acá: depende de stock (T2 al ocultar, T9 al sumar existencia).
--
-- Lectura pública (T-4): `pedernal_publico` lee, por columna, SOLO estas dos tablas, y solo la carta cuyo `codigo` es igual a `app.codigo_de_carta` (lo fija la
-- lectura pública dentro de su transacción con `set_config(…, true)`) y que está `EN_LINEA`. Sin ese valor ninguna tabla devuelve filas: no se pueden recorrer
-- cartas probando códigos. Las demás tablas que la carta necesita (sucursal, producto, sección, precios…) se le dan en T3 con su propia prueba; acá no.

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.sucursal') IS NULL OR to_regclass('public.persona') IS NULL OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL THEN
    RAISE EXCEPTION 'la carta pública requiere 0001 y 0005 aplicadas antes (faltan la sucursal, la persona y las funciones base)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.sin_borrado()') IS NULL THEN
    RAISE EXCEPTION 'la carta pública requiere 0007_marcas_y_planes aplicada antes (falta sin_borrado())'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.producto') IS NULL OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'la carta pública requiere 0025_catalogo aplicada antes (falta el producto o la función de texto)'
      USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['carta_publica', 'disponibilidad_de_producto'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'la carta pública nace en 0043: la tabla % ya existe (alguien la creó a mano); hay que revisarla antes de migrar', v_tabla
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- T0: la lista de permitidos de los textos del catálogo, con `¿ ¡ ? ! % $`. Es la de 0025 más esos seis signos, en las dos clases (la del primer carácter y la
-- del resto); el primer carácter sigue sin poder ser `+` ni `-`.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION texto_de_catalogo_valido(t text, p_maximo integer) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR p_maximo IS NULL OR char_length(t) NOT BETWEEN 1 AND p_maximo THEN false
    ELSE t = btrim(t)
      AND t ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°:;"#ºª’“”–—«»®™¿¡?!%$''][A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°+:;"#ºª’“”–—«»®™¿¡?!%$'' -]*$'
  END
$$;

-- ---------------------------------------------------------------------------------------------
-- La carta pública: una fila = la carta en línea de una sucursal.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE carta_publica (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia del alta y la semilla de la dirección de cada producto
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  sucursal_id    uuid NOT NULL,
  codigo         text NOT NULL CONSTRAINT carta_publica_codigo_ck CHECK (codigo ~ '^[A-Za-z0-9_-]{22,64}$'),
  nombre         text NOT NULL CONSTRAINT carta_publica_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 80)),
  rubro          text CONSTRAINT carta_publica_rubro_ck CHECK (rubro IS NULL OR texto_de_catalogo_valido(rubro, 40)),
  lugar          text CONSTRAINT carta_publica_lugar_ck CHECK (lugar IS NULL OR texto_de_catalogo_valido(lugar, 120)),
  -- La tercera línea de la portada (abajo de todo): texto libre del dueño, p. ej. «Desliza para ver el menú». NULL = sin mensaje (la pantalla muestra el adorno de siempre).
  mensaje_de_portada text CONSTRAINT carta_publica_mensaje_ck CHECK (mensaje_de_portada IS NULL OR texto_de_catalogo_valido(mensaje_de_portada, 60)),
  estado         text NOT NULL DEFAULT 'FUERA_DE_LINEA' CONSTRAINT carta_publica_estado_ck CHECK (estado IN ('EN_LINEA', 'FUERA_DE_LINEA')),
  creado_por     uuid REFERENCES persona (id),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT carta_publica_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT carta_publica_sucursal_uk UNIQUE (empresa_id, sucursal_id),
  -- Única en TODA la plataforma (sin `empresa_id`): es la llave pública del QR. Ver la cabecera.
  CONSTRAINT carta_publica_codigo_uk UNIQUE (codigo),
  CONSTRAINT carta_publica_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- El botón «Ocultar»: una fila por (producto, alcance). `sucursal_id` NULO = toda la empresa. Sin fila = visible.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE disponibilidad_de_producto (
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  producto_id     uuid NOT NULL,
  sucursal_id     uuid,
  oculto          boolean NOT NULL,
  actualizado_por uuid REFERENCES persona (id),
  actualizado_en  timestamptz NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT disponibilidad_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT disponibilidad_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id)
);
-- Nunca dos filas para el mismo par: lo que hace seguro apretar dos veces y que dos personas lo hagan a la vez (`ON CONFLICT … DO UPDATE`).
CREATE UNIQUE INDEX disponibilidad_de_la_empresa_uk ON disponibilidad_de_producto (empresa_id, producto_id) WHERE sucursal_id IS NULL;
CREATE UNIQUE INDEX disponibilidad_del_local_uk ON disponibilidad_de_producto (empresa_id, producto_id, sucursal_id) WHERE sucursal_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- Disparadores: invariantes que la base impone aunque el código se olvide
-- ---------------------------------------------------------------------------------------------

-- Carta: la identidad no cambia (el código y la sucursal son lo que el QR impreso y los precios dan por fijo). Los nombres se eligen para que `_cambio`
-- corra antes que `_version` (orden alfabético).
CREATE FUNCTION carta_publica_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION 'el código de una carta no cambia: los QR impresos dejarían de andar'
      USING ERRCODE = '23514', CONSTRAINT = 'carta_publica_codigo_inmutable';
  END IF;
  IF NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id THEN
    RAISE EXCEPTION 'una carta no cambia de sucursal'
      USING ERRCODE = '23514', CONSTRAINT = 'carta_publica_sucursal_inmutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'la identidad de una carta no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'carta_publica_identidad_inmutable';
  END IF;
  RETURN NEW;
END
$$;

-- Disponibilidad: el producto, la empresa y el alcance no cambian (mover una fila de un local a otro ocultaría lo que nadie pidió ocultar). La versión sube
-- sola y no se escribe; `actualizado_en` lo manda la aplicación.
CREATE FUNCTION disponibilidad_de_producto_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.producto_id IS DISTINCT FROM OLD.producto_id
     OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id THEN
    RAISE EXCEPTION 'el producto y el alcance de una disponibilidad no cambian'
      USING ERRCODE = '23514', CONSTRAINT = 'disponibilidad_identidad_inmutable';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;

CREATE TRIGGER carta_publica_cambio BEFORE UPDATE ON carta_publica
  FOR EACH ROW EXECUTE FUNCTION carta_publica_validar();
CREATE TRIGGER carta_publica_version BEFORE UPDATE ON carta_publica
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER disponibilidad_de_producto_cambio BEFORE UPDATE ON disponibilidad_de_producto
  FOR EACH ROW EXECUTE FUNCTION disponibilidad_de_producto_validar();

-- Nada se borra ni se vacía (ni el dueño de la base): una carta se retira y un producto se vuelve a mostrar.
CREATE TRIGGER carta_publica_sin_borrado BEFORE DELETE ON carta_publica
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER carta_publica_sin_truncate BEFORE TRUNCATE ON carta_publica
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER disponibilidad_de_producto_sin_borrado BEFORE DELETE ON disponibilidad_de_producto
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER disponibilidad_de_producto_sin_truncate BEFORE TRUNCATE ON disponibilidad_de_producto
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE ni TRUNCATE.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON carta_publica, disponibilidad_de_producto FROM PUBLIC;

-- La aplicación (contexto de empresa).
GRANT SELECT ON carta_publica, disponibilidad_de_producto TO pedernal_app;
GRANT INSERT (id, empresa_id, sucursal_id, codigo, nombre, rubro, lugar, mensaje_de_portada, estado, creado_por) ON carta_publica TO pedernal_app;
GRANT UPDATE (nombre, rubro, lugar, mensaje_de_portada, estado) ON carta_publica TO pedernal_app;
GRANT INSERT (empresa_id, producto_id, sucursal_id, oculto, actualizado_por, actualizado_en) ON disponibilidad_de_producto TO pedernal_app;
GRANT UPDATE (oculto, actualizado_por, actualizado_en) ON disponibilidad_de_producto TO pedernal_app;

-- El rol público (sin contexto): solo lo que la carta publica de sí misma, por columna. Ni quién la creó ni cuándo ni la versión.
GRANT SELECT (id, empresa_id, sucursal_id, codigo, nombre, rubro, lugar, mensaje_de_portada, estado) ON carta_publica TO pedernal_publico;
GRANT SELECT (empresa_id, producto_id, sucursal_id, oculto) ON disponibilidad_de_producto TO pedernal_publico;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE carta_publica ENABLE ROW LEVEL SECURITY;
ALTER TABLE carta_publica FORCE ROW LEVEL SECURITY;
ALTER TABLE disponibilidad_de_producto ENABLE ROW LEVEL SECURITY;
ALTER TABLE disponibilidad_de_producto FORCE ROW LEVEL SECURITY;

-- Políticas de la aplicación: siempre `empresa_id = (SELECT app_empresa_id())` y, en altas y cambios, `empresa_operable(empresa_id)`; los autores con
-- `IS NOT DISTINCT FROM` la persona del contexto.
CREATE POLICY carta_publica_app_leer ON carta_publica FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY carta_publica_app_alta ON carta_publica FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY carta_publica_app_cambiar ON carta_publica FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY disponibilidad_de_producto_app_leer ON disponibilidad_de_producto FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY disponibilidad_de_producto_app_alta ON disponibilidad_de_producto FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND actualizado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY disponibilidad_de_producto_app_cambiar ON disponibilidad_de_producto FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND actualizado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );

-- Políticas del rol público: solo la carta de `app.codigo_de_carta` y en línea (`current_setting(…, true)` da NULL si no se fijó: no compara igual a nada), y de
-- la disponibilidad solo las filas de la empresa de esa carta y las de SU sucursal (nunca las de otros locales).
CREATE POLICY carta_publica_publico_leer ON carta_publica FOR SELECT TO pedernal_publico
  USING (estado = 'EN_LINEA' AND codigo = current_setting('app.codigo_de_carta', true));
CREATE POLICY disponibilidad_de_producto_publico_leer ON disponibilidad_de_producto FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true)
       AND c.empresa_id = disponibilidad_de_producto.empresa_id
       AND (disponibilidad_de_producto.sucursal_id IS NULL OR disponibilidad_de_producto.sucursal_id = c.sucursal_id)
  ));
