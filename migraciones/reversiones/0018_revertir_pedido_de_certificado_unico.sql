-- 0018_revertir_pedido_de_certificado_unico: deshace la migración 0018_pedido_de_certificado_unico: borra el índice único parcial
-- `certificado_pendiente_uk`. Después de esto la base vuelve a dejar convivir varios pedidos `PEDIDO_GENERADO` del mismo emisor y
-- ambiente (el caso de uso seguirá descartando al anterior, pero la base ya no lo garantiza).
--
-- NO ES DESTRUCTIVA: borra un índice (se recrea con el SQL de 0018) y no toca ninguna tabla, columna ni fila de negocio. NO deshace
-- la limpieza de datos de 0018 (los pedidos que descartó siguen DESCARTADOS, con su auditoría): un descarte no se revierte, no hay
-- transición de vuelta (el disparador de `certificado_arca` no la permite). Solo borra su propia fila del registro `migracion`, para
-- que 0018 pueda volver a aplicarse.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`):
-- se corre a mano, revisado, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0018_revertir_pedido_de_certificado_unico.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada.

DROP INDEX IF EXISTS public.certificado_pendiente_uk;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (y la guarda MIGRACION_REQUERIDA='0018'
-- dejaría pasar código nuevo sobre una base sin el índice).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_pedido_de_certificado_unico.sql' ESCAPE '\';
  END IF;
END
$$;
