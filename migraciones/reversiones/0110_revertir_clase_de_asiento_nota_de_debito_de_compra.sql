-- 0110_revertir_clase_de_asiento_nota_de_debito_de_compra: quita la clase sembrada por 0110. FRENA (55000) si hay asientos de esa clase (borrarla dejaría asientos sin su clase): hay que AVISAR AL DUEÑO y resolverlo a mano antes.
-- Se corre en UNA sola transacción, con el dueño de la base (evade RLS, que además deja ver todos los asientos): si algo falla, el disparador vuelve a su estado por DDL transaccional. El catálogo es de solo inserción: el disparador se apaga solo para este borrado y se vuelve a encender. Se puede repetir sin que cambie nada.
DO $$
DECLARE
  v_asientos bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.asiento_de_saldo') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.asiento_de_saldo WHERE sentido = ''A_PAGAR'' AND clase = ''NOTA_DE_DEBITO_DE_COMPRA''' INTO v_asientos;
  END IF;
  IF v_asientos > 0 THEN
    RAISE EXCEPTION 'hay % asientos de la clase NOTA_DE_DEBITO_DE_COMPRA: no se revierte; resolverlos a mano antes', v_asientos USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.clase_de_asiento') IS NOT NULL THEN
    ALTER TABLE public.clase_de_asiento DISABLE TRIGGER clase_de_asiento_solo_insercion;
    DELETE FROM public.clase_de_asiento WHERE sentido = 'A_PAGAR' AND clase = 'NOTA_DE_DEBITO_DE_COMPRA';
    ALTER TABLE public.clase_de_asiento ENABLE TRIGGER clase_de_asiento_solo_insercion;
  END IF;
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0110_clase_de_asiento_nota_de_debito_de_compra.sql';
  END IF;
END
$$;
