-- 0029_revertir_facturacion: deshace la migración 0029_facturacion (el puntero `documento_de_ticket`, el origen `REEMISION_DE_TICKET` y la
-- columna `comprobante_linea.unidad`).
--
-- FALLA CERRADO, SIN BORRAR, si ya hay datos que la usan: una fila de `documento_de_ticket`, una factura con origen `REEMISION_DE_TICKET` o un renglón con unidad. Quitar
-- eso sería perder registros fiscales (un comprobante emitido y, si se autorizó, con CAE), y eso no se hace sin que el dueño lo decida:
-- avisar al dueño y resolver con él antes; este script no se fuerza. Con la columna sin ningún valor y sin comprobantes de ese origen
-- no se pierde nada. Ojo con el código: `comprobante_linea.unidad` la escribe el repositorio de fiscal; sin la columna, emitir falla, así
-- que conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0029_revertir_facturacion.sql
--     COMMIT;
--
-- Deja la facturación como estaba después de 0026. No usa CASCADE. Solo borra su propia fila del registro `migracion`, para que la
-- migración se pueda volver a aplicar. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_reemisiones bigint := 0;
  v_con_unidad bigint := 0;
  v_documentos bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  IF to_regclass('public.documento_de_ticket') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.documento_de_ticket' INTO v_documentos;
  END IF;
  -- Con la columna ya borrada (una repetición) no hay renglones con unidad que contar.
  IF to_regclass('public.comprobante') IS NOT NULL THEN
    SELECT count(*) INTO v_reemisiones FROM public.comprobante WHERE origen_tipo = 'REEMISION_DE_TICKET';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'comprobante_linea' AND column_name = 'unidad'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.comprobante_linea WHERE unidad IS NOT NULL' INTO v_con_unidad;
  END IF;
  IF v_reemisiones + v_con_unidad + v_documentos > 0 THEN
    RAISE EXCEPTION 'hay % punteros de ticket, % comprobantes con origen REEMISION_DE_TICKET y % renglones con unidad: la reversión no los borra (son registros fiscales); avisar al dueño', v_documentos, v_reemisiones, v_con_unidad
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores, políticas y privilegios caen con la tabla (sin CASCADE: si algo depende de ella, falla y no se pierde nada).
DROP TABLE IF EXISTS documento_de_ticket;
DROP FUNCTION IF EXISTS documento_validar_alta();
DROP FUNCTION IF EXISTS documento_validar_cambio();
-- Los privilegios de la columna caen con ella.
ALTER TABLE comprobante_linea DROP COLUMN IF EXISTS unidad;

-- La lista de orígenes vuelve a la de 0009 (sin comprobantes de ese origen: se comprobó arriba).
ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS comprobante_origen_tipo_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_origen_tipo_ck CHECK (origen_tipo IN
  ('MANUAL', 'EJEMPLAR_DE_TICKET', 'PROPINA_DE_TICKET', 'CORRECCION_DE_TICKET', 'SUSCRIPCION'));

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    -- Nombre EXACTO: `0009_facturacion.sql` también termina en `_facturacion.sql`.
    DELETE FROM public.migracion WHERE nombre = '0029_facturacion.sql';
  END IF;
END
$$;
