-- 0054_revertir_precio_de_linea_de_factura_mayor_que_cero: deshace 0054: `linea_de_comprobante_precio_ck` vuelve a admitir cero (`>= 0`, como en 0037).
--
-- NO es destructiva: solo afloja una restricción; no cambia filas. Conviene bajar antes el código que da por hecho que la base no admite cero.
--
-- Este script NO lo aplica el ejecutor de migraciones: se corre a mano, revisado, en una sola transacción:
--
--     BEGIN;
--     \i migraciones/reversiones/0054_revertir_precio_de_linea_de_factura_mayor_que_cero.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

ALTER TABLE linea_de_comprobante DROP CONSTRAINT IF EXISTS linea_de_comprobante_precio_ck;
ALTER TABLE linea_de_comprobante ADD CONSTRAINT linea_de_comprobante_precio_ck
  CHECK (precio_neto >= 0 AND precio_neto < 10000000000000);

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0054_precio_de_linea_de_factura_mayor_que_cero.sql';
  END IF;
END
$$;
