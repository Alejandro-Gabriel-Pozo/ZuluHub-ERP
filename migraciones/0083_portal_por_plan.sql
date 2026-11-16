-- 0083_portal_por_plan (PROPUESTA, sin aplicar): el rol público (`pedernal_publico`) lee, con el código DEL PORTAL, los módulos, el plan vigente, las versiones de plan y los
-- ajustes de perilla de la empresa del portal, para decidir EN CADA VISITA si el portal se puede servir (igual que 0050 hace con la carta). Respuesta del dueño del 16/11/2026
-- a la pregunta 5 de `carta-identidad-y-portal-datos-diseno.md`: «el portal deja de verse si la empresa baja de plan o pierde el módulo».
-- Solo LECTURA: ningún GRANT nuevo (las columnas son las de 0050), ningún INSERT, UPDATE, DELETE ni función. Nada de SECURITY DEFINER.
--
-- Cómo queda cerrado (denegar por defecto): por FILA, cada política deja ver solo lo que cuelga de la empresa del portal cuyo `codigo` es igual a `app.codigo_de_portal`.
-- Sin ese valor NINGUNA de las cuatro tablas devuelve filas. El plan de OTRO tenant y los ajustes de otra empresa del mismo tenant no se ven jamás.
-- Reversión: migraciones/reversiones/0083_revertir_portal_por_plan.sql (sin pérdida de datos: solo quita políticas).
-- DEPENDE de 0050 y de 0078; se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.portal_de_empresa') IS NULL THEN
    RAISE EXCEPTION 'el portal por plan requiere 0078_portal_de_la_empresa aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'modulo_de_empresa' AND policyname = 'modulo_de_empresa_publico_de_carta') THEN
    RAISE EXCEPTION 'el portal por plan requiere 0050_plan_en_la_lectura_publica_de_carta aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_publico') THEN
    RAISE EXCEPTION 'el portal por plan requiere el rol pedernal_publico (0007)' USING ERRCODE = '55000';
  END IF;
END
$$;

DROP POLICY IF EXISTS modulo_de_empresa_publico_de_portal ON modulo_de_empresa;
CREATE POLICY modulo_de_empresa_publico_de_portal ON modulo_de_empresa FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.portal_de_empresa p
     WHERE p.codigo = current_setting('app.codigo_de_portal', true) AND p.empresa_id = modulo_de_empresa.empresa_id
  ));

-- Las asignaciones del tenant dueño de la empresa del portal (el plan es del tenant, no de la empresa).
DROP POLICY IF EXISTS plan_de_tenant_publico_de_portal ON plan_de_tenant;
CREATE POLICY plan_de_tenant_publico_de_portal ON plan_de_tenant FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.portal_de_empresa p JOIN public.empresa e ON e.id = p.empresa_id
     WHERE p.codigo = current_setting('app.codigo_de_portal', true) AND e.tenant_id = plan_de_tenant.tenant_id
  ));

-- Solo las versiones que ESE tenant tiene asignadas (nunca el catálogo de planes ni las de otro cliente).
DROP POLICY IF EXISTS version_de_plan_publico_de_portal ON version_de_plan;
CREATE POLICY version_de_plan_publico_de_portal ON version_de_plan FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.plan_de_tenant a
      JOIN public.empresa e ON e.tenant_id = a.tenant_id
      JOIN public.portal_de_empresa p ON p.empresa_id = e.id
     WHERE a.version_de_plan_id = version_de_plan.id AND p.codigo = current_setting('app.codigo_de_portal', true)
  ));

-- Los ajustes de todo el tenant y los de LA empresa del portal; nunca los de otra empresa del mismo tenant.
DROP POLICY IF EXISTS ajuste_de_perilla_publico_de_portal ON ajuste_de_perilla;
CREATE POLICY ajuste_de_perilla_publico_de_portal ON ajuste_de_perilla FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.portal_de_empresa p JOIN public.empresa e ON e.id = p.empresa_id
     WHERE p.codigo = current_setting('app.codigo_de_portal', true) AND e.tenant_id = ajuste_de_perilla.tenant_id
       AND (ajuste_de_perilla.empresa_id IS NULL OR ajuste_de_perilla.empresa_id = p.empresa_id)
  ));
