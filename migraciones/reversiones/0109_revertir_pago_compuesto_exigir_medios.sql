-- 0109_revertir_pago_compuesto_exigir_medios: deshace 0109 (quita el disparador de la cabecera y el CHECK de importe positivo). No pierde datos. Se puede repetir sin que cambie nada.
-- Corre ANTES que la reversión de 0103 (la función `pago_compuesto_verificar` la usa este disparador). Sin la tabla de pagos (la reversión de 0037 ya corrió) no hay nada que quitar: se puede repetir.
DO $$
BEGIN
  IF to_regclass('public.pago_de_comprobante') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS pago_de_comprobante_verificar_medios ON public.pago_de_comprobante;
    ALTER TABLE public.pago_de_comprobante DROP CONSTRAINT IF EXISTS pago_importe_positivo_ck;
  END IF;
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0109_pago_compuesto_exigir_medios.sql';
  END IF;
END
$$;
