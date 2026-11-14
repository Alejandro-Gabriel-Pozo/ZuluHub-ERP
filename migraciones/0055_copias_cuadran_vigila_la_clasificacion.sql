-- 0055_copias_cuadran_vigila_la_clasificacion (D2 de la auditoría de salón, INTEGRACION §5): `copias_cuadran` (0038) exige que la copia de una línea conserve lo congelado de la
-- origen («no se recotiza»), pero 0047 sumó a lo congelado `departamento_id` y `camino_de_clasificacion` (decisión 60: la clasificación se copia a la venta y no cambia) y el
-- disparador no los miraba: hoy solo lo garantiza el código de `copiar-linea.ts`. Previene: un traslado o una división que reclasifica en silencio lo ya vendido.
-- Probado por `test/integracion/salon-copias-clasificacion.test.ts`.
--
-- Reglas de esta migración:
--  * Es ADITIVA y compatible hacia atrás: reemplaza el cuerpo de la función (`CREATE OR REPLACE`, misma firma, mismo `search_path`, mismos permisos y mismo disparador) sumando
--    dos comparaciones. No toca datos. Las filas existentes no se revalidan (el disparador corre al insertar una copia); una copia ya hecha con otra clasificación no se
--    corrige acá.
--  * Su reversión es `migraciones/reversiones/0055_revertir_copias_cuadran_vigila_la_clasificacion.sql` (devuelve la función de 0038; no destruye nada).
-- DEPENDE de 0038 y 0047; se comprueba al empezar.

DO $$
BEGIN
  IF to_regprocedure('public.copias_cuadran()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name = 'camino_de_clasificacion'
  ) THEN
    RAISE EXCEPTION 'esta migración requiere 0038_salon y 0047_camino_en_el_renglon aplicadas antes' USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION copias_cuadran() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_origen public.linea_cuenta%ROWTYPE;
  v_modos integer;
  v_modo text;
  v_copias integer;
  v_suma_cantidad numeric;
  v_suma_fijo numeric;
  v_con_stock integer;
