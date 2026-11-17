-- 0058_revertir_oferta_vigente: deshace 0058: quita `oferta_de_proveedor.vigente` (y su permiso).
--
-- FRENA (55000) si hay ofertas con `vigente = false`: sin la columna volverían a mostrarse en la ficha del proveedor con el precio de una compra anulada. AVISAR AL DUEÑO antes y, si
-- se decide seguir, repetir con SET LOCAL pedernal.confirmar_reversion = 'SI'. Se corre a mano, revisada, en una transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay ofertas no vigentes
--     \i migraciones/reversiones/0058_revertir_oferta_vigente.sql
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
     WHERE table_schema = 'public' AND table_name = 'oferta_de_proveedor' AND column_name = 'vigente'
  ) THEN
    SELECT count(*) INTO v_filas FROM public.oferta_de_proveedor WHERE NOT vigente;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % ofertas no vigentes que volverían a mostrarse con el precio de una compra anulada: avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE oferta_de_proveedor DROP COLUMN IF EXISTS vigente;

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0058_oferta_vigente.sql';
  END IF;
END
$$;
