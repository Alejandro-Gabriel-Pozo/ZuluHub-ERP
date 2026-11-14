-- 0049_producto_oculto_en_stock: un producto OCULTO no recibe existencia ni se cuenta (carta real, T9; stock).
-- Decisiones del dueño: 12/11/2026 («ocultar… que no aparezca ni en conteos, ni en carta/pos; si tenía stock no debería dejar»,
-- `decisiones-del-dueno-2026-11.md`) y 13/11/2026 (un producto oculto NO recibe existencia: se rechazan las entradas, la recepción de compra, la producción, la
-- transferencia entrante y el ajuste positivo; para recibir mercadería primero se vuelve a mostrar el producto). Especificación: `carta-real-especificacion.md` §3.2b y §6.5.
--
-- Qué hace la base (el código de cada caso de uso repite lo mismo para dar un error claro; esto es la restricción que NO depende del código):
--  * Un renglón de movimiento que SUMA existencia a un artículo cuyo producto está oculto en la sucursal del depósito (la empresa lo oculta o ese local lo oculta) se
--    rechaza: `renglon_producto_oculto`. «Suma» es que el saldo del depósito quede POR ENCIMA de cero: restar, o corregir un negativo hasta cero, se permite
--    (una venta ya cargada que se cobra después de ocultar deja negativo, y devolverlo no es sumar existencia a un oculto).
--  * Un registro de conteo de un artículo cuyo producto está oculto en la sucursal del depósito contado se rechaza: `conteo_registro_producto_oculto`.
--  * Sin fila de disponibilidad (nunca se tocó), el producto está visible: no cambia nada para quien no usa el botón.
--
-- Concurrencia: los dos disparadores LEEN `disponibilidad_de_producto`; `ocultarProducto` LEE los saldos y los conteos antes de escribir esa fila. Bajo serializable, si se cruzan
-- uno de los dos se rechaza o se repite (conflicto de serialización): nunca quedan las dos cosas (oculto y con existencia). Lo prueba `test/integracion/stock-producto-oculto.test.ts`.
--
-- Reglas de esta migración (las de 0030): ADITIVA (solo dos funciones y dos disparadores nuevos; no toca ninguna fila ni columna), sin SECURITY DEFINER (las funciones fijan
-- `search_path` y califican con `public.`; leen con los permisos de quien escribe, que ya puede leer estas tablas), sin DELETE ni TRUNCATE nuevos.
-- Su reversión es un script aparte, revisado: `migraciones/reversiones/0049_revertir_producto_oculto_en_stock.sql` (NO es destructiva: no hay datos propios).
-- DEPENDE de 0030 (stock) y 0043 (disponibilidad del producto); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.renglon_de_movimiento') IS NULL OR to_regclass('public.conteo_registro') IS NULL OR to_regclass('public.disponibilidad_de_producto') IS NULL THEN
    RAISE EXCEPTION 'el producto oculto en stock requiere 0030_stock y 0043_carta_publica aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.renglon_validar_producto_oculto()') IS NOT NULL OR to_regprocedure('public.conteo_registro_validar_producto_oculto()') IS NOT NULL THEN
    RAISE EXCEPTION 'el producto oculto en stock nace en 0049: las funciones ya existen (alguien las creó a mano); hay que revisarlas antes de migrar' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ¿El producto del artículo está oculto en la sucursal del depósito? (la empresa lo oculta, o ese local). Una sola definición para los dos disparadores.
CREATE FUNCTION producto_oculto_en_el_deposito(p_empresa uuid, p_articulo uuid, p_deposito uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1
      FROM public.articulo_de_stock a
      JOIN public.deposito d ON d.id = p_deposito AND d.empresa_id = p_empresa
      JOIN public.disponibilidad_de_producto x ON x.empresa_id = a.empresa_id AND x.producto_id = a.producto_id
     WHERE a.id = p_articulo AND a.empresa_id = p_empresa
       AND x.oculto AND (x.sucursal_id IS NULL OR x.sucursal_id = d.sucursal_id)
  )
$$;
REVOKE ALL ON FUNCTION producto_oculto_en_el_deposito(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION producto_oculto_en_el_deposito(uuid, uuid, uuid) TO pedernal_app;

-- Renglón (antes de insertar): suma de existencia a un producto oculto. Corre DESPUÉS de `renglon_de_movimiento_alta` (alfabético): ya están validados el depósito y el artículo.
CREATE FUNCTION renglon_validar_producto_oculto() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_existencia numeric;
BEGIN
  IF NEW.cantidad > 0 AND public.producto_oculto_en_el_deposito(NEW.empresa_id, NEW.articulo_id, NEW.deposito_id) THEN
    SELECT coalesce((SELECT s.existencia FROM public.saldo_de_stock s
                      WHERE s.empresa_id = NEW.empresa_id AND s.deposito_id = NEW.deposito_id AND s.articulo_id = NEW.articulo_id), 0)
      INTO v_existencia;
    IF v_existencia + NEW.cantidad > 0 THEN
      RAISE EXCEPTION 'un producto oculto no recibe existencia: primero hay que volver a mostrarlo'
        USING ERRCODE = '23514', CONSTRAINT = 'renglon_producto_oculto';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION renglon_validar_producto_oculto() FROM PUBLIC;
CREATE TRIGGER renglon_de_movimiento_oculto BEFORE INSERT ON renglon_de_movimiento
  FOR EACH ROW EXECUTE FUNCTION renglon_validar_producto_oculto();

-- Registro de conteo (antes de insertar): un producto oculto en la sucursal del depósito contado no se cuenta. Corre DESPUÉS de `conteo_registro_alta`.
CREATE FUNCTION conteo_registro_validar_producto_oculto() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_deposito uuid;
BEGIN
  SELECT c.deposito_id INTO v_deposito FROM public.conteo_fisico c WHERE c.id = NEW.conteo_id AND c.empresa_id = NEW.empresa_id;
  IF v_deposito IS NOT NULL AND public.producto_oculto_en_el_deposito(NEW.empresa_id, NEW.articulo_id, v_deposito) THEN
    RAISE EXCEPTION 'un producto oculto no se cuenta: primero hay que volver a mostrarlo'
      USING ERRCODE = '23514', CONSTRAINT = 'conteo_registro_producto_oculto';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION conteo_registro_validar_producto_oculto() FROM PUBLIC;
CREATE TRIGGER conteo_registro_oculto BEFORE INSERT ON conteo_registro
  FOR EACH ROW EXECUTE FUNCTION conteo_registro_validar_producto_oculto();
