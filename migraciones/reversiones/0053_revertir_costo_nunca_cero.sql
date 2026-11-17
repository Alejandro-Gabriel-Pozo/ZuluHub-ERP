-- 0053_revertir_costo_nunca_cero: deshace 0053_costo_nunca_cero: las dos restricciones del costo vuelven a admitir cero (`>= 0`, como en 0031).
--
-- NO es destructiva: solo afloja restricciones; no cambia filas. Conviene bajar antes el código que da por hecho que la base no admite cero.
--
-- Este script NO lo aplica el ejecutor de migraciones: se corre a mano, revisado, en una sola transacción:
--
--     BEGIN;
--     \i migraciones/reversiones/0053_revertir_costo_nunca_cero.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

ALTER TABLE costo_de_articulo DROP CONSTRAINT IF EXISTS costo_de_articulo_costo_ck;
ALTER TABLE costo_de_articulo ADD CONSTRAINT costo_de_articulo_costo_ck
  CHECK (costo_unitario >= 0 AND costo_unitario < 1000000000000);

ALTER TABLE costo_de_renglon DROP CONSTRAINT IF EXISTS costo_de_renglon_costo_ck;
ALTER TABLE costo_de_renglon ADD CONSTRAINT costo_de_renglon_costo_ck
  CHECK (costo_unitario >= 0 AND costo_unitario < 1000000000000);

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0053_costo_nunca_cero.sql';
  END IF;
END
$$;
