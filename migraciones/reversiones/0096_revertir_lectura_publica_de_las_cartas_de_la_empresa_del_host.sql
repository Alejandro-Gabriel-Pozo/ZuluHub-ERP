-- 0096_revertir_lectura_publica_de_las_cartas_de_la_empresa_del_host: deshace 0096_lectura_publica_de_las_cartas_de_la_empresa_del_host. Quita la política que deja al rol público listar las cartas
-- en línea de una empresa (el rol público vuelve a ver una carta solo por su código). NO borra ni cambia ninguna fila. Conviene bajar antes el código de la raíz de la carta (sin la política
-- recibiría lista vacía y mostraría la 404 neutra: no se rompe nada, pero la raíz deja de redirigir).
--
-- Este script NO lo aplica el ejecutor de migraciones: se corre a mano, revisado, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0096_revertir_lectura_publica_de_las_cartas_de_la_empresa_del_host.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada.

DROP POLICY IF EXISTS carta_publica_publico_leer_de_la_empresa_del_host ON carta_publica;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0096_lectura_publica_de_las_cartas_de_la_empresa_del_host.sql';
  END IF;
END
$$;