BEGIN
  SELECT * INTO v_origen FROM public.linea_cuenta l WHERE l.id = NEW.linea_origen_id AND l.empresa_id = NEW.empresa_id;
  SELECT count(DISTINCT c.modo), min(c.modo), count(*), coalesce(sum(n.cantidad), 0), coalesce(sum(n.importe_fijo), 0),
         count(*) FILTER (WHERE n.controla_stock)
    INTO v_modos, v_modo, v_copias, v_suma_cantidad, v_suma_fijo, v_con_stock
    FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
   WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id;
  IF v_modos <> 1 THEN
    RAISE EXCEPTION 'las copias de una línea son todas del mismo modo'
      USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
  END IF;
  -- Lo congelado no se recotiza: precio, unidad, paso, alícuota, producto, variante y la foto de las opciones son los de la origen.
  IF EXISTS (
    SELECT 1 FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
     WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id
       AND (n.producto_id IS DISTINCT FROM v_origen.producto_id OR n.descripcion IS DISTINCT FROM v_origen.descripcion
            OR n.variante_opcion_id IS DISTINCT FROM v_origen.variante_opcion_id OR n.variante_nombre IS DISTINCT FROM v_origen.variante_nombre
            OR n.variante_version_de_opcion_id IS DISTINCT FROM v_origen.variante_version_de_opcion_id
            OR n.precio_id IS DISTINCT FROM v_origen.precio_id OR n.origen_del_precio IS DISTINCT FROM v_origen.origen_del_precio
            OR n.precio_base IS DISTINCT FROM v_origen.precio_base OR n.precio_unitario IS DISTINCT FROM v_origen.precio_unitario
            OR n.unidad_de_venta IS DISTINCT FROM v_origen.unidad_de_venta OR n.paso_de_cantidad IS DISTINCT FROM v_origen.paso_de_cantidad
            OR n.alicuota IS DISTINCT FROM v_origen.alicuota
            OR n.departamento_id IS DISTINCT FROM v_origen.departamento_id
            OR n.camino_de_clasificacion IS DISTINCT FROM v_origen.camino_de_clasificacion
            OR EXISTS (
              (SELECT o.orden, o.opcion_id, o.version_de_opcion_id, o.grupo_id, o.nombre_de_grupo, o.nombre, o.clase, o.recargo, o.origen_del_recargo
                 FROM public.linea_cuenta_opcion o WHERE o.linea_id = n.id AND o.empresa_id = n.empresa_id
               EXCEPT
               SELECT o.orden, o.opcion_id, o.version_de_opcion_id, o.grupo_id, o.nombre_de_grupo, o.nombre, o.clase, o.recargo, o.origen_del_recargo
                 FROM public.linea_cuenta_opcion o WHERE o.linea_id = v_origen.id AND o.empresa_id = v_origen.empresa_id)
              UNION ALL
              (SELECT o.orden, o.opcion_id, o.version_de_opcion_id, o.grupo_id, o.nombre_de_grupo, o.nombre, o.clase, o.recargo, o.origen_del_recargo
                 FROM public.linea_cuenta_opcion o WHERE o.linea_id = v_origen.id AND o.empresa_id = v_origen.empresa_id
               EXCEPT
               SELECT o.orden, o.opcion_id, o.version_de_opcion_id, o.grupo_id, o.nombre_de_grupo, o.nombre, o.clase, o.recargo, o.origen_del_recargo
                 FROM public.linea_cuenta_opcion o WHERE o.linea_id = n.id AND o.empresa_id = n.empresa_id)))
  ) THEN
    RAISE EXCEPTION 'la copia de una línea conserva lo congelado de la origen: no se recotiza'
      USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
  END IF;
  IF v_modo = 'COMPLETA' THEN
    IF v_copias <> 1 OR v_suma_cantidad <> v_origen.cantidad OR v_suma_fijo IS DISTINCT FROM coalesce(v_origen.importe_fijo, 0)
       OR EXISTS (SELECT 1 FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
                   WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id
                     AND (n.importe_fijo IS DISTINCT FROM v_origen.importe_fijo OR n.controla_stock IS DISTINCT FROM v_origen.controla_stock)) THEN
      RAISE EXCEPTION 'una línea trasladada entera pasa con su misma cantidad e importe'
        USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
    END IF;
  ELSIF v_modo = 'POR_UNIDADES' THEN
    IF v_copias < 2 OR v_suma_cantidad <> v_origen.cantidad OR v_origen.importe_fijo IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
                   WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id
                     AND (n.importe_fijo IS NOT NULL OR n.controla_stock IS DISTINCT FROM v_origen.controla_stock)) THEN
      RAISE EXCEPTION 'las partes de una línea repartida por unidades suman su cantidad'
        USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
    END IF;
  ELSIF v_modo = 'COMPARTIDA' THEN
    IF v_copias < 2 OR v_origen.importe_fijo IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
                   WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id
                     AND (n.importe_fijo IS NULL OR n.cantidad <> v_origen.cantidad))
       OR v_suma_fijo <> round(v_origen.precio_unitario * v_origen.cantidad, 2)
       OR v_con_stock <> (CASE WHEN v_origen.controla_stock THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION 'las partes de un ítem compartido suman el importe de la línea y solo una descuenta stock'
        USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
    END IF;
  ELSE -- RESTO: lo que sigue vigente de un ítem anulado en parte
    IF v_copias <> 1 OR v_suma_cantidad >= v_origen.cantidad OR v_origen.importe_fijo IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
                   WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id
                     AND (n.importe_fijo IS NOT NULL OR n.controla_stock IS DISTINCT FROM v_origen.controla_stock
                          OR n.cuenta_id IS DISTINCT FROM v_origen.cuenta_id)) THEN
      RAISE EXCEPTION 'el resto de un ítem anulado en parte es menor que lo anulado y queda en la misma cuenta'
        USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
