-- 0060_correccion_de_compra_ampliada: la corrección de una compra puede cambiar también la cantidad o el peso real y completar el precio de una línea «Sin precio» (decisión del
-- dueño 15/11/2026, «Respuestas 24 a 27», Q2 = C; pantallas-de-compras-inventario.md, §8 bis). La corrección sigue siendo una fila nueva (la línea original no se edita).
--  * `precio_por_tipo` y `unidad_de_precio_id`: el «precio por» del precio nuevo. Solo se guardan al COMPLETAR una línea «Sin precio» (precio anterior nulo y precio nuevo): en las demás
--    correcciones el «precio por» es el de la línea y no cambia.
--  * `peso_real_anterior` y `peso_real_nuevo`: el peso real de una línea de peso variable (no se recarga el sentido de `cantidad_*`, que es la cantidad de compra).
--  * `correccion_de_compra_cambia_algo_ck` pasa a «cambia el precio, la cantidad o el peso real».
-- Previene: una corrección que cambia el peso y no deja rastro de cuánto era, o un precio completado sin saber «por qué» se cobró (el costo no se puede recalcular).
--
-- Reglas de esta migración (las mismas de 0036 y 0047):
--  * Es ADITIVA y compatible hacia atrás: cuatro columnas nullable (las correcciones que ya existen quedan con NULL en las cuatro, y cumplen los CHECK nuevos), un CHECK que se
--    reemplaza por otro que admite lo mismo y más, y un permiso de INSERT por columna. No rellena ni borra nada; la tabla sigue siendo de solo inserción.
--  * No agrega funciones, no cambia roles ni da UPDATE ni DELETE.
--  * Su reversión es `migraciones/reversiones/0060_revertir_correccion_de_compra_ampliada.sql` (DESTRUCTIVA si hay correcciones que usan las columnas nuevas: pierde lo cargado en ellas;
--    frena antes). El ejecutor no la aplica.
-- DEPENDE de 0037 (la tabla, sus CHECK y sus permisos); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.correccion_de_compra') IS NULL THEN
    RAISE EXCEPTION '0060 necesita 0037 (correccion_de_compra)';
  END IF;
END
$$;

ALTER TABLE correccion_de_compra
  ADD COLUMN precio_por_tipo text CONSTRAINT correccion_de_compra_precio_por_ck CHECK (precio_por_tipo IN ('PRESENTACION', 'UNIDAD')),
  ADD COLUMN unidad_de_precio_id text REFERENCES unidad_de_medida (id),
  ADD COLUMN peso_real_anterior numeric(18,4) CONSTRAINT correccion_de_compra_peso_anterior_ck CHECK (peso_real_anterior > 0 AND peso_real_anterior < 100000000000000),
  ADD COLUMN peso_real_nuevo numeric(18,4) CONSTRAINT correccion_de_compra_peso_nuevo_ck CHECK (peso_real_nuevo > 0 AND peso_real_nuevo < 100000000000000);

-- El «precio por» solo viaja al completar «Sin precio» (precio anterior nulo y precio nuevo); por UNIDAD lleva su unidad de precio, por PRESENTACION no.
ALTER TABLE correccion_de_compra
  ADD CONSTRAINT correccion_de_compra_precio_por_completa_ck CHECK (
    (precio_por_tipo IS NOT NULL) = (precio_anterior IS NULL AND precio_nuevo IS NOT NULL)
    AND (unidad_de_precio_id IS NOT NULL) = (precio_por_tipo = 'UNIDAD')),
  -- El peso real viaja de a pares: lo que era y lo que pasa a ser.
  ADD CONSTRAINT correccion_de_compra_peso_par_ck CHECK ((peso_real_anterior IS NULL) = (peso_real_nuevo IS NULL));

ALTER TABLE correccion_de_compra DROP CONSTRAINT correccion_de_compra_cambia_algo_ck;
ALTER TABLE correccion_de_compra
  ADD CONSTRAINT correccion_de_compra_cambia_algo_ck CHECK (precio_nuevo IS NOT NULL OR cantidad_nueva IS NOT NULL OR peso_real_nuevo IS NOT NULL);

GRANT INSERT (precio_por_tipo, unidad_de_precio_id, peso_real_anterior, peso_real_nuevo) ON correccion_de_compra TO pedernal_app;
