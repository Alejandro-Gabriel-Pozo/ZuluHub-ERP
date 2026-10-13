/**
 * Esquema de base del módulo de identidad (migración `0002_identidad.sql`). Lo comparan los tests
 * del catálogo contra la base real: si una columna o una restricción cambia en el SQL, estas dos
 * listas tienen que cambiar con ella. Los repositorios (tramo siguiente) se apoyan en esto.
 */

/** Columnas de cada tabla, en el orden de la base. `persona` es de 0001 (más `usuario_auth_id`, de 0010); `traspaso_gerencia` es de 0005. */
export const COLUMNAS_DE_IDENTIDAD = {
  persona: ["id", "email", "activo_global", "creado_en", "usuario_auth_id"],
  membresia: [
    "empresa_id",
    "persona_id",
    "rol",
    "activo",
    "invitacion_id",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  asignacion_sucursal: [
    "empresa_id",
    "persona_id",
    "sucursal_id",
    "activa",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  invitacion: [
    "id",
    "tenant_id",
    "tipo",
    "email",
    "token_hash",
    "estado",
    "emitida_en",
    "vence_en",
    "emitida_por",
    "aceptada_por",
    "aceptada_en",
    "revocada_en",
    "motivo_revocacion",
    "reemplazada_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  invitacion_empresa: [
    "invitacion_id",
    "empresa_id",
    "tenant_id",
    "rol",
    "email",
    "token_hash",
    "estado",
    "tipo",
  ],
  invitacion_sucursal: ["invitacion_id", "empresa_id", "sucursal_id"],
  // 0005 (H6)
  traspaso_gerencia: [
    "id",
    "empresa_id",
    "origen",
    "propuesto_por",
    "saliente_persona_id",
    "entrante_persona_id",
    "estado",
    "propuesto_en",
    "vence_en",
    "resuelto_en",
    "motivo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
} as const;

/**
 * Restricción de la base → error de negocio (ADR-004). Un test exige que no falte ninguna y que no
 * sobre ninguna. `NO_TRADUCIDA`: no tiene un error de negocio propio (si salta, es un defecto).
 * Las tres últimas las lanzan disparadores con el nombre de restricción indicado.
 */
export const ERRORES_DE_IDENTIDAD_POR_RESTRICCION: Readonly<Record<string, string>> = {
  // persona (de 0001, completada acá)
  persona_pkey: "NO_TRADUCIDA",
  persona_email_ck: "EMAIL_INVALIDO",
  persona_email_uk: "EMAIL_YA_REGISTRADO",
  persona_id_email_uk: "NO_TRADUCIDA",
  // 0010: el vínculo con el usuario autenticado. Un usuario es de UNA persona; y una vez fijado, no cambia
  // (el repositorio solo escribe con `usuario_auth_id IS NULL`: el disparador es la red de seguridad).
  persona_usuario_auth_id_uk: "USUARIO_DE_OTRA_PERSONA",
  persona_usuario_auth_inmutable: "PERSONA_DE_OTRO_USUARIO",

  // membresia
  membresia_pkey: "YA_ES_MIEMBRO",
  membresia_rol_ck: "ROL_INVALIDO",
  membresia_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  membresia_persona_id_fkey: "PERSONA_INEXISTENTE",
  membresia_invitacion_id_fkey: "INVITACION_NO_ENCONTRADA",
  membresia_gerente_uk: "YA_HAY_GERENTE",

  // asignacion_sucursal
  asignacion_sucursal_pkey: "SUCURSAL_YA_ASIGNADA",
  asignacion_sucursal_membresia_fkey: "MEMBRESIA_NO_ENCONTRADA",
  asignacion_sucursal_sucursal_fkey: "SUCURSAL_NO_ES_DE_LA_EMPRESA",
  asignacion_sucursal_empresa_id_fkey: "EMPRESA_INEXISTENTE",

  // invitacion
  invitacion_pkey: "NO_TRADUCIDA",
  invitacion_tenant_id_fkey: "TENANT_INEXISTENTE",
  invitacion_emitida_por_fkey: "PERSONA_INEXISTENTE",
  invitacion_aceptada_por_fkey: "INVITACION_DE_OTRO_EMAIL",
  invitacion_reemplazada_por_fkey: "INVITACION_NO_ENCONTRADA",
  invitacion_token_hash_uk: "NO_TRADUCIDA",
  invitacion_reemplazada_por_uk: "INVITACION_YA_REEMPLAZADA",
  invitacion_copias_uk: "NO_TRADUCIDA",
  invitacion_id_estado_uk: "NO_TRADUCIDA",
  invitacion_tipo_ck: "TIPO_DE_INVITACION_INVALIDO",
  invitacion_estado_ck: "NO_TRADUCIDA",
  invitacion_email_ck: "EMAIL_INVALIDO",
  invitacion_token_hash_ck: "NO_TRADUCIDA",
  invitacion_vence_ck: "VENCIMIENTO_INVALIDO",
  invitacion_aceptacion_ck: "NO_TRADUCIDA",
  invitacion_aceptada_a_tiempo_ck: "INVITACION_VENCIDA",
  invitacion_revocacion_ck: "MOTIVO_OBLIGATORIO",
  invitacion_reemplazo_ck: "NO_TRADUCIDA",
  invitacion_transicion_invalida: "INVITACION_NO_PENDIENTE",
  invitacion_inmutable: "NO_TRADUCIDA",
  invitacion_resuelta_inmutable: "INVITACION_NO_PENDIENTE",

  // invitacion_empresa
  invitacion_empresa_pkey: "EMPRESA_REPETIDA",
  invitacion_empresa_copias_fkey: "NO_TRADUCIDA",
  invitacion_empresa_estado_fkey: "NO_TRADUCIDA",
  invitacion_empresa_empresa_tenant_fkey: "EMPRESA_DE_OTRO_TENANT",
  invitacion_empresa_rol_ck: "ROL_INVALIDO",
  invitacion_gerente_solo_en_alta: "ROL_NO_INVITABLE",
  invitacion_alta_solo_gerente: "ROL_NO_INVITABLE",
  invitacion_empresa_pendiente_uk: "INVITACION_PENDIENTE_YA_EXISTE",
  invitacion_empresa_gerente_uk: "ALTA_YA_TIENE_INVITACION",

  // invitacion_sucursal
  invitacion_sucursal_pkey: "NO_TRADUCIDA",
  invitacion_sucursal_invitacion_empresa_fkey: "EMPRESA_NO_INVITADA",
  invitacion_sucursal_sucursal_fkey: "SUCURSAL_NO_ES_DE_LA_EMPRESA",
  invitacion_sucursal_empresa_id_fkey: "EMPRESA_INEXISTENTE",

  // membresia (0005, H6): las dos las lanza un disparador (`membresia_cambio`)
  membresia_gerente_no_se_apaga: "ES_EL_GERENTE",
  membresia_rol_sin_traspaso: "NO_TRADUCIDA", // el dominio decide antes; si salta, es un defecto

  // traspaso_gerencia (0005, H6). Los ocho últimos los lanzan disparadores.
  traspaso_gerencia_pkey: "NO_TRADUCIDA",
  traspaso_gerencia_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  traspaso_gerencia_entrante_fkey: "ENTRANTE_NO_ES_MIEMBRO",
  traspaso_gerencia_saliente_fkey: "SALIENTE_YA_NO_ES_GERENTE",
  traspaso_gerencia_propuesto_por_fkey: "PERSONA_INEXISTENTE",
  traspaso_gerencia_origen_ck: "NO_TRADUCIDA",
  traspaso_gerencia_estado_ck: "NO_TRADUCIDA",
  traspaso_gerencia_distintos_ck: "ENTRANTE_ES_EL_GERENTE",
  traspaso_gerencia_vence_ck: "VENCIMIENTO_INVALIDO",
  traspaso_gerencia_resolucion_ck: "NO_TRADUCIDA",
  traspaso_gerencia_aceptado_ck: "TRASPASO_VENCIDO",
  traspaso_gerencia_motivo_ck: "NO_TRADUCIDA",
  traspaso_gerencia_en_curso_uk: "TRASPASO_EN_CURSO",
  traspaso_entrante_inactivo: "ENTRANTE_INACTIVO",
  traspaso_entrante_es_el_gerente: "ENTRANTE_ES_EL_GERENTE",
  traspaso_saliente_no_es_gerente: "SALIENTE_YA_NO_ES_GERENTE",
  traspaso_cancela_sin_permiso: "NO_TRADUCIDA", // el guard decide antes; si salta, es un defecto
  traspaso_aceptado_incompleto: "NO_TRADUCIDA", // lo lanza la restricción diferida, al confirmar
  traspaso_gerencia_inmutable: "NO_TRADUCIDA",
  traspaso_gerencia_transicion_invalida: "TRASPASO_RESUELTO",
  traspaso_gerencia_resuelto_inmutable: "TRASPASO_RESUELTO",
};
