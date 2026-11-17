-- 0065_producto_en_la_linea_de_la_factura: la línea de una factura del proveedor puede decir de qué producto es (compras N3, E9 T13: «la conciliación se propone sola: mismo proveedor, mismo producto»).
-- Hasta 0037 la línea solo guardaba `descripcion` (el texto del papel) y `unidad`: en N1 y N2 la factura se carga con la compra y cada línea se asocia a su renglón por posición, pero en N3 la
-- factura llega SOLA (antes o después de la mercadería) y sin el producto no hay forma de proponer qué recepción cubre cada línea. Quien carga la factura elige el producto de cada línea.
-- ADITIVA y compatible hacia atrás: una columna NULABLE nueva, su clave foránea compuesta, el permiso de alta por columna y un índice. Las líneas de N1 y N2, y las ya cargadas, quedan en
-- NULL y no cambian (la línea sigue siendo de solo inserción, `linea_de_comprobante_solo_insercion`). No cambia ninguna otra tabla ni función; sin SECURITY DEFINER.
-- Reversión: `migraciones/reversiones/0065_revertir_producto_en_la_linea_de_la_factura.sql` (FRENA si hay líneas con producto, salvo `pedernal.confirmar_reversion = 'SI'`).
-- DEPENDE de 0037 (`linea_de_comprobante`) y 0025 (`producto_id_empresa_uk`); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.linea_de_comprobante') IS NULL OR to_regclass('public.producto') IS NULL THEN
    RAISE EXCEPTION '0065 necesita 0037 (linea_de_comprobante) y 0025 (producto)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'linea_de_comprobante' AND column_name = 'producto_id') THEN
    RAISE EXCEPTION '0065: linea_de_comprobante.producto_id ya existe; esta migración solo agrega objetos nuevos' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE linea_de_comprobante ADD COLUMN producto_id uuid;
ALTER TABLE linea_de_comprobante ADD CONSTRAINT linea_de_comprobante_producto_fkey
  FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id);
CREATE INDEX linea_de_comprobante_producto_ix ON linea_de_comprobante (empresa_id, producto_id) WHERE producto_id IS NOT NULL;
GRANT INSERT (producto_id) ON linea_de_comprobante TO pedernal_app;
