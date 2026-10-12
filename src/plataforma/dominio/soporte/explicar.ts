import { estadoDeModulos } from "../../../capacidades/modulos/activos";
import {
  evaluarGuard,
  type MotivoDeRechazo,
  type ReglasDelGuard,
} from "../../../capacidades/permisos/guard";
import {
  comprobarQueOpera,
  estadoEfectivo,
  type EmpresaNoOpera,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
  type EstadoEfectivo,
} from "../../../contexto/estados";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import {
  decidirAceptacion,
  estadoDeInvitacion,
  type DatosDeAceptacion,
  type DecisionDeAceptacion,
  type ErrorDeAceptacion,
  type EstadoDeInvitacion,
  type Invitacion,
} from "../../../modulos/identidad/publico";

/**
 * "Explicar por qué" (soporte, paso 2, H5 §B.5.9): dado lo que hay en la base, dice qué respondería el
 * sistema a una acción o a una aceptación y por qué. Es SOLO LECTURA y pura: no autoriza nada, y repite
 * la decisión real llamando a LAS MISMAS funciones y en el MISMO orden que los casos de uso
 * (`evaluarGuard` y `comprobarQueOpera`; `decidirAceptacion`), así que no puede contradecirlos. Una
 * propiedad de `test/plataforma` lo comprueba contra `exigirAccion` y `decidirAceptacion` reales.
 *
 * La matriz de la empresa NO se importa desde plataforma (regla `plataforma-sin-permisos-de-empresa`):
 * la composición la inyecta como dato (`reglas`).
 */

/** Por qué el actor no tiene rol vigente en la empresa (o `CON_ROL` si lo tiene). */
export type RazonDelRol =
  "CON_ROL" | "PERSONA_INEXISTENTE" | "PERSONA_SUSPENDIDA" | "SIN_MEMBRESIA" | "MEMBRESIA_APAGADA";

/** Lo que el caso de uso de soporte lee de la base, sin datos operativos, para explicar una acción. */
export type HechosDeAccion<R extends string> = Readonly<{
  empresaId: EmpresaId;
  /** La persona con ese email; `null` si no existe. */
  persona: Readonly<{ activoGlobal: boolean }> | null;
  /** Su membresía en ESA empresa (activa o apagada); `null` si nunca fue miembro. */
  membresia: Readonly<{ rol: R; activo: boolean }> | null;
  /** Módulos activables que la empresa activó (los obligatorios no se guardan). */
  modulosActivados: readonly string[];
  /** Módulos que el plan de su tenant incluye (el techo); los activados fuera de él quedan en solo lectura. */
  modulosHabilitados: readonly string[];
  estadoDeEmpresa: EstadoDeEmpresa;
  estadoDeTenant: EstadoDeTenant;
}>;

export type ExplicacionDeAccion<R extends string> = Readonly<{
  accion: string;
  /** El rol con el que decide el guard; `null` si no tiene rol vigente. */
  rol: R | null;
  razonDelRol: RazonDelRol;
  /** Cómo está la empresa según su estado y el de su tenant, aunque el guard ya haya rechazado. */
  estadoEfectivo: EstadoEfectivo;
  /** Lo que decide el guard (lo que enfrenta también una consulta). */
  guard: Resultado<null, MotivoDeRechazo>;
  /** Lo que decide `comprobarQueOpera` (lo exige además un caso de uso que escribe). */
  opera: Resultado<null, EmpresaNoOpera>;
  /**
   * La decisión de un caso de uso que escribe: el guard primero y, si pasa, que la empresa opere.
   * Es exactamente lo que da `exigirAccion` seguido de `comprobarQueOpera`.
   */
  decision: Resultado<null, MotivoDeRechazo | EmpresaNoOpera>;
}>;

function rolYRazon<R extends string>(
  hechos: HechosDeAccion<R>,
): Readonly<{ rol: R | null; razonDelRol: RazonDelRol }> {
  if (hechos.persona === null) return { rol: null, razonDelRol: "PERSONA_INEXISTENTE" };
  if (!hechos.persona.activoGlobal) return { rol: null, razonDelRol: "PERSONA_SUSPENDIDA" };
  const { membresia } = hechos;
  if (membresia === null) return { rol: null, razonDelRol: "SIN_MEMBRESIA" };
  if (!membresia.activo) return { rol: null, razonDelRol: "MEMBRESIA_APAGADA" };
  return { rol: membresia.rol, razonDelRol: "CON_ROL" };
}

/**
 * Explica qué pasaría si esa persona intentara la `accion` en la empresa. El rol es el de su membresía
 * ACTIVA con la persona activa globalmente (como `autorizacion.delActor`); con cualquier otra cosa no
 * hay rol y el guard responde `SIN_PERMISO`. Una acción que el catálogo no declara lanza `RangeError`
 * (por tipos no puede pasar).
 */
export function explicarAccionDeEmpresa<
  M extends string,
  A extends string,
  C extends string,
  R extends string,
>(
  reglas: ReglasDelGuard<M, A, C, R>,
  accion: A,
  hechos: HechosDeAccion<NoInfer<R>>,
): ExplicacionDeAccion<R> {
  const { rol, razonDelRol } = rolYRazon(hechos);
  const guard = evaluarGuard(reglas, accion, {
    rol,
    ...estadoDeModulos(reglas.catalogo, hechos.modulosActivados, hechos.modulosHabilitados),
    capacidadesDeSucursal: null,
  });
  const opera = comprobarQueOpera(
    hechos.empresaId,
    new Map([
      [hechos.empresaId, { empresa: hechos.estadoDeEmpresa, tenant: hechos.estadoDeTenant }],
    ]),
  );
  return {
    accion,
    rol,
    razonDelRol,
    estadoEfectivo: estadoEfectivo(hechos.estadoDeTenant, hechos.estadoDeEmpresa),
    guard,
    opera,
    decision: guard.ok ? opera : guard,
  };
}

/** Lo que la aceptación necesita, menos el email autenticado (que acá se SUPONE). */
export type HechosDeAceptacion = Omit<DatosDeAceptacion, "emailAutenticado">;

/** Cosas que la explicación da por ciertas porque no hay una sesión que mirar. */
export type SupuestoDeExplicacion = "EMAIL_AUTENTICADO_ES_EL_DE_LA_INVITACION";

export type ExplicacionDeAceptacion = Readonly<{
  estadoDeLaInvitacion: EstadoDeInvitacion;
  /** Lo que respondería `decidirAceptacion`, con el supuesto de abajo. */
  decision: Resultado<DecisionDeAceptacion, ErrorDeAceptacion>;
  supuestos: readonly SupuestoDeExplicacion[];
}>;

/**
 * Explica qué pasaría si quien tiene la invitación intentara aceptarla ahora. Supone que quien acepta
 * es el dueño del email de la invitación (`emailAutenticado` = el de la invitación): no hay sesión que
 * mirar, y así el error `INVITACION_DE_OTRO_EMAIL` no tapa a los demás. El supuesto va en la salida.
 * `decidirAceptacion` lanza `RangeError` si falta el estado de alguna empresa de la invitación.
 */
export function explicarAceptacion(
  invitacion: Invitacion,
  hechos: HechosDeAceptacion,
): ExplicacionDeAceptacion {
  return {
    estadoDeLaInvitacion: estadoDeInvitacion(invitacion, hechos.ahora),
    decision: decidirAceptacion(invitacion, { ...hechos, emailAutenticado: invitacion.email }),
    supuestos: ["EMAIL_AUTENTICADO_ES_EL_DE_LA_INVITACION"],
  };
}
