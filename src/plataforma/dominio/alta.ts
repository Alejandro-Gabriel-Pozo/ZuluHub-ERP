import type { EstadoDeTenant } from "../../contexto/estados";
import { ErrorDeValor } from "../../primitivas/cantidad/errores";
import { moneda, type Moneda } from "../../primitivas/dinero/moneda";
import {
  cuitDesdeTexto,
  type Cuit,
  type ErrorDeCuit,
} from "../../primitivas/identificacion-fiscal/cuit";
import {
  esTextoDeIdentificador,
  tenantId,
  type TenantId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import {
  cambiarEstado,
  razonSocialValida,
  type CambioDeEstadoDeEmpresa,
  type Empresa,
} from "../../modulos/empresas/publico";
import { emailDesdeTexto, type Email } from "../../modulos/identidad/publico";
import { nombreDeTenantValido } from "../../modulos/tenants/publico";

/**
 * El alta de una empresa desde plataforma (caso 0, H5 §B.5.1 y §B.5.3). Dominio puro: sin reloj ni
 * aleatoriedad (la hora entra como dato), sin guard y sin puertos.
 */

/** Plazo para que el gerente acepte el alta: pasadas 72 h desde que se creó la empresa, vence (decisión 5). */
export const PLAZO_DE_ALTA_EN_MS = 72 * 3_600_000;

/** El motivo con el que el barrido cancela un alta vencida. */
export const MOTIVO_DE_ALTA_VENCIDA = "ALTA_VENCIDA";

/**
 * ¿Venció el alta? El plazo cuenta desde que se creó la empresa (no desde el último reenvío de la
 * invitación) y vence EN el instante exacto de las 72 h, igual que una invitación (`ahora >= venceEn`).
 * La consulta que elige candidatos al barrido tiene que usar el mismo criterio.
 */
export function altaVencida(creadaEn: Date, ahora: Date): boolean {
  return ahora.getTime() - creadaEn.getTime() >= PLAZO_DE_ALTA_EN_MS;
}

/** Milisegundos que le quedan al alta; 0 si ya venció (nunca negativo). */
export function msRestantesDeAlta(creadaEn: Date, ahora: Date): number {
  return Math.max(0, PLAZO_DE_ALTA_EN_MS - (ahora.getTime() - creadaEn.getTime()));
}

/** La entrada del formulario de alta tal como llega: todo texto. Va `tenantId` o `nombreDeTenant`. */
export type EntradaDeAlta = Readonly<{
  tenantId?: string | undefined;
  nombreDeTenant?: string | undefined;
  cuit: string;
  razonSocial: string;
  zonaHoraria: string;
  moneda: string;
  emailGerente: string;
}>;

export type DestinoDeTenant =
  Readonly<{ tipo: "EXISTENTE"; tenantId: TenantId }> | Readonly<{ tipo: "NUEVO"; nombre: string }>;

/** La entrada ya validada, con sus tipos de dominio. */
export type AltaValidada = Readonly<{
  tenant: DestinoDeTenant;
  cuit: Cuit;
  razonSocial: string;
  /** Sin validar acá: la valida la base (`empresa_zona_horaria_ck → ZONA_HORARIA_INVALIDA`). */
  zonaHoraria: string;
  moneda: Moneda;
  emailGerente: Email;
}>;

export type ErrorDeValidacionDeAlta =
  | ErrorDeCuit
  | "TENANT_INDEFINIDO"
  | "TENANT_AMBIGUO"
  | "TENANT_ID_INVALIDO"
  | "NOMBRE_INVALIDO"
  | "RAZON_SOCIAL_INVALIDA"
  | "MONEDA_NO_SOPORTADA"
  | "EMAIL_INVALIDO";

function destinoDeTenant(
  entrada: EntradaDeAlta,
): Resultado<DestinoDeTenant, ErrorDeValidacionDeAlta> {
  const { tenantId: id, nombreDeTenant: nombre } = entrada;
  if (id !== undefined && nombre !== undefined) return err("TENANT_AMBIGUO");
  if (id !== undefined) {
    return esTextoDeIdentificador(id)
      ? ok({ tipo: "EXISTENTE", tenantId: tenantId(id) })
      : err("TENANT_ID_INVALIDO");
  }
  if (nombre === undefined) return err("TENANT_INDEFINIDO");
  const valido = nombreDeTenantValido(nombre);
  return valido.ok ? ok({ tipo: "NUEVO", nombre: valido.valor }) : err("NOMBRE_INVALIDO");
}

function monedaDeTexto(texto: string): Resultado<Moneda, "MONEDA_NO_SOPORTADA"> {
  try {
    return ok(moneda(texto));
  } catch (error) {
    // `moneda` lanza `ErrorDeValor` (siempre `MONEDA_NO_SOPORTADA`) ante una moneda que no conoce; cualquier
    // otra falla es un defecto del llamador y se propaga.
    if (error instanceof ErrorDeValor) return err("MONEDA_NO_SOPORTADA");
    throw error;
  }
}

/**
 * Valida la forma de la entrada del alta, FUERA de la transacción. Orden de los errores, el del
 * formulario: tenant (indefinido, ambiguo, id inválido, nombre inválido), CUIT (formato, dígito
 * verificador), razón social, moneda y email del gerente. La zona horaria no se valida acá (A.4 #6).
 * Nada se corrige en silencio salvo el recorte de espacios del nombre, la razón social y el email.
 */
export function validarAlta(
  entrada: EntradaDeAlta,
): Resultado<AltaValidada, ErrorDeValidacionDeAlta> {
  const tenant = destinoDeTenant(entrada);
  if (!tenant.ok) return tenant;
  const cuit = cuitDesdeTexto(entrada.cuit);
  if (!cuit.ok) return cuit;
  const razonSocial = razonSocialValida(entrada.razonSocial);
  if (!razonSocial.ok) return err("RAZON_SOCIAL_INVALIDA");
  const monedaValida = monedaDeTexto(entrada.moneda);
  if (!monedaValida.ok) return monedaValida;
  const emailGerente = emailDesdeTexto(entrada.emailGerente);
  if (!emailGerente.ok) return emailGerente;
  return ok({
    tenant: tenant.valor,
    cuit: cuit.valor,
    razonSocial: razonSocial.valor,
    zonaHoraria: entrada.zonaHoraria,
    moneda: monedaValida.valor,
    emailGerente: emailGerente.valor,
  });
}

/** Lo que el caso lee dentro de la transacción para decidir el alta. */
export type HechosDeAlta = Readonly<{
  /** El email del gerente es el de un administrador de plataforma activo (un admin no puede ser gerente). */
  emailEsDeAdminDePlataforma: boolean;
  /** El tenant existente que se pidió, o `null` si no existe. Con un tenant nuevo no se usa. */
  tenant: Readonly<{ estado: EstadoDeTenant }> | null;
}>;

export type ErrorDeAlta = "EMAIL_DE_ADMIN_PLATAFORMA" | "TENANT_NO_ENCONTRADO" | "TENANT_NO_ACTIVO";

/**
 * ¿Se puede dar de alta la empresa con estos hechos? Orden: el email de un administrador de plataforma
 * (`EMAIL_DE_ADMIN_PLATAFORMA`) y, con un tenant existente, que exista (`TENANT_NO_ENCONTRADO`) y que
 * esté activo (`TENANT_NO_ACTIVO`: a un tenant suspendido no se le dan altas).
 */
export function comprobarAlta(
  alta: AltaValidada,
  hechos: HechosDeAlta,
): Resultado<null, ErrorDeAlta> {
  if (hechos.emailEsDeAdminDePlataforma) return err("EMAIL_DE_ADMIN_PLATAFORMA");
  if (alta.tenant.tipo === "EXISTENTE") {
    if (hechos.tenant === null) return err("TENANT_NO_ENCONTRADO");
    if (hechos.tenant.estado !== "ACTIVE") return err("TENANT_NO_ACTIVO");
  }
  return ok(null);
}

export type ErrorDeCancelacionDeAlta = "ALTA_NO_PENDIENTE" | "MOTIVO_OBLIGATORIO";

/**
 * Cancela el alta (manual, o por el barrido con `MOTIVO_DE_ALTA_VENCIDA`): `PROVISIONING → CANCELLED`
 * con motivo obligatorio. Una empresa que ya no está en alta (activa, cancelada...) es
 * `ALTA_NO_PENDIENTE`, que gana sobre el motivo vacío.
 */
export function decidirCancelacionDeAlta(
  empresa: Empresa,
  motivo: string,
): Resultado<CambioDeEstadoDeEmpresa, ErrorDeCancelacionDeAlta> {
  const cambio = cambiarEstado(empresa, "CANCELLED", motivo);
  if (cambio.ok) return cambio;
  // `cambiarEstado` solo falla por la transición o por el motivo.
  return err(
    cambio.error === "TRANSICION_NO_PERMITIDA" ? "ALTA_NO_PENDIENTE" : "MOTIVO_OBLIGATORIO",
  );
}
