import type { Generated } from "kysely";

export type SoporteDb = {
  tenant: {
    id: Generated<string>;
    nombre: string;
    estado: string;
    motivo_estado: string | null;
    creado_en: Date;
    marca_id: string;
  };
  marca: { id: string; codigo: string };
  version_de_marca: {
    marca_id: string;
    numero: number | null;
    estado: string;
    vigente_desde: Date | null;
    nombre_visible: string | null;
  };
  plan: { id: string; codigo: string };
  version_de_plan: {
    id: string;
    plan_id: string;
    numero: number | null;
    nombre_comercial: string;
    perillas: unknown;
  };
  plan_de_tenant: {
    tenant_id: string;
    numero: number;
    version_de_plan_id: string;
    vigente_desde: Date;
  };
  ajuste_de_perilla: {
    tenant_id: string;
    empresa_id: string | null;
    perilla: string;
    numero: number;
    valor: string;
    vigente_desde: Date;
  };
  empresa: {
    id: Generated<string>;
    tenant_id: string;
    cuit: string;
    razon_social: string;
    estado: string;
    motivo_estado: string | null;
    zona_horaria: string;
    moneda: string;
    creado_en: Date;
  };
  persona: { id: Generated<string>; email: string; activo_global: boolean };
  membresia: { empresa_id: string; persona_id: string; rol: string; activo: boolean };
  invitacion: {
    id: string;
    tenant_id: string;
    tipo: string;
    email: string;
    estado: string;
    emitida_en: Date;
    vence_en: Date;
    aceptada_por: string | null;
    reemplazada_por: string | null;
    version: number;
  };
  invitacion_empresa: { invitacion_id: string; empresa_id: string; rol: string; tipo: string };
  trabajo: {
    id: Generated<string>;
    empresa_id: string | null;
    tipo: string;
    datos: unknown;
    estado: string;
    intentos: number;
    ultimo_error: string | null;
    creado_en: Date;
    actualizado_en: Date;
  };
  auditoria_plataforma: {
    id: Generated<string>;
    actor: string;
    accion: string;
    entidad: string;
    entidad_id: string;
    antes: unknown;
    despues: unknown;
    creado_en: Date;
  };
  referencia_de_error: {
    id: Generated<string>;
    referencia: string;
    accion: string;
    motivo: string;
    empresa_id: string | null;
    persona_id: string | null;
    creado_en: Date;
  };
};
