-- 0053_costo_nunca_cero: el costo de stock es mayor que cero; «sin costo» es costo nulo, nunca cero (D7 de la auditoría de reglas).
-- Decisión del dueño: CYN 125 (09/11/2026, «una entrada sin precio queda "sin costo", nunca cero»; `e5-stock-especificacion.md:23,188`, `conceptos/sin-costo.md`).
-- El código ya lo hace (`leerCostoDeclarado` rechaza cero: `COSTO_INVALIDO`); la base lo admitía (`costo_unitario >= 0`, 0031). Esta migración alinea la base.
--
-- Qué cambia: `costo_de_articulo_costo_ck` (el promedio) y `costo_de_renglon_costo_ck` (el costo congelado) pasan de `>= 0` a `> 0`, con el mismo nombre
-- (el mapeo a `COSTO_INVALIDO` de `errores-por-restriccion.ts` sigue valiendo). Para el renglón, `costo_de_renglon_estado_y_costo_ck` (SIN_COSTO ⇔ costo nulo) no cambia.
-- Aprieta la base, no la afloja: no cambia ninguna fila ni columna.
--
-- FRENO: si hay filas con costo cero la migración se detiene SIN cambiar nada (corregirlas es una decisión de negocio: ¿sin costo o costo real?).
-- Reversión: `migraciones/reversiones/0053_revertir_costo_nunca_cero.sql` (vuelve a `>= 0`; no pierde datos).
-- DEPENDE de 0031 (costos de stock); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.costo_de_articulo') IS NULL OR to_regclass('public.costo_de_renglon') IS NULL THEN
    RAISE EXCEPTION 'el costo nunca cero requiere 0031_stock_costos aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.costo_de_articulo WHERE costo_unitario <= 0) THEN
    RAISE EXCEPTION 'hay promedios de costo en cero: se corrigen antes de migrar (cambio de datos que decide el negocio)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.costo_de_renglon WHERE costo_unitario <= 0) THEN
    RAISE EXCEPTION 'hay costos congelados en cero: se corrigen antes de migrar (cambio de datos que decide el negocio)' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE costo_de_articulo DROP CONSTRAINT costo_de_articulo_costo_ck;
ALTER TABLE costo_de_articulo ADD CONSTRAINT costo_de_articulo_costo_ck
  CHECK (costo_unitario > 0 AND costo_unitario < 1000000000000);

ALTER TABLE costo_de_renglon DROP CONSTRAINT costo_de_renglon_costo_ck;
ALTER TABLE costo_de_renglon ADD CONSTRAINT costo_de_renglon_costo_ck
  CHECK (costo_unitario > 0 AND costo_unitario < 1000000000000);
