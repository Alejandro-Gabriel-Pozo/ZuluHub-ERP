-- 0109_pago_compuesto_exigir_medios: PASO 2 DE 2 del pago compuesto (el paso 1 es 0103). Desde acá TODO pago tiene al menos un medio, la suma de sus medios es su total, el medio de la cabecera es coherente con sus líneas y el importe es positivo.
-- SUPUESTO (DEC-COM-005, pendiente del dueño): una factura de total 0 no se paga (importe > 0); costo de revertir: quitar el CHECK.
-- Va DESPUÉS del código de P1 (el que escribe cabecera y líneas en la misma transacción): con el código viejo, declarar un pago fallaría al confirmar. ADITIVA: un CHECK y un disparador diferido sobre INSERT de la cabecera (el de las líneas ya existe en 0103).
-- La app no puede cambiar `importe` ni `medio` después (el GRANT de UPDATE de 0037 es solo estado y anulación), así que el disparador de INSERT alcanza. FRENA (55000) si algún pago existente no cumple.
-- Reversión: `migraciones/reversiones/0109_revertir_pago_compuesto_exigir_medios.sql`. DEPENDE de 0103.

DO $$
BEGIN
  IF to_regclass('public.medio_de_un_pago') IS NULL OR to_regprocedure('public.pago_compuesto_verificar()') IS NULL THEN
    RAISE EXCEPTION '0109 necesita 0103 aplicada antes' USING ERRCODE = '55000';
  END IF;
  -- `pago_de_comprobante` y `medio_de_un_pago` tienen FORCE RLS: sin un rol que la evada, el chequeo de abajo vería CERO filas y pasaría en falso (fail-closed).
  IF row_security_active('public.pago_de_comprobante') OR row_security_active('public.medio_de_un_pago') THEN
    RAISE EXCEPTION '0109 necesita un rol que evada RLS para verificar' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pago_de_comprobante p
     WHERE p.importe <= 0
        OR p.importe <> coalesce((SELECT sum(m.importe) FROM public.medio_de_un_pago m WHERE m.pago_id = p.id AND m.empresa_id = p.empresa_id), 0)) THEN
    RAISE EXCEPTION '0109: hay pagos sin medios, de importe 0 o cuyos medios no suman su total; resolverlos a mano antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pago_de_comprobante p
      JOIN LATERAL (SELECT count(*) AS n, min(m.medio) AS unico FROM public.medio_de_un_pago m WHERE m.pago_id = p.id AND m.empresa_id = p.empresa_id) l ON true
     WHERE (l.n > 1 AND p.medio <> 'COMPUESTO') OR (l.n = 1 AND p.medio <> l.unico)) THEN
    RAISE EXCEPTION '0109: hay pagos cuyo medio de cabecera no es coherente con sus líneas; resolverlos a mano antes' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE pago_de_comprobante ADD CONSTRAINT pago_importe_positivo_ck CHECK (importe > 0);
CREATE CONSTRAINT TRIGGER pago_de_comprobante_verificar_medios AFTER INSERT ON pago_de_comprobante DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pago_compuesto_verificar();
