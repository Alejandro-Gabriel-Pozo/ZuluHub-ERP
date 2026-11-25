-- 0104_pago_compuesto_exigir_medios: PASO 2 DE 2 del pago compuesto. Desde acá TODO pago tiene al menos un medio, la suma de sus medios es su total y el importe es positivo (SUPUESTO: una factura de total 0 no se paga).
-- Va DESPUÉS del código de P1 (el que escribe las líneas): con el código viejo, declarar un pago fallaría. ADITIVA: un disparador diferido y un CHECK. FRENA (55000) si algún pago existente no tiene medios o no cuadra.
-- Reversión: `migraciones/reversiones/0104_revertir_pago_compuesto_exigir_medios.sql`. DEPENDE de 0103.

DO $$
BEGIN
  IF to_regclass('public.medio_de_un_pago') IS NULL OR to_regprocedure('public.pago_compuesto_verificar()') IS NULL THEN
    RAISE EXCEPTION '0104 necesita 0103 aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pago_de_comprobante p
     WHERE p.importe <= 0
        OR p.importe <> coalesce((SELECT sum(m.importe) FROM public.medio_de_un_pago m WHERE m.pago_id = p.id AND m.empresa_id = p.empresa_id), 0)) THEN
    RAISE EXCEPTION '0104: hay pagos sin medios, de importe 0 o cuyos medios no suman su total; resolverlos a mano antes' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE pago_de_comprobante ADD CONSTRAINT pago_importe_positivo_ck CHECK (importe > 0);
CREATE CONSTRAINT TRIGGER pago_de_comprobante_verificar_medios AFTER INSERT ON pago_de_comprobante DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pago_compuesto_verificar();
