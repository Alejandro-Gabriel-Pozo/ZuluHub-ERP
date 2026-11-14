-- 0051_porciones_del_producto: las fracciones en que se vende un producto (A7, «Cómo se vende»). Decisiones del dueño (`decisiones-del-dueno-2026-11.md`): 12/11/2026
-- «solo 2, 4 y 8» (en cuántas partes se divide el entero: ½, ¼, ⅛; una o varias a la vez) y 14/11/2026 «la venta por fracciones y por peso se construye ya, con perilla
-- apagada por defecto; el paso mínimo se deriva de las fracciones que se ofrecen».
--
-- ADITIVA y compatible hacia atrás: una columna con valor por defecto (`'{}'` = sin fracciones, como todo producto de hoy) y una restricción que los datos
-- existentes cumplen (todos tienen la lista vacía). Sin relleno de datos ni cambio de lo que hay. Lo impone la base aunque el código se olvide:
--  * solo las siete listas posibles, ya ordenadas y sin repetir ({2}, {4}, {8}, {2,4}, {2,8}, {4,8}, {2,4,8}): tercios y sextos no entran;
--  * con fracciones el paso mínimo ES 1 / la porción más fina (2 y 8 → 0,125): no es un dato aparte que pueda quedar torcido;
--  * las fracciones son de un producto «por unidad» (unidad de venta = unidad base, dimensión CONTEO), y de uno que se vende.
-- Su reversión es un script aparte: `migraciones/reversiones/0051_revertir_porciones_del_producto.sql` (frena si algún producto ya tiene fracciones).
-- DEPENDE de 0025 (catálogo); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.producto') IS NULL THEN
    RAISE EXCEPTION 'las porciones del producto requieren 0025_catalogo aplicada antes' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE producto ADD COLUMN porciones_ofrecidas smallint[] NOT NULL DEFAULT '{}';

-- Una sola restricción con las tres reglas: (1) solo las siete listas posibles, ya ordenadas y sin repetir; (2) con fracciones el paso ES 1 / la porción más fina (la
-- última de la lista ordenada; `1::numeric / 8` es exacto: 0,125); (3) las fracciones son de un producto «por unidad» (unidad de venta = unidad base, de conteo) y de
-- uno que se vende.
ALTER TABLE producto ADD CONSTRAINT producto_porciones_ck CHECK (
  porciones_ofrecidas IN (
    '{}'::smallint[], '{2}'::smallint[], '{4}'::smallint[], '{8}'::smallint[],
    '{2,4}'::smallint[], '{2,8}'::smallint[], '{4,8}'::smallint[], '{2,4,8}'::smallint[])
  AND (
    cardinality(porciones_ofrecidas) = 0
    OR (paso_minimo = 1::numeric / porciones_ofrecidas[cardinality(porciones_ofrecidas)]
        AND unidad_de_venta_id = unidad_base_id AND dimension = 'CONTEO'
        AND clase_de_uso IN ('VENDIBLE', 'REVENTA'))));

-- Se escribe junto con la forma de venta (`cambiarFormaDeVenta`); el alta nace sin fracciones (valor por defecto).
GRANT UPDATE (porciones_ofrecidas) ON producto TO pedernal_app;
