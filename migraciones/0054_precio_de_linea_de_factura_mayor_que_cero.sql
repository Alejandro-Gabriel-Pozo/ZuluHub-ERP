-- 0054_precio_de_linea_de_factura_mayor_que_cero: el precio neto de una línea de factura del proveedor es mayor que cero (D8 de la auditoría de reglas).
-- Decisión del dueño (14/11/2026, respuesta a la pregunta de D8 relayada por la sesión madre): NO se carga una línea de factura a precio cero; se aprieta la base.
-- El dominio ya lo rechazaba (`leerPrecioPositivo`: `PRECIO_INVALIDO`, como la recepción, DEC-0302); la base lo admitía (`precio_neto >= 0`, 0037). Esta migración alinea la base.
--
-- Qué cambia: `linea_de_comprobante_precio_ck` pasa de `>= 0` a `> 0`, con el mismo nombre. Aprieta la base, no la afloja; no cambia ninguna fila ni columna.
-- FRENO: si hay una línea con precio cero la migración se detiene SIN cambiar nada (qué hacer con esa factura lo decide el negocio).
-- Reversión: `migraciones/reversiones/0054_revertir_precio_de_linea_de_factura_mayor_que_cero.sql` (vuelve a `>= 0`; no pierde datos).
-- DEPENDE de 0037 (compras); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.linea_de_comprobante') IS NULL THEN
    RAISE EXCEPTION 'el precio de línea mayor que cero requiere 0037_compras aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.linea_de_comprobante WHERE precio_neto <= 0) THEN
    RAISE EXCEPTION 'hay líneas de factura con precio cero: se resuelven antes de migrar (decide el negocio)' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE linea_de_comprobante DROP CONSTRAINT linea_de_comprobante_precio_ck;
ALTER TABLE linea_de_comprobante ADD CONSTRAINT linea_de_comprobante_precio_ck
  CHECK (precio_neto > 0 AND precio_neto < 10000000000000);
