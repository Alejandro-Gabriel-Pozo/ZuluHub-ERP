-- 0030_revertir_stock: deshace la migración 0030_stock (las diez tablas del stock: deposito, articulo_de_stock, motivo_de_movimiento,
-- movimiento_de_stock, renglon_de_movimiento, saldo_de_stock, conteo_fisico, conteo_registro, composicion y componente_de_composicion, con
-- sus funciones y disparadores) y las dos únicas que sumó sobre `producto`.
--
-- DESTRUCTIVA si hay datos: BORRA todos los depósitos, artículos controlados, el libro de movimientos con sus renglones, los saldos, los
-- conteos y las composiciones cargados, y eso NO SE RECUPERA (el libro es el único registro de qué entró, qué salió y por qué; los saldos
-- no se pueden reconstruir sin él). Hay que AVISAR AL DUEÑO antes de correrla si hay alguna fila. Ojo con el código: el módulo `stock` y la
-- venta que descuenta al cerrar la cuenta leen esas tablas; sin ellas sus casos de uso y consultas fallan, así que conviene bajar primero
-- ese código. Una tabla posterior que las use (los costos del tramo TCO, una recepción de compras) hace fallar el DROP por su clave foránea
-- y no se pierde nada. `motivo_de_movimiento` es una tabla sembrada (14 filas fijas): no cuenta como dato a perder.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún dato de stock cargado
--     \i migraciones/reversiones/0030_revertir_stock.sql
--     COMMIT;
--
-- Deja la base como estaba después de 0029. No usa CASCADE: si otro objeto depende de una tabla (una clave foránea de una migración
-- posterior), el DROP falla y no se pierde nada. Solo borra su propia fila del registro `migracion`, para que la migración se pueda volver
-- a aplicar. Se puede repetir sin que cambie nada. No toca `nivel_de_control` (un nivel guardado para `stock.existencia_negativa` es
-- configuración de la empresa y queda).

DO $$
DECLARE
  v_tabla text;
  v_filas bigint;
  v_total bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con las tablas ya borradas (una repetición) no hay nada que contar.
  FOREACH v_tabla IN ARRAY ARRAY['deposito', 'articulo_de_stock', 'movimiento_de_stock', 'renglon_de_movimiento', 'saldo_de_stock',
                                 'conteo_fisico', 'conteo_registro', 'composicion', 'componente_de_composicion'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de stock (depósitos, artículos, movimientos, saldos, conteos, composiciones) que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores de borrado y de solo inserción frenan hasta al dueño de la base: se sacan junto con cada tabla (DROP TABLE no los
-- dispara), en el orden inverso de las claves foráneas.
DROP TABLE IF EXISTS conteo_registro;
DROP TABLE IF EXISTS saldo_de_stock;
DROP TABLE IF EXISTS renglon_de_movimiento;
DROP TABLE IF EXISTS movimiento_de_stock;
DROP TABLE IF EXISTS conteo_fisico;
DROP TABLE IF EXISTS motivo_de_movimiento;
DROP TABLE IF EXISTS componente_de_composicion;
DROP TABLE IF EXISTS composicion;
DROP TABLE IF EXISTS articulo_de_stock;
DROP TABLE IF EXISTS deposito;

DROP FUNCTION IF EXISTS movimiento_de_stock_coherente();
DROP FUNCTION IF EXISTS saldo_de_stock_solo_por_movimientos();
DROP FUNCTION IF EXISTS renglon_de_movimiento_aplicar();
DROP FUNCTION IF EXISTS renglon_de_movimiento_validar();
DROP FUNCTION IF EXISTS movimiento_de_stock_preparar();
DROP FUNCTION IF EXISTS conteo_registro_preparar();
DROP FUNCTION IF EXISTS conteo_fisico_validar();
DROP FUNCTION IF EXISTS componente_de_composicion_validar();
DROP FUNCTION IF EXISTS composicion_validar();
DROP FUNCTION IF EXISTS articulo_de_stock_validar();
DROP FUNCTION IF EXISTS deposito_validar();

-- Las dos únicas que 0030 sumó sobre `producto` (sin la tabla no hay nada que las use; si `producto` ya no existe, tampoco hay que sacarlas).
DO $$
BEGIN
  IF to_regclass('public.producto') IS NOT NULL THEN
    ALTER TABLE public.producto DROP CONSTRAINT IF EXISTS producto_id_dimension_empresa_uk;
    ALTER TABLE public.producto DROP CONSTRAINT IF EXISTS producto_id_unidad_base_empresa_uk;
  END IF;
END
$$;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_stock.sql' ESCAPE '\';
  END IF;
END
$$;
