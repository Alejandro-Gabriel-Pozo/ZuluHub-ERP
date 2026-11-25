-- 0095_dominios_de_empresa_lectura_propia_y_unico_por_superficie: dos cambios chicos sobre `dominio` para el dominio propio de una empresa (P2 del plan de dominio propio).
-- Decisiones del dueño del 25/11/2026 (DEC-0905: un host vigente por empresa y superficie). NINGÚN dato existente cambia ni se borra; no hay INSERT, UPDATE ni DELETE.
--
--  1. LECTURA PROPIA. Hoy la aplicación (`pedernal_app`) solo lee dominios CANÓNICOS (de marca: `dominio_app_leer`, 0007). La carta en línea de una empresa tiene que
--     mostrar SU dirección propia (carta.<dominio del cliente>), así que se suma una política que deja leer, a la aplicación con contexto firmado, los dominios ACTIVOS
--     cuyo dueño es la empresa del contexto. Por FILA: `duenio_empresa_id = app_empresa_id()` (sin empresa en el contexto la función da NULL y la comparación no deja
--     ninguna fila: falla cerrada); solo `ACTIVO` (una dirección que no responde no se muestra). Por COLUMNA: no se otorga nada nuevo (siguen host, superficie, marca_id y
--     es_canonico); las columnas que usa la política (estado, duenio_empresa_id) no necesitan permiso propio, igual que en `dominio_app_leer`. Una empresa nunca lee
--     los dominios de otra, ni los pendientes, verificados o retirados de la suya, ni el titular, la fecha, el motivo ni quién lo registró.
--  2. UN HOST VIGENTE POR EMPRESA Y SUPERFICIE. Índice único parcial sobre (empresa dueña, superficie) para los hosts de empresa de aplicación o carta que no están
--     retirados: una empresa tiene un solo host vigente de aplicación y uno solo de carta. El retiro libera el lugar. NO alcanza a `SITIO` (superficie que todavía no
--     existe; el sitio puede necesitar `www` y el apex) ni a los dominios de una marca. Si ya hubiera filas que lo violan, la migración se detiene y no cambia nada.
--
--
-- Reglas que cumple: ADITIVA (un índice y una política nuevos; nada se modifica ni se quita); sin SECURITY DEFINER; sin DELETE ni TRUNCATE; sin privilegios nuevos; RLS de `dominio` ya
-- ENABLE y FORCE (0007) y una política por comando (solo SELECT); falla cerrado sin empresa o sin firma; COMPATIBLE HACIA ATRÁS: el código viejo sigue andando sin la política (muestra la
-- dirección de Pedernal) y sin el índice (la regla de un host por superficie queda sin imponer hasta aplicarla). Orden de aplicación: primero esta migración (`migrar.yml`, con aprobación del dueño), después el código.
--
-- Su reversión es un script aparte: `migraciones/reversiones/0095_revertir_dominios_de_empresa_lectura_propia_y_unico_por_superficie.sql` (sin pérdida de datos: quita
-- la política y el índice). DEPENDE de 0007 (dominio, roles y `contexto_firmado`) y de 0001 (`app_empresa_id`); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.dominio') IS NULL THEN
    RAISE EXCEPTION 'esta migración requiere 0007_marcas_y_planes aplicada antes (falta dominio)' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.app_empresa_id()') IS NULL OR to_regprocedure('public.contexto_firmado()') IS NULL THEN
    RAISE EXCEPTION 'esta migración requiere las funciones del contexto firmado (0001) aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_app') THEN
    RAISE EXCEPTION 'esta migración requiere el rol pedernal_app' USING ERRCODE = '55000';
  END IF;
  -- Freno: no se crea el índice sobre datos que ya lo violan (se resuelve a mano, retirando uno de los dos, antes de aplicar).
  IF EXISTS (
    SELECT 1 FROM dominio
     WHERE duenio_empresa_id IS NOT NULL AND estado <> 'RETIRADO' AND superficie IN ('APP', 'CARTA')
     GROUP BY duenio_empresa_id, superficie
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'hay empresas con más de un host vigente de la misma superficie: retirar el sobrante antes de aplicar' USING ERRCODE = '55000';
  END IF;
END
$$;

-- 1. Un host vigente por empresa y superficie.
CREATE UNIQUE INDEX dominio_empresa_superficie_uk ON dominio (duenio_empresa_id, superficie)
  WHERE duenio_empresa_id IS NOT NULL AND estado <> 'RETIRADO' AND superficie IN ('APP', 'CARTA');

-- 2. Lectura propia: la aplicación ve los hosts ACTIVOS de SU empresa (una política por comando: solo SELECT; permisiva, se suma a `dominio_app_leer`).
CREATE POLICY dominio_app_leer_propio ON dominio FOR SELECT TO pedernal_app
  USING (
    estado = 'ACTIVO'
    AND duenio_empresa_id = (SELECT app_empresa_id())
    AND (SELECT contexto_firmado()) IS NOT NULL
  );
