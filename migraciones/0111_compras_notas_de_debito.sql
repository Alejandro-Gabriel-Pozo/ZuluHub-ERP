-- 0111_compras_notas_de_debito (M-NOTAS de Diseño 2, 25/11/2026, sin cambios en el cuerpo): la nota de débito puede vincularse a una factura y el tope de lo acreditado cuenta SOLO notas de crédito (H-N1).
-- ADITIVA sobre datos: ninguna fila existente cambia. Reemplaza UNA función (compras_nota_de_credito_valida) y ensancha UNA restricción (cp_asociado_ck).
-- DEPENDE de 0037 y 0085 (comprobante_asociado_id, cp_asociado_ck, compras_nota_de_credito_valida, comprobante_nota_valida, comprobante_con_notas).
-- NO incluye reparto_de_nota: va DENTRO de M-SERVICIOS (depende del nivel 'SERVICIOS').
-- Probada contra 0001..0098 reales en Postgres 16.15 (ver HALLAZGOS-DE-VERIFICACION.md); NO probada en Neon ni con el ejecutor de migraciones.

DO $$
BEGIN
  IF to_regclass('public.comprobante_de_proveedor') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cp_asociado_ck') THEN
    RAISE EXCEPTION 'M-NOTAS requiere 0085 aplicada antes (falta cp_asociado_ck)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'comprobante_nota_de_debito_valida') THEN
    RAISE EXCEPTION 'M-NOTAS: comprobante_nota_de_debito_valida ya existe; esta migración solo agrega objetos nuevos' USING ERRCODE = '55000';
  END IF;
END
$$;

-- 1) Vínculo: NC ⇒ con factura (como hoy); ND ⇒ con o sin factura (nuevo); el resto ⇒ sin factura. Ensancha la restricción: toda fila actual la cumple.
ALTER TABLE comprobante_de_proveedor DROP CONSTRAINT cp_asociado_ck;
ALTER TABLE comprobante_de_proveedor ADD CONSTRAINT cp_asociado_ck CHECK (
  (clase = 'NOTA_DE_CREDITO' AND comprobante_asociado_id IS NOT NULL)
  OR clase = 'NOTA_DE_DEBITO'
  OR (clase NOT IN ('NOTA_DE_CREDITO', 'NOTA_DE_DEBITO') AND comprobante_asociado_id IS NULL)
);

-- 2) CORRECCIÓN DE UN DEFECTO QUE LA MIGRACIÓN 0085 NO TENÍA PORQUE NO HABÍA NOTAS DE DÉBITO VINCULADAS: el tope de lo acreditado sumaba TODAS las notas
--    no anuladas de la factura (sin mirar la clase). Con notas de débito vinculadas, una ND de $500 le habría quitado $500 de tope a las notas de crédito.
--    Se reemplaza la función con el MISMO cuerpo de 0085 y un solo agregado: `AND n.clase = 'NOTA_DE_CREDITO'` en la suma.
CREATE OR REPLACE FUNCTION compras_nota_de_credito_valida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_estado text;
  v_proveedor uuid;
  v_total numeric(18,2);
  v_acreditado numeric(18,2);
BEGIN
  IF NEW.clase <> 'NOTA_DE_CREDITO' THEN
    RETURN NEW;
  END IF;
  SELECT c.clase, c.estado, c.proveedor_id, c.total_segun_factura INTO v_clase, v_estado, v_proveedor, v_total
    FROM public.comprobante_de_proveedor c WHERE c.id = NEW.comprobante_asociado_id AND c.empresa_id = NEW.empresa_id FOR UPDATE;
  IF v_clase IS DISTINCT FROM 'FACTURA' THEN
    RAISE EXCEPTION 'la nota de crédito corrige una factura de la empresa' USING ERRCODE = '23514', CONSTRAINT = 'nota_de_credito_sin_factura';
  END IF;
  IF v_estado <> 'REGISTRADO' THEN
    RAISE EXCEPTION 'la factura que corrige la nota de crédito está anulada' USING ERRCODE = '23514', CONSTRAINT = 'nota_de_credito_de_factura_anulada';
  END IF;
  IF v_proveedor <> NEW.proveedor_id THEN
    RAISE EXCEPTION 'la nota de crédito y su factura son de proveedores distintos' USING ERRCODE = '23514', CONSTRAINT = 'nota_de_credito_de_otro_proveedor';
  END IF;
  SELECT coalesce(sum(n.total_segun_factura), 0) INTO v_acreditado
    FROM public.comprobante_de_proveedor n
   WHERE n.empresa_id = NEW.empresa_id AND n.comprobante_asociado_id = NEW.comprobante_asociado_id AND n.estado <> 'ANULADO'
     AND n.clase = 'NOTA_DE_CREDITO';
  IF v_acreditado + NEW.total_segun_factura > v_total THEN
    RAISE EXCEPTION 'lo acreditado supera el total de la factura (% de %)', v_acreditado + NEW.total_segun_factura, v_total USING ERRCODE = '23514', CONSTRAINT = 'nota_de_credito_excede_la_factura';
  END IF;
  RETURN NEW;
END
$$;

-- 3) Nota de débito vinculada: exige una factura REGISTRADA del mismo proveedor y de la misma empresa. Sin tope (un interés no «corrige» el total).
--    Toma FOR SHARE de la factura: se serializa con una nota de crédito (FOR UPDATE) y con la anulación de la factura (UPDATE), pero dos notas de débito a la vez no se bloquean entre sí.
CREATE FUNCTION compras_nota_de_debito_valida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_estado text;
  v_proveedor uuid;
BEGIN
  IF NEW.clase <> 'NOTA_DE_DEBITO' OR NEW.comprobante_asociado_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.clase, c.estado, c.proveedor_id INTO v_clase, v_estado, v_proveedor
    FROM public.comprobante_de_proveedor c WHERE c.id = NEW.comprobante_asociado_id AND c.empresa_id = NEW.empresa_id FOR SHARE;
  IF v_clase IS DISTINCT FROM 'FACTURA' THEN
    RAISE EXCEPTION 'la nota de débito vincula una factura de la empresa' USING ERRCODE = '23514', CONSTRAINT = 'nota_de_debito_sin_factura';
  END IF;
  IF v_estado <> 'REGISTRADO' THEN
    RAISE EXCEPTION 'la factura vinculada a la nota de débito está anulada' USING ERRCODE = '23514', CONSTRAINT = 'nota_de_debito_de_factura_anulada';
  END IF;
  IF v_proveedor <> NEW.proveedor_id THEN
    RAISE EXCEPTION 'la nota de débito y su factura son de proveedores distintos' USING ERRCODE = '23514', CONSTRAINT = 'nota_de_debito_de_otro_proveedor';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER comprobante_nota_de_debito_valida BEFORE INSERT ON comprobante_de_proveedor FOR EACH ROW EXECUTE FUNCTION compras_nota_de_debito_valida();

-- Sin cambios (VERIFICADO en 0085): `comprobante_con_notas` ya cuenta TODA nota vinculada no anulada (crédito o débito): una factura con una nota de débito vinculada vigente tampoco se anula.
-- Su mensaje y su CONSTRAINT dicen «nota de crédito» (`comprobante_con_nota_de_credito`): NO se renombra la restricción (la mapea `errores-de-compras`); el texto para la nota de débito es un texto PENDIENTE.
-- `GRANT INSERT (comprobante_asociado_id)` ya existe desde 0085.
