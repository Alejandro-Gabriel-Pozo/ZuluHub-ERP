-- 0051_revertir_porciones_del_producto: deshace la migración 0051_porciones_del_producto: quita la columna de fracciones del producto y sus restricciones.
-- DESTRUCTIVA si algún producto ya se vende por fracciones (se perdería la elección de porciones): en ese caso FRENA con un error y no cambia nada; hay que avisar
-- al dueño y volver esos productos a «por unidad» antes. Sin fracciones cargadas, no se pierde nada. Sin CASCADE.
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con
-- el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0051_revertir_porciones_del_producto.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'producto' AND column_name = 'porciones_ofrecidas'
  ) THEN
    IF EXISTS (SELECT 1 FROM public.producto WHERE cardinality(porciones_ofrecidas) > 0) THEN
      RAISE EXCEPTION 'hay productos que se venden por fracciones: revertir pierde sus porciones; avisar al dueño y volverlos a «por unidad» antes'
        USING ERRCODE = '55000';
    END IF;
    REVOKE UPDATE (porciones_ofrecidas) ON public.producto FROM pedernal_app;
    ALTER TABLE public.producto DROP CONSTRAINT IF EXISTS producto_porciones_ck;
    ALTER TABLE public.producto DROP COLUMN porciones_ofrecidas;
  END IF;
  -- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0051_porciones_del_producto.sql';
  END IF;
END
$$;
