-- 0104_revertir_pago_compuesto_exigir_medios: deshace 0104 (quita el disparador de la cabecera y el CHECK de importe positivo). No pierde datos. Se puede repetir sin que cambie nada.
DROP TRIGGER IF EXISTS pago_de_comprobante_verificar_medios ON pago_de_comprobante;
ALTER TABLE pago_de_comprobante DROP CONSTRAINT IF EXISTS pago_importe_positivo_ck;
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0104_pago_compuesto_exigir_medios.sql';
  END IF;
END
$$;
