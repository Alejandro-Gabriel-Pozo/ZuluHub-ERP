-- 0055_revertir_salon_copias_y_nombre_de_cocina: deshace la migración 0055_salon_copias_y_nombre_de_cocina: devuelve `linea_validar_cambio` a la versión de 0047 y
-- `copias_cuadran` a la de 0038 (sin comparar departamento, camino ni nombre de cocina) y quita `linea_cuenta.nombre_de_cocina`.
--
-- DESTRUCTIVA si hay datos: BORRA el nombre de cocina congelado en cada línea de venta (no se recupera: lo que decía el producto al venderse no se reconstruye si después se
-- renombra). Hay que AVISAR AL DUEÑO antes de correrla si alguna línea lo tiene. Conviene bajar primero el código que escribe y lee la columna (`agregarLinea`, `copiarLinea` y la
-- comanda). Además afloja un control: con la función de 0038 la base deja de impedir que una copia cambie la clasificación (queda solo el código de `copiar-linea.ts`).
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño
-- de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si alguna línea tiene nombre de cocina
--     \i migraciones/reversiones/0055_revertir_salon_copias_y_nombre_de_cocina.sql
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
     WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name = 'nombre_de_cocina'
  ) THEN
    SELECT count(*) INTO v_filas FROM public.linea_cuenta WHERE nombre_de_cocina IS NOT NULL;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % líneas de venta con nombre de cocina que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Las funciones primero, para que nada lea la columna mientras se saca.
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

ALTER TABLE linea_cuenta DROP COLUMN IF EXISTS nombre_de_cocina;

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0055_salon_copias_y_nombre_de_cocina.sql';
  END IF;
END
$$;
