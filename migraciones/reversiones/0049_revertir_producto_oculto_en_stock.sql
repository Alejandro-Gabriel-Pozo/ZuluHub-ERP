-- 0049_revertir_producto_oculto_en_stock: deshace la migración 0049_producto_oculto_en_stock: quita los dos disparadores y las tres funciones.
--
-- NO es destructiva: 0049 no guarda datos propios (solo funciones y disparadores). Efecto: vuelve a ser posible sumar existencia a un producto oculto y contarlo; conviene
-- bajar primero el código que da por hecho el rechazo (`PRODUCTO_OCULTO` en stock).
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción:
--
--     BEGIN;
--     \i migraciones/reversiones/0049_revertir_producto_oculto_en_stock.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

DROP TRIGGER IF EXISTS renglon_de_movimiento_oculto ON renglon_de_movimiento;
DROP TRIGGER IF EXISTS conteo_registro_oculto ON conteo_registro;
DROP FUNCTION IF EXISTS renglon_validar_producto_oculto();
DROP FUNCTION IF EXISTS conteo_registro_validar_producto_oculto();
DROP FUNCTION IF EXISTS producto_oculto_en_el_deposito(uuid, uuid, uuid);

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0049_producto_oculto_en_stock.sql';
  END IF;
END
$$;
