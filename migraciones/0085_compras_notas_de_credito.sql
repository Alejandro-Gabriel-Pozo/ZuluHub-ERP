-- 0085_compras_notas_de_credito (número provisorio): compras N4, NOTA DE CRÉDITO DEL PROVEEDOR como comprobante SIN SALDO (E9 §3.8; e9-n4-devolucion-nota-y-saldo-diseno.md §3.1 sin las tablas de crédito).
-- Decisión del dueño (16/11/2026): la nota de crédito es un comprobante que corrige UNA factura; el libro de saldos (crédito, aplicación, reintegro) va aparte y no entra acá. Esta migración solo agrega el dato mínimo:
-- la factura que la nota corrige y el tope (lo acreditado de una factura no pasa de su total). La nota NO tiene líneas, NO tiene saldo, NO reduce lo que se paga y NO toca stock.
-- ADITIVA: una columna nullable, un índice, una función y dos disparadores sobre `comprobante_de_proveedor` (0037); no toca datos ni cambia ninguna restricción ni disparador existente. El comprobante sigue siendo inmutable salvo anularlo.
-- Sin SECURITY DEFINER; toda función fija `search_path = pg_catalog, public, pg_temp`. Reversión: `migraciones/reversiones/0085_revertir_compras_notas_de_credito.sql` (FRENA si hay notas de crédito cargadas).
-- DEPENDE de 0037 (compras). La clase `NOTA_DE_CREDITO` y los tipos `NOTA_CREDITO_A/B/C` ya existen en los CHECK de 0037.
--
-- Diseño (probado por `test/integracion/compras-notas-de-credito-migracion.test.ts`):
--  N1. `comprobante_asociado_id` (FK COMPUESTA con la empresa): obligatorio para la clase NOTA_DE_CREDITO y nulo para las demás (`cp_asociado_ck`).
--  N2. Al insertar una nota, el disparador BLOQUEA la fila de la factura (`FOR UPDATE`, que no es un UPDATE: no dispara nada) y comprueba: la factura existe en la empresa, es clase FACTURA, está REGISTRADA y es del mismo proveedor, y lo acreditado vigente más
--      el total de esta nota no supera el total de la factura. Dos notas a la vez sobre la misma factura se serializan por ese bloqueo: la segunda ve a la primera. Una nota anulada deja de contar.
--  N3. Una factura con notas vigentes no se anula (primero se anulan las notas): `comprobante_con_nota_de_credito`. Con el bloqueo de N2, una nota y la anulación de su factura a la vez no dejan una nota vigente de una factura anulada.

DO $$
BEGIN
  IF to_regclass('public.comprobante_de_proveedor') IS NULL THEN
    RAISE EXCEPTION 'compras N4 (notas de crédito) requiere 0037 aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'comprobante_de_proveedor' AND column_name = 'comprobante_asociado_id') THEN
    RAISE EXCEPTION 'compras N4: la columna comprobante_asociado_id ya existe; esta migración solo agrega objetos nuevos' USING ERRCODE = '55000';
  END IF;
  -- Hoy una nota de crédito no se puede cargar (D6): si hubiera una, no tendría la factura que corrige y la restricción nueva no se podría aplicar.
  IF EXISTS (SELECT 1 FROM comprobante_de_proveedor WHERE clase = 'NOTA_DE_CREDITO') THEN
    RAISE EXCEPTION 'compras N4: ya hay notas de crédito cargadas sin su factura asociada; hay que resolverlas antes de aplicar esta migración' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE comprobante_de_proveedor ADD COLUMN comprobante_asociado_id uuid;
ALTER TABLE comprobante_de_proveedor ADD CONSTRAINT cp_asociado_fkey FOREIGN KEY (comprobante_asociado_id, empresa_id) REFERENCES comprobante_de_proveedor (id, empresa_id);
ALTER TABLE comprobante_de_proveedor ADD CONSTRAINT cp_asociado_ck CHECK ((clase = 'NOTA_DE_CREDITO') = (comprobante_asociado_id IS NOT NULL));
CREATE INDEX cp_asociado_ix ON comprobante_de_proveedor (empresa_id, comprobante_asociado_id) WHERE comprobante_asociado_id IS NOT NULL;

-- Alta de una nota: la factura que corrige y el tope de lo acreditado.
CREATE FUNCTION compras_nota_de_credito_valida() RETURNS trigger LANGUAGE plpgsql
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
   WHERE n.empresa_id = NEW.empresa_id AND n.comprobante_asociado_id = NEW.comprobante_asociado_id AND n.estado <> 'ANULADO';
  IF v_acreditado + NEW.total_segun_factura > v_total THEN
    RAISE EXCEPTION 'lo acreditado supera el total de la factura (% de %)', v_acreditado + NEW.total_segun_factura, v_total USING ERRCODE = '23514', CONSTRAINT = 'nota_de_credito_excede_la_factura';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER comprobante_nota_valida BEFORE INSERT ON comprobante_de_proveedor FOR EACH ROW EXECUTE FUNCTION compras_nota_de_credito_valida();

-- Anular una factura con notas vigentes: primero se anulan las notas.
CREATE FUNCTION compras_factura_con_notas() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.estado = 'ANULADO' AND OLD.estado <> 'ANULADO' AND NEW.clase = 'FACTURA' AND EXISTS (
       SELECT 1 FROM public.comprobante_de_proveedor n
        WHERE n.empresa_id = NEW.empresa_id AND n.comprobante_asociado_id = NEW.id AND n.estado <> 'ANULADO') THEN
    RAISE EXCEPTION 'la factura tiene notas de crédito vigentes: anular antes las notas' USING ERRCODE = '23514', CONSTRAINT = 'comprobante_con_nota_de_credito';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER comprobante_con_notas BEFORE UPDATE ON comprobante_de_proveedor FOR EACH ROW EXECUTE FUNCTION compras_factura_con_notas();

GRANT INSERT (comprobante_asociado_id) ON comprobante_de_proveedor TO pedernal_app;
