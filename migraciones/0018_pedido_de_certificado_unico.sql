-- 0018_pedido_de_certificado_unico: un solo pedido de certificado PENDIENTE por emisor y ambiente (D-92, decisión del dueño del
-- 2026-11-03: «un pedido de certificado nuevo anula al pedido pendiente anterior del mismo ambiente»;
-- `facturador-contratos-de-pantalla.md`). Hasta hoy la base solo garantizaba a lo sumo un certificado VIGENTE (0009,
-- `certificado_vigente_uk`) y la unicidad de la huella: nada impedía dos `PEDIDO_GENERADO` a la vez para el mismo `(emisor, ambiente)`,
-- y que el caso de uso `generarPedidoDeCertificado` descarte al anterior dependía solo de la aplicación. Con este índice lo garantiza
-- también la base (aunque dos pedidos nuevos se crucen, o alguien escriba por otro camino).
--
-- Reglas de esta migración (las mismas de 0001 a 0017):
--  * Es ADITIVA en el esquema: UN índice único parcial y nada más. No toca ninguna tabla, columna, función, disparador, privilegio ni
--    política, y no agrega funciones SECURITY DEFINER (por eso no hay `search_path` que fijar; los nombres van calificados con
--    `public.`). Su reversión es un script aparte (`migraciones/reversiones/0018_revertir_pedido_de_certificado_unico.sql`) que
--    borra el índice; el ejecutor no lo aplica.
--  * Sobre los DATOS es defensiva, no destructiva: si ya hubiera más de un pedido `PEDIDO_GENERADO` para un mismo
--    `(empresa_id, emisor_id, ambiente)` (hoy no hay ninguna base migrada, pero tiene que ser segura igual), deja el más reciente
--    (`creado_en`, y a igual instante el `id` mayor) y pasa los demás a `DESCARTADO`: es la transición que el disparador de
--    `certificado_arca` ya permite (PEDIDO_GENERADO -> DESCARTADO), con los disparadores PRENDIDOS (el de versión sube `version`
--    y `actualizado_en`, como en cualquier descarte). No borra filas (el disparador de borrado lo impediría): el pedido descartado
--    y su clave cifrada quedan. Cada descarte deja su auditoría `CERTIFICADO_PEDIDO_DESCARTADO` en `auditoria_empresa`, sin actor
--    (actor de sistema: lo hizo la migración) y con el pedido que lo reemplaza, como la deja el caso de uso. Un VIGENTE, un
--    REEMPLAZADO o un DESCARTADO no se tocan. Lo hace el rol que migra, con el RLS evadido (igual que 0016).
--  * Se bloquea la tabla (SHARE ROW EXCLUSIVE: nadie escribe, sí se lee) entre la limpieza y el índice, para que un pedido que llegue
--    justo en el medio no deje un duplicado nuevo; el ejecutor fija `lock_timeout`, así que si otra sesión no suelta la tabla falla
--    en vez de hacer cola.
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro).
--  * DEPENDE de 0009 (la tabla `certificado_arca` y su disparador de cambio); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.certificado_arca') IS NULL
     OR to_regprocedure('public.certificado_arca_validar_cambio()') IS NULL
     OR to_regclass('public.auditoria_empresa') IS NULL THEN
    RAISE EXCEPTION 'el pedido de certificado único requiere 0009_facturacion aplicada antes (falta certificado_arca o su disparador de cambio)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

LOCK TABLE public.certificado_arca IN SHARE ROW EXCLUSIVE MODE;

-- Limpieza defensiva: de varios pendientes del mismo (empresa, emisor, ambiente) queda el más reciente. La subconsulta de la
-- auditoría mira la foto de ANTES del UPDATE (así encuentra al que queda: el más reciente de los pendientes).
WITH descartados AS (
  UPDATE public.certificado_arca c
     SET estado = 'DESCARTADO'
   WHERE c.estado = 'PEDIDO_GENERADO'
     AND EXISTS (
       SELECT 1 FROM public.certificado_arca m
        WHERE m.empresa_id = c.empresa_id AND m.emisor_id = c.emisor_id AND m.ambiente = c.ambiente
          AND m.estado = 'PEDIDO_GENERADO' AND (m.creado_en, m.id) > (c.creado_en, c.id)
     )
  RETURNING c.id, c.empresa_id, c.emisor_id, c.ambiente
)
INSERT INTO public.auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id, antes, despues)
SELECT d.empresa_id, NULL, 'CERTIFICADO_PEDIDO_DESCARTADO', 'certificado_arca', d.id::text,
       jsonb_build_object('estado', 'PEDIDO_GENERADO'),
       jsonb_build_object(
         'estado', 'DESCARTADO',
         'reemplazadoPor', (
           SELECT m.id FROM public.certificado_arca m
            WHERE m.empresa_id = d.empresa_id AND m.emisor_id = d.emisor_id AND m.ambiente = d.ambiente
              AND m.estado = 'PEDIDO_GENERADO'
            ORDER BY m.creado_en DESC, m.id DESC LIMIT 1
         )
       )
  FROM descartados d;

-- Con la limpieza hecha no puede quedar ningún duplicado; si el rol que migra no pudo ver o escribir las filas (RLS), se frena acá
-- con un mensaje claro y no con el error genérico del índice.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.certificado_arca WHERE estado = 'PEDIDO_GENERADO'
     GROUP BY empresa_id, emisor_id, ambiente HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'quedan pedidos de certificado pendientes repetidos para un mismo emisor y ambiente: la limpieza no pudo descartarlos'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- A lo sumo un pedido PENDIENTE por emisor y ambiente.
CREATE UNIQUE INDEX certificado_pendiente_uk ON public.certificado_arca (empresa_id, emisor_id, ambiente)
  WHERE estado = 'PEDIDO_GENERADO';
