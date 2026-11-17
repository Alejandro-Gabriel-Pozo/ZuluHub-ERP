-- 0072_caja_origen_y_anulacion_distinta (LB-5b): dos cambios ADITIVOS sobre `movimiento_caja`, en dos bloques independientes.
--
--  BLOQUE 1 (APROBADO por el dueño, 17/11/2026, «3.-si»): `CHECK (anula_a IS DISTINCT FROM id)`. Hoy nada impide que un movimiento de anulación se anule a sí mismo (la
--    clave foránea `movimiento_caja_anula_fkey` se cumple contra la propia fila recién insertada). `movimiento_de_stock` ya lo tiene (0030). Previene: un movimiento que «se anula
--    a sí mismo» y deja el esperado de la caja en cero sin que nadie lo vea.
--  BLOQUE 2 (PENDIENTE DE APROBACIÓN del dueño, hallazgo R2 de `primitiva-de-libro-diseno.md` §9): las columnas `origen_tipo` y `origen_id`, NULABLES. Hoy el origen de un movimiento que
--    nace de otro módulo (pago a un proveedor, entrega a rendir, reintegro, devolución del sobrante) vive solo dentro del texto de la clave de idempotencia (`egreso_<tipo>_<id>`). Con las
--    columnas el origen se consulta sin leer texto, y una restricción única impide DOS movimientos del mismo origen aunque cambie la clave (identidad por origen, como `movimiento_de_stock`).
--    Si el dueño no lo aprueba, se borra este bloque (y su reversión) y queda el bloque 1.
--
-- Reglas de esta migración:
--  * ADITIVA y compatible hacia atrás: columnas nulables sin default (el código anterior no las nombra y la inserción sigue sin pasarlas); NO toca datos (la tabla es de solo inserción: las
--    filas que ya existen quedan con origen nulo y su origen se sigue leyendo de la clave); no cambia funciones, disparadores ni roles; no agrega DELETE ni UPDATE.
--  * Su reversión es `migraciones/reversiones/0072_revertir_caja_origen_y_anulacion_distinta.sql` (frena si hay movimientos con origen: quitar las columnas lo borraría).
-- DEPENDE de 0027 (la tabla y sus permisos); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.movimiento_caja') IS NULL THEN
    RAISE EXCEPTION '0072 necesita 0027 (movimiento_caja)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.movimiento_caja WHERE anula_a IS NOT DISTINCT FROM id) THEN
    RAISE EXCEPTION '0072: hay movimientos de caja que se anulan a sí mismos; revisarlos con el dueño antes de aplicar'
      USING ERRCODE = '23514';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 1 (aprobado 17/11/2026): un movimiento no se anula a sí mismo.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE movimiento_caja ADD CONSTRAINT movimiento_caja_anula_distinta_ck CHECK (anula_a IS DISTINCT FROM id) NOT VALID;
ALTER TABLE movimiento_caja VALIDATE CONSTRAINT movimiento_caja_anula_distinta_ck;

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 2 (PENDIENTE de aprobación del dueño): el origen de un movimiento de efectivo, en columnas.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE movimiento_caja ADD COLUMN origen_tipo text;
ALTER TABLE movimiento_caja ADD COLUMN origen_id uuid;

-- Las dos juntas o ninguna.
ALTER TABLE movimiento_caja ADD CONSTRAINT movimiento_caja_origen_par_ck CHECK ((origen_tipo IS NULL) = (origen_id IS NULL));
-- La lista CERRADA de orígenes (copia de `ORIGENES_DE_EGRESO` y `ORIGENES_DE_INGRESO` de `src/modulos/caja/dominio/origen-de-movimiento.ts`; una prueba falla si difieren) y su sentido:
-- lo que sale por un origen es un egreso manual; lo que entra, un ingreso manual. Un cobro, un ajuste, una anulación o el fondo no llevan origen en esta tabla (el cobro lo lleva en `cobro`).
ALTER TABLE movimiento_caja ADD CONSTRAINT movimiento_caja_origen_ck CHECK (
  origen_tipo IS NULL
  OR (origen_tipo IN ('PAGO_A_PROVEEDOR', 'ENTREGA_A_RENDIR') AND clase = 'EGRESO_MANUAL')
  OR (origen_tipo IN ('REINTEGRO_DE_PROVEEDOR', 'DEVOLUCION_DE_SOBRANTE') AND clase = 'INGRESO_MANUAL')
);
-- Un movimiento por origen y por empresa, aunque cambie la clave de idempotencia.
CREATE UNIQUE INDEX movimiento_caja_origen_uk ON movimiento_caja (empresa_id, origen_tipo, origen_id) WHERE origen_tipo IS NOT NULL;

-- Permiso de alta por columna, como el resto de la tabla (la lectura ya es de toda la tabla).
GRANT INSERT (origen_tipo, origen_id) ON movimiento_caja TO pedernal_app;
