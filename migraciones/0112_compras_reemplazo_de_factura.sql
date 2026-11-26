-- 0112_compras_reemplazo_de_factura (M-REEMPLAZO de Diseño 2, 25/11/2026, sin cambios en el cuerpo): el vínculo «reemplaza a» entre la factura nueva y la anulada (NOTAS-2).
-- ADITIVA sobre datos: una columna nullable, una restricción de clave foránea, una restricción de forma, dos índices y un disparador diferido. No toca filas.
-- DEPENDE de 0037. Las columnas de herencia de servicios y bienes (N-G: `heredado_de_id` en conforme y unidad) NO están acá: las definen SERV-3 y ACT-2 sobre decisiones RP-5 y RP-6 ya tomadas.
-- Probada contra 0001..0098 reales en Postgres 16.15.

DO $$
BEGIN
  IF to_regclass('public.comprobante_de_proveedor') IS NULL THEN
    RAISE EXCEPTION 'M-REEMPLAZO requiere 0037 aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'comprobante_de_proveedor' AND column_name = 'reemplaza_a_id') THEN
    RAISE EXCEPTION 'M-REEMPLAZO: reemplaza_a_id ya existe; esta migración solo agrega objetos nuevos' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE comprobante_de_proveedor ADD COLUMN reemplaza_a_id uuid;
ALTER TABLE comprobante_de_proveedor ADD CONSTRAINT cp_reemplaza_fkey FOREIGN KEY (reemplaza_a_id, empresa_id) REFERENCES comprobante_de_proveedor (id, empresa_id);
-- Solo una FACTURA reemplaza a otra (no una nota ni un «sin comprobante»), y no a sí misma.
ALTER TABLE comprobante_de_proveedor ADD CONSTRAINT cp_reemplaza_ck CHECK (reemplaza_a_id IS NULL OR (clase = 'FACTURA' AND reemplaza_a_id <> id));
-- Una factura anulada tiene como mucho UN reemplazo vigente (cadenas A→B→C permitidas: B anulada, C reemplaza a B). Dos reemplazos de la misma original a la vez: la base deja uno (23505 en este índice).
CREATE UNIQUE INDEX cp_reemplazo_vigente_uk ON comprobante_de_proveedor (empresa_id, reemplaza_a_id) WHERE reemplaza_a_id IS NOT NULL AND estado = 'REGISTRADO';
CREATE INDEX cp_reemplaza_ix ON comprobante_de_proveedor (empresa_id, reemplaza_a_id) WHERE reemplaza_a_id IS NOT NULL;

-- Al CONFIRMAR la transacción: la reemplazada es una FACTURA ANULADA y del MISMO proveedor (verificación diferida: en la misma transacción se anula la original y se inserta la nueva).
CREATE FUNCTION compras_reemplazo_valida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_proveedor uuid;
  v_clase text;
BEGIN
  SELECT c.estado, c.proveedor_id, c.clase INTO v_estado, v_proveedor, v_clase
    FROM public.comprobante_de_proveedor c WHERE c.id = NEW.reemplaza_a_id AND c.empresa_id = NEW.empresa_id;
  IF v_clase IS DISTINCT FROM 'FACTURA' OR v_estado IS DISTINCT FROM 'ANULADO' THEN
    RAISE EXCEPTION 'el reemplazo exige que la factura reemplazada esté anulada' USING ERRCODE = '23514', CONSTRAINT = 'reemplazo_de_factura_no_anulada';
  END IF;
  IF v_proveedor <> NEW.proveedor_id THEN
    RAISE EXCEPTION 'la factura nueva y la reemplazada son de proveedores distintos' USING ERRCODE = '23514', CONSTRAINT = 'reemplazo_de_otro_proveedor';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER comprobante_reemplazo_valida AFTER INSERT ON comprobante_de_proveedor
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.reemplaza_a_id IS NOT NULL) EXECUTE FUNCTION compras_reemplazo_valida();

GRANT INSERT (reemplaza_a_id) ON comprobante_de_proveedor TO pedernal_app;
-- VERIFICADO: `compras_solo_cambia_estado` (0037) deja cambiar solo estado/anulación/versión: `reemplaza_a_id` solo se inserta, nunca se actualiza, y el trigger ya lo protege.
-- LÍMITE CONOCIDO: la original tiene que ser clase FACTURA. «Cambiar el comprobante» de una compra N1/N2 cuya original es SIN_COMPROBANTE (sin factura) NO entra en esta restricción: ver pregunta Q-1 del índice de briefs.
