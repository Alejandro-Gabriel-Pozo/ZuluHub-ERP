-- 0029_facturacion: facturar un documento armado por otro módulo (E1; decisiones 148, 149, 150, 174, 175 y 177 del dueño). Parte FISCAL:
-- un origen nuevo de comprobante (`REEMISION_DE_TICKET`) y la unidad opcional del renglón (`comprobante_linea.unidad`). Diseño:
-- Pedernal-docs/11-especificaciones/e1-facturador-especificacion.md §3.1, §3.2 y §3.5. La parte de VENTAS (`documento_de_ticket`) la suma
-- el tramo E1-T3, en este mismo archivo, cuando la migración de ventas (0028) esté en `main`: hasta entonces la numeración salta de 0026 a
-- 0029 (0027 caja y 0028 ventas se construyen en paralelo), un hueco esperado como el de 0020.
--
-- Reglas de esta migración (las mismas de 0001 a 0026):
--  * Es ADITIVA y compatible hacia atrás: la lista de orígenes admitidos es un SUPERCONJUNTO de la anterior, la columna nueva admite
--    NULL y las filas que ya existen quedan en NULL (válido). No se rellena nada, no se borra nada, ningún dato cambia de lugar.
--  * Su reversión es un script aparte, revisado, que falla cerrado SIN borrar si ya hay datos que la usan (una factura con origen
--    `REEMISION_DE_TICKET` o un renglón con unidad): `migraciones/reversiones/0029_revertir_facturacion.sql`. El ejecutor no la aplica.
--  * `comprobante_linea` es de solo inserción (disparadores de 0009): la columna nueva se escribe al insertar el renglón y no se
--    modifica después. El privilegio es por columna, como el resto de la tabla.
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro).
--
-- Decisiones de diseño (probadas por `test/integracion/facturacion-migracion-0029.test.ts`):
--
--  F1. `REEMISION_DE_TICKET` es un tipo de origen opaco para fiscal, como los demás (D-F-2): una factura autorizada y acreditada por una
--      nota total sigue «vigente» para la identidad `(empresa, origen, emisor, clase)` (`comprobante_identidad_uk`), así que reemitir con
--      el mismo origen devolvería la acreditada. La reemisión usa otro origen y esa clave de identidad no cambia.
--  F2. La unidad es el SÍMBOLO impreso («kg»), no el código: fiscal no depende de la tabla del catálogo ni duplica su lista. La forma
--      permitida es la misma lista de permitidos que `unidad_de_medida.simbolo` (0025, `unidad_simbolo_ck`); una prueba las compara.
--      WSFE no recibe renglones: la unidad solo se imprime.

DO $$
BEGIN
  IF to_regclass('public.comprobante') IS NULL OR to_regclass('public.comprobante_linea') IS NULL THEN
    RAISE EXCEPTION 'la facturación de un documento de origen requiere 0009 (comprobante y comprobante_linea) aplicada antes'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'comprobante_linea' AND column_name = 'unidad'
  ) THEN
    RAISE EXCEPTION 'la unidad del renglón nace en 0029: la columna comprobante_linea.unidad ya existe (alguien la creó a mano); hay que revisarla antes de migrar'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- F1. Origen nuevo: la misma lista de 0009 más `REEMISION_DE_TICKET` (superconjunto: toda fila existente la cumple)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE comprobante DROP CONSTRAINT comprobante_origen_tipo_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_origen_tipo_ck CHECK (origen_tipo IN
  ('MANUAL', 'EJEMPLAR_DE_TICKET', 'REEMISION_DE_TICKET', 'PROPINA_DE_TICKET', 'CORRECCION_DE_TICKET', 'SUSCRIPCION'));

-- ---------------------------------------------------------------------------------------------
-- F2. Unidad opcional del renglón
-- ---------------------------------------------------------------------------------------------
ALTER TABLE comprobante_linea ADD COLUMN unidad text
  CONSTRAINT comprobante_linea_unidad_ck CHECK (unidad IS NULL OR unidad ~ '^[A-Za-z0-9]{1,8}$');

GRANT INSERT (unidad) ON comprobante_linea TO pedernal_app;
