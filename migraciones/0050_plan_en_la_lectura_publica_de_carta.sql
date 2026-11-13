-- 0050_plan_en_la_lectura_publica_de_carta: lo que el rol público (`pedernal_publico`) necesita leer de marcas y planes para decidir, EN CADA VISITA, si la carta de una
-- empresa se puede servir (T6 de la carta real, riesgo R3): que la empresa siga teniendo el módulo de la carta y la perilla `vidriera_por_qr` encendida. Sin esto, un
-- cliente que baja de plan seguía mostrando su carta hasta que alguien la retirara.
-- Decisión del dueño, 13/11/2026 (`11-especificaciones/decisiones-del-dueno-2026-11.md`, fila «Carta pública y plan (T6)»): el rol público lee, con filtro por la
-- empresa de la carta y solo columnas mínimas, los módulos de la empresa, su plan vigente, las versiones de plan asignadas (solo módulos y perillas, sin nombre
-- comercial ni precios) y los ajustes de perilla (sin motivo ni autor). Solo LECTURA: ningún INSERT, UPDATE, DELETE ni función nueva; nada de SECURITY DEFINER.
--
-- Cómo queda cerrado (denegar por defecto):
--  * Por COLUMNA: cada tabla se otorga con la lista exacta de abajo; nunca `SELECT` de tabla entera. Una prueba enumera lo otorgado y falla si hay una columna más.
--  * Por FILA: cada política deja ver solo lo que cuelga de la empresa de la carta cuyo `codigo` es igual a `app.codigo_de_carta` (lo fija la lectura pública dentro de
--    su transacción) y que está `EN_LINEA` (la política de `carta_publica` de 0043). Sin ese valor, NINGUNA de las cuatro tablas devuelve filas. El plan de OTRO tenant
--    (y los ajustes de otra empresa del mismo tenant) no se ven jamás.
--  * Nunca se otorga: nombre comercial, motivo, publicada_por, origen, asignado_por, `reemplaza_programada`, creado_en ni la versión (optimistic locking).
--
-- Su reversión es un script aparte: `migraciones/reversiones/0050_revertir_plan_en_la_lectura_publica_de_carta.sql` (sin pérdida de datos: solo quita permisos y políticas).
-- DEPENDE de 0007 (marcas y planes), 0043 (carta pública) y 0044 (lectura pública de la carta); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.carta_publica') IS NULL OR to_regclass('public.disponibilidad_de_producto') IS NULL THEN
    RAISE EXCEPTION 'la lectura pública del plan requiere 0043_carta_publica aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'empresa' AND policyname = 'empresa_publico_de_carta') THEN
    RAISE EXCEPTION 'la lectura pública del plan requiere 0044_lectura_publica_de_carta aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.modulo_de_empresa') IS NULL OR to_regclass('public.plan_de_tenant') IS NULL
     OR to_regclass('public.version_de_plan') IS NULL OR to_regclass('public.ajuste_de_perilla') IS NULL THEN
    RAISE EXCEPTION 'la lectura pública del plan requiere 0007_marcas_y_planes aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_publico') THEN
    RAISE EXCEPTION 'la lectura pública del plan requiere el rol pedernal_publico (0007)' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, solo SELECT. `version_de_plan.plan_id` y `.numero` son identificadores (los pide el cálculo de derechos, que es el mismo del resto
-- del sistema); no dicen nada del negocio del plan.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT (empresa_id, modulo, activo) ON modulo_de_empresa TO pedernal_publico;
GRANT SELECT (tenant_id, numero, version_de_plan_id, vigente_desde) ON plan_de_tenant TO pedernal_publico;
GRANT SELECT (id, plan_id, numero, modulos, perillas) ON version_de_plan TO pedernal_publico;
GRANT SELECT (tenant_id, empresa_id, perilla, numero, vigente_desde, valor) ON ajuste_de_perilla TO pedernal_publico;

-- ---------------------------------------------------------------------------------------------
-- Políticas del rol público. `current_setting(…, true)` da NULL si no se fijó: no compara igual a nada. Cada una pasa por `carta_publica`, que ya está filtrada a la
-- carta pedida y en línea.
-- ---------------------------------------------------------------------------------------------
CREATE POLICY modulo_de_empresa_publico_de_carta ON modulo_de_empresa FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = modulo_de_empresa.empresa_id
  ));

-- Las asignaciones del tenant dueño de la empresa de la carta (el plan es del tenant, no de la empresa).
CREATE POLICY plan_de_tenant_publico_de_carta ON plan_de_tenant FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c JOIN public.empresa e ON e.id = c.empresa_id
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND e.tenant_id = plan_de_tenant.tenant_id
  ));

-- Solo las versiones que ESE tenant tiene asignadas (nunca el catálogo de planes ni las de otro cliente).
CREATE POLICY version_de_plan_publico_de_carta ON version_de_plan FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.plan_de_tenant a
      JOIN public.empresa e ON e.tenant_id = a.tenant_id
      JOIN public.carta_publica c ON c.empresa_id = e.id
     WHERE a.version_de_plan_id = version_de_plan.id AND c.codigo = current_setting('app.codigo_de_carta', true)
  ));

-- Los ajustes de todo el tenant y los de LA empresa de la carta; nunca los de otra empresa del mismo tenant.
CREATE POLICY ajuste_de_perilla_publico_de_carta ON ajuste_de_perilla FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c JOIN public.empresa e ON e.id = c.empresa_id
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND e.tenant_id = ajuste_de_perilla.tenant_id
       AND (ajuste_de_perilla.empresa_id IS NULL OR ajuste_de_perilla.empresa_id = c.empresa_id)
  ));
