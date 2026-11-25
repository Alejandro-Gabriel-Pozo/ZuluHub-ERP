/**
 * Restricción de la base → error de negocio (ADR-004) de la ficha de cuenta corriente (0106). Un test compara este mapa con las restricciones reales de la
 * tabla y con las que lanza su disparador (`cuenta_del_cliente_validar`): no puede faltar ni sobrar ninguna. `NO_TRADUCIDA`: restricción de red de seguridad sin
 * error de negocio (la decide antes el dominio o el caso de uso); sale como el `ErrorDePersistencia` tipado que ya es, nunca disfrazada.
 */
export const ERRORES_DE_CUENTA_CORRIENTE_POR_RESTRICCION: Readonly<Record<string, string>> = {
  cuenta_del_cliente_pkey: "NO_TRADUCIDA",
  cuenta_del_cliente_empresa_id_fkey: "NO_TRADUCIDA",
  cuenta_del_cliente_habilitada_por_fkey: "NO_TRADUCIDA",
  cuenta_cliente_id_empresa_uk: "NO_TRADUCIDA",
  // Una sola ficha por cliente y empresa; y la clave de la habilitación (repetirla no duplica: el caso de uso lee antes y reintenta una vez).
  cuenta_cliente_parte_uk: "YA_HABILITADA",
  cuenta_cliente_clave_uk: "NO_TRADUCIDA",
  // La parte no existe en esta empresa (o está anonimizada): la clave foránea compuesta y el disparador que corre antes que ella.
  cuenta_cliente_parte_fkey: "PARTE_NO_ENCONTRADA",
  cuenta_cliente_plazo_ck: "PLAZO_INVALIDO",
  cuenta_cliente_limite_ck: "LIMITE_INVALIDO",
  cuenta_cliente_moneda_ck: "NO_TRADUCIDA",
  cuenta_cliente_estado_ck: "NO_TRADUCIDA",
  cuenta_cliente_motivo_ck: "MOTIVO_INVALIDO",
  cuenta_cliente_clave_ck: "NO_TRADUCIDA",
  cuenta_cliente_huella_ck: "NO_TRADUCIDA",
  cuenta_cliente_suspension_ck: "NO_TRADUCIDA",
  // Los lanza el disparador `cuenta_del_cliente_validar`: quién puede deber, y lo que no cambia de una ficha.
  cuenta_cliente_parte_no_activa: "PARTE_NO_ACTIVA",
  cuenta_cliente_sin_rol_cliente: "PARTE_NO_ES_CLIENTE",
  cuenta_cliente_sin_cuit: "PARTE_SIN_CUIT_O_RAZON_SOCIAL",
  cuenta_cliente_identidad_inmutable: "NO_TRADUCIDA",
};
