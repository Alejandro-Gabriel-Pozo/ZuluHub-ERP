-- 0075_revertir_alicuota_del_producto: deshace 0075: `producto_alicuota_ck` vuelve a admitir los ocho códigos de 0025 (los seis con IVA, «EXENTO» y «NO_GRAVADO»).
-- Afloja un control: no puede frenar por datos y no toca ninguna fila. Se corre a mano, revisada, en una transacción:
--
--     BEGIN;
--     \i migraciones/reversiones/0075_revertir_alicuota_del_producto.sql
--     COMMIT;
--
-- Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

ALTER TABLE public.producto DROP CONSTRAINT IF EXISTS producto_alicuota_ck;
ALTER TABLE public.producto ADD CONSTRAINT producto_alicuota_ck
  CHECK (alicuota_iva IN ('0', '2.5', '5', '10.5', '21', '27', 'EXENTO', 'NO_GRAVADO'));

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0075_alicuota_del_producto.sql';
  END IF;
END
$$;
