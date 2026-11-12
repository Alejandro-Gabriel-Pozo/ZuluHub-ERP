-- 0044_lectura_publica_de_carta: lo que el rol público (`pedernal_publico`) necesita leer del catálogo para servir una carta en línea (T3 de la carta real).
-- Especificación: Pedernal-docs/11-especificaciones/carta-real-especificacion.md §3.3 (qué se lee y con qué filtro) y §4 (el adaptador). Solo LECTURA: ningún
-- INSERT, UPDATE, DELETE ni función nueva. 0043 ya le dio `carta_publica` y `disponibilidad_de_producto`; acá se suman las demás tablas que la carta toca.
--
-- Cómo queda cerrado (denegar por defecto):
--  * Por COLUMNA: cada tabla se otorga con la lista exacta de columnas de §3.3; nunca `SELECT` de tabla entera. Una prueba enumera lo otorgado y falla si hay una más.
--  * Por FILA: cada política deja ver solo las filas alcanzables desde la carta cuyo `codigo` es igual a `app.codigo_de_carta` (lo fija la lectura pública dentro de su
--    transacción con `set_config(…, true)`) y que está `EN_LINEA` (la política de `carta_publica` de 0043). Sin ese valor NINGUNA tabla devuelve filas: no se pueden
--    recorrer cartas probando códigos. Cada política vuelve a mirar `carta_publica` con su propia política: no hay camino que se salte el «en línea».
--  * Una carta de otra empresa, un producto de otra empresa y un precio de otra sucursal no se ven jamás: todas las políticas amarran la empresa de la carta (y, en los
--    precios y la disponibilidad, la sucursal de la carta o la empresa entera).
--  * Nunca se otorga: alícuota, código, código de barras, unidad, nombre de cocina, `se_vende`, `falta_completar` (producto); qué insumo consume una opción
--    (`consumo_de_opcion`) ni su factor de tamaño; nada de stock ni de ventas.
--  * `precio_vigente` (la ÚNICA lectura del precio vigente, la misma que usa la caja) se ejecuta con los permisos de quien la llama (no es SECURITY DEFINER). Su cuerpo
--    lee la fila entera (`SELECT s.*`), así que el rol público recibe TODAS las columnas de `precio_de_venta` (incluida `cargado_por`, un id de persona que NUNCA sale
--    del adaptador). Es el costo de que carta y caja usen la misma cuenta (T-5); la alternativa es reimplementar la vigencia en TypeScript. Ver la pregunta en la entrega.
--
-- Su reversión es un script aparte: `migraciones/reversiones/0044_revertir_lectura_publica_de_carta.sql` (sin pérdida de datos: solo quita permisos y políticas).
-- DEPENDE de 0025 (catálogo), 0007 (rol público) y 0043 (carta pública); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.carta_publica') IS NULL OR to_regclass('public.disponibilidad_de_producto') IS NULL THEN
    RAISE EXCEPTION 'la lectura pública de la carta requiere 0043_carta_publica aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.precio_vigente(uuid, uuid, uuid, uuid, timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'la lectura pública de la carta requiere 0025_catalogo aplicada antes (falta precio_vigente)' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_publico') THEN
    RAISE EXCEPTION 'la lectura pública de la carta requiere el rol pedernal_publico (0007)' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, solo SELECT.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT (id, tenant_id, estado) ON empresa TO pedernal_publico;
GRANT SELECT (id, estado, marca_id) ON tenant TO pedernal_publico;
GRANT SELECT (id, empresa_id, activa) ON sucursal TO pedernal_publico;
GRANT SELECT (id, empresa_id, nombre, orden, activa) ON seccion_de_carta TO pedernal_publico;
GRANT SELECT (id, empresa_id, nombre, nombre_clave, descripcion_en_carta, seccion_de_carta_id, activo, clase_de_uso) ON producto TO pedernal_publico;
GRANT SELECT (id, empresa_id, producto_id, clase, nombre, es_obligatorio, orden, activo, se_muestra_en_carta) ON grupo_de_elecciones TO pedernal_publico;
GRANT SELECT (id, empresa_id, grupo_id, orden, activa) ON opcion TO pedernal_publico;
GRANT SELECT (empresa_id, opcion_id, numero, nombre, recargo) ON version_de_opcion TO pedernal_publico;
-- Todas las columnas: lo exige `precio_vigente` (ver arriba).
GRANT SELECT (id, empresa_id, producto_id, opcion_id, sucursal_id, precio, unidad_id, paso_minimo, moneda, iva_incluido, vigente_desde, cargado_por, creado_en)
  ON precio_de_venta TO pedernal_publico;
GRANT EXECUTE ON FUNCTION precio_vigente(uuid, uuid, uuid, uuid, timestamptz) TO pedernal_publico;

-- ---------------------------------------------------------------------------------------------
-- Políticas del rol público. `current_setting(…, true)` da NULL si no se fijó: no compara igual a nada. Cada una pasa por `carta_publica`, que ya está filtrada a
-- la carta pedida y en línea.
-- ---------------------------------------------------------------------------------------------
CREATE POLICY empresa_publico_de_carta ON empresa FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = empresa.id
  ));

CREATE POLICY tenant_publico_de_carta ON tenant FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c JOIN public.empresa e ON e.id = c.empresa_id
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND e.tenant_id = tenant.id
  ));

-- La sucursal de la carta y solo si está abierta: una sucursal cerrada no se sirve (misma respuesta que un código inventado).
CREATE POLICY sucursal_publico_de_carta ON sucursal FOR SELECT TO pedernal_publico
  USING (activa AND EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.sucursal_id = sucursal.id AND c.empresa_id = sucursal.empresa_id
  ));

CREATE POLICY seccion_de_carta_publico_de_carta ON seccion_de_carta FOR SELECT TO pedernal_publico
  USING (activa AND EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = seccion_de_carta.empresa_id
  ));

-- Solo lo que se vende (vendible y reventa), activo y con sección. Un producto desactivado o sin sección no sale de la base.
CREATE POLICY producto_publico_de_carta ON producto FOR SELECT TO pedernal_publico
  USING (activo AND seccion_de_carta_id IS NOT NULL AND clase_de_uso IN ('VENDIBLE', 'REVENTA') AND EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = producto.empresa_id
  ));

-- Los grupos que no se muestran en la carta no salen de la base.
CREATE POLICY grupo_de_elecciones_publico_de_carta ON grupo_de_elecciones FOR SELECT TO pedernal_publico
  USING (activo AND se_muestra_en_carta AND EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = grupo_de_elecciones.empresa_id
  ));

CREATE POLICY opcion_publico_de_carta ON opcion FOR SELECT TO pedernal_publico
  USING (activa AND EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = opcion.empresa_id
  ));

CREATE POLICY version_de_opcion_publico_de_carta ON version_de_opcion FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = version_de_opcion.empresa_id
  ));

-- Los precios de la empresa y los propios de la SUCURSAL de la carta; nunca los de otro local.
CREATE POLICY precio_de_venta_publico_de_carta ON precio_de_venta FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = precio_de_venta.empresa_id
       AND (precio_de_venta.sucursal_id IS NULL OR precio_de_venta.sucursal_id = c.sucursal_id)
  ));
