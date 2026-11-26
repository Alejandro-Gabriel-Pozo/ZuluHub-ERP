-- 0110_clase_de_asiento_nota_de_debito_de_compra: siembra la clase de asiento de la nota de débito del proveedor (A_PAGAR, suma, sin detalle ni vencimiento: las mismas banderas que REINTEGRO_DE_PROVEEDOR).
-- Solo DATOS (una fila del catálogo `clase_de_asiento`; 0092 sembró las demás de compras y esta no): idempotente (`ON CONFLICT DO NOTHING`, se puede correr dos veces). La usa el puerto del libro de compras (L3a) para la nota de débito (NOTAS-1).
-- `clase_de_asiento` tiene FORCE RLS: sin un rol que la evada, el INSERT no se podría hacer (fail-closed). Reversión: `migraciones/reversiones/0110_revertir_clase_de_asiento_nota_de_debito_de_compra.sql`. DEPENDE de 0092.

DO $$
BEGIN
  IF to_regclass('public.clase_de_asiento') IS NULL THEN
    RAISE EXCEPTION '0110 necesita 0092 aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF row_security_active('public.clase_de_asiento') THEN
    RAISE EXCEPTION '0110 necesita un rol que evada RLS para sembrar' USING ERRCODE = '55000';
  END IF;
END
$$;

INSERT INTO clase_de_asiento (sentido, clase, signo, exige_detalle, admite_vencimiento)
VALUES ('A_PAGAR', 'NOTA_DE_DEBITO_DE_COMPRA', '+', false, false)
ON CONFLICT (sentido, clase) DO NOTHING;
