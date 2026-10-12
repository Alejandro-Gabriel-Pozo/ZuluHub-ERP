import { esClaveDe } from "../../capacidades/modulos/activos";
import type { MotivoDeRechazo, ReglasDelGuard } from "../../capacidades/permisos/guard";
import type { ReglasDePlataforma } from "../../capacidades/permisos/plataforma";
import type { RolDeEmpresa } from "../../capacidades/permisos/roles";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { emailDesdeTexto, type Email } from "../../modulos/identidad/publico";
import {
  empresaId,
  invitacionId,
  personaId,
  type EmpresaId,
  type InvitacionId,
  type PersonaId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { AuditoriaDePlataforma } from "../../puertos/auditoria-de-plataforma";
import type { CargaDeAutorizacionDePlataforma } from "../../puertos/autorizacion-de-plataforma";
import type { IdempotenciaDePlataforma } from "../../puertos/idempotencia";
import type { ErrorDePersistencia, Transacciones } from "../../puertos/transacciones";
import { exigirAccionDePlataforma } from "../consultas/comun";
import type { LecturaParaExplicar } from "../consultas/contrato";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { claveDeIdempotenciaValida, uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  explicarAccionDeEmpresa,
  explicarAceptacion,
  type ExplicacionDeAceptacion,
  type ExplicacionDeAccion,
  type HechosDeAccion,
  type HechosDeAceptacion,
} from "../dominio/soporte/explicar";
import {
  resultadoDeUnaAccionExplicada,
  resultadoDeUnaAceptacionExplicada,
} from "../dominio/soporte/registro";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_EXPLICAR = "soporte.explicar";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_EXPLICAR_POR_QUE = {
  accion: "soporte.explicar",
} as const satisfies DeclaracionDeAccionDePlataforma;

/** Quién es la persona a explicar: por su email o por su id (el que trae una referencia de error). */
export type PersonaAExplicar =
  Readonly<{ por: "EMAIL"; email: string }> | Readonly<{ por: "ID"; personaId: string }>;

/**
 * Qué explicar: qué respondería el sistema si esa persona intentara la acción en esa empresa, o si
 * quien tiene esa invitación intentara aceptarla ahora. La `accion` es una del catálogo de la empresa.
 */
export type ObjetivoAExplicar =
  | Readonly<{ tipo: "ACCION"; empresaId: string; persona: PersonaAExplicar; accion: string }>
  | Readonly<{ tipo: "ACEPTACION"; invitacionId: string }>;

export type EntradaDeExplicar = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN dejar otra constancia de acceso. */
  claveDeIdempotencia: string;
  objetivo: ObjetivoAExplicar;
}>;

/**
 * Lo explicado: solo identidad, estados y el resultado de las reglas; nunca datos operativos ni
 * secretos. Es un dato plano (se guarda como resultado de la idempotencia y se repite igual).
 */
export type SalidaDeExplicar =
  | Readonly<{
      tipo: "ACCION";
      empresaId: EmpresaId;
      /** `null`: no hay ninguna persona con ese email (o con ese id). */
      personaId: PersonaId | null;
      explicacion: ExplicacionDeAccion<string>;
    }>
  | Readonly<{
      tipo: "ACEPTACION";
      invitacionId: InvitacionId;
      explicacion: ExplicacionDeAceptacion;
    }>;

export type ErrorAlExplicar =
  | MotivoDeRechazo
  | "CLAVE_DE_IDEMPOTENCIA_INVALIDA"
  | "CLAVE_REUTILIZADA"
  | "ID_INVALIDO"
  | "EMAIL_INVALIDO"
  | "ACCION_DESCONOCIDA"
  | "EMPRESA_NO_ENCONTRADA"
  | "INVITACION_NO_ENCONTRADA"
  | ErrorDePersistencia;

/**
 * Lo que recibe el trabajo de «explicar por qué»: la lectura de hechos, el administrador, la auditoría
 * y la idempotencia de plataforma. Es el único caso de soporte que escribe, y solo escribe la constancia
 * de acceso y la clave de idempotencia.
 */
export type TxDeExplicar = Readonly<{
  soporte: LecturaParaExplicar;
  autorizacionDePlataforma: CargaDeAutorizacionDePlataforma;
  auditoriaDePlataforma: AuditoriaDePlataforma;
  idempotencia: IdempotenciaDePlataforma;
}>;

export type DependenciasDeExplicar = Readonly<{
  transacciones: Transacciones<TxDeExplicar>;
  /** El catálogo y la matriz de PLATAFORMA con los que se autoriza a quien explica. */
  reglas: ReglasDePlataforma;
  /**
   * El catálogo y la matriz de roles de la EMPRESA que se explican. Los inyecta la composición como
   * datos: `src/plataforma` no importa la matriz de empresa (regla `plataforma-sin-permisos-de-empresa`).
   */
  reglasDeEmpresa: ReglasDelGuard<string, string, string, string>;
}>;

/** El objetivo ya validado y normalizado (ids en minúsculas, email normalizado). */
type ObjetivoValido =
  | Readonly<{
      tipo: "ACCION";
      empresaId: EmpresaId;
      persona:
        Readonly<{ por: "EMAIL"; email: Email }> | Readonly<{ por: "ID"; personaId: PersonaId }>;
      accion: string;
    }>
  | Readonly<{ tipo: "ACEPTACION"; invitacionId: InvitacionId }>;

type ErrorDeEntrada = Extract<
  ErrorAlExplicar,
  "ID_INVALIDO" | "EMAIL_INVALIDO" | "ACCION_DESCONOCIDA"
>;

function validarObjetivo(
  objetivo: ObjetivoAExplicar,
  reglasDeEmpresa: DependenciasDeExplicar["reglasDeEmpresa"],
): Resultado<ObjetivoValido, ErrorDeEntrada> {
  if (objetivo.tipo === "ACEPTACION") {
    const id = uuidDesdeTexto(objetivo.invitacionId);
    return id.ok ? ok({ tipo: "ACEPTACION", invitacionId: invitacionId(id.valor) }) : id;
  }
  const empresa = uuidDesdeTexto(objetivo.empresaId);
  if (!empresa.ok) return empresa;
  if (!esClaveDe(reglasDeEmpresa.permisos, objetivo.accion)) return err("ACCION_DESCONOCIDA");
  if (objetivo.persona.por === "EMAIL") {
    const email = emailDesdeTexto(objetivo.persona.email);
    if (!email.ok) return email;
    return ok({
      tipo: "ACCION",
      empresaId: empresaId(empresa.valor),
      persona: { por: "EMAIL", email: email.valor },
      accion: objetivo.accion,
    });
  }
  const persona = uuidDesdeTexto(objetivo.persona.personaId);
  if (!persona.ok) return persona;
  return ok({
    tipo: "ACCION",
    empresaId: empresaId(empresa.valor),
    persona: { por: "ID", personaId: personaId(persona.valor) },
    accion: objetivo.accion,
  });
}

/**
 * Explicar por qué (soporte, paso 2, H5 §B.5.9). Contexto de PLATAFORMA. Transacción SERIALIZABLE, en
 * este orden:
 *
 *  1. El guard (`soporte.explicar`: ADMIN y SOPORTE), leído dentro de la transacción.
 *  2. La forma de la clave de idempotencia y del objetivo (ids, email, acción del catálogo).
 *  3. La clave: si ya se usó con el MISMO pedido se devuelve lo que dio, sin leer ni escribir nada más
 *     (una sola constancia de acceso); con OTRO pedido es `CLAVE_REUTILIZADA`.
 *  4. Lee los hechos (estados de la empresa y del tenant, persona, membresía, invitación): identidad y
 *     estados, nunca datos operativos.
 *  5. Explica con las funciones puras del dominio, que repiten las del guard y de la aceptación reales.
 *  6. ÚNICAS escrituras, en la misma transacción: la constancia `SOPORTE_EXPLICAR` (quién, qué empresa o
 *     invitación, qué persona, qué acción y qué motivo resultó; nunca el contenido ni el email) y la
 *     clave de idempotencia.
 *
 * Un error de negocio revierte todo: no queda constancia de un acceso que no ocurrió. Dos pedidos
 * simultáneos con la misma clave dejan una sola constancia: el segundo choca al registrar la clave, se
 * repite y ve la del primero.
 */
export function armarExplicarPorQue({
  transacciones,
  reglas,
  reglasDeEmpresa,
}: DependenciasDeExplicar) {
  return async function explicarPorQue(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeExplicar,
  ): Promise<Resultado<SalidaDeExplicar, ErrorAlExplicar>> {
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<Resultado<SalidaDeExplicar, Exclude<ErrorAlExplicar, ErrorDePersistencia>>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          DECLARACION_DE_EXPLICAR_POR_QUE.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        if (!claveDeIdempotenciaValida(entrada.claveDeIdempotencia)) {
          return err("CLAVE_DE_IDEMPOTENCIA_INVALIDA");
        }
        const objetivo = validarObjetivo(entrada.objetivo, reglasDeEmpresa);
        if (!objetivo.ok) return objetivo;

        const previa = await tx.idempotencia.consultar(
          OPERACION_EXPLICAR,
          entrada.claveDeIdempotencia,
          objetivo.valor,
        );
        if (previa.tipo === "CLAVE_REUTILIZADA") return err("CLAVE_REUTILIZADA");
        // Lo guardado lo escribió este mismo caso (la operación está en la clave): es una `SalidaDeExplicar`.
        if (previa.tipo === "REPETIDA") return ok(previa.resultado as SalidaDeExplicar);

        const salida =
          objetivo.valor.tipo === "ACCION"
            ? await explicarAccion(tx, reglasDeEmpresa, objetivo.valor)
            : await explicarUnaAceptacion(tx, contexto, objetivo.valor);
        if (!salida.ok) return salida;

        await tx.auditoriaDePlataforma.registrar(constancia(salida.valor));
        await tx.idempotencia.registrar(
          OPERACION_EXPLICAR,
          entrada.claveDeIdempotencia,
          objetivo.valor,
          salida.valor,
        );
        return salida;
      },
    );
  };
}

type Objetivo<T extends ObjetivoValido["tipo"]> = Extract<ObjetivoValido, { tipo: T }>;

async function explicarAccion(
  tx: TxDeExplicar,
  reglasDeEmpresa: DependenciasDeExplicar["reglasDeEmpresa"],
  objetivo: Objetivo<"ACCION">,
): Promise<Resultado<SalidaDeExplicar, "EMPRESA_NO_ENCONTRADA">> {
  const estados = await tx.soporte.estadosDeEmpresas([objetivo.empresaId]);
  const estadosDeLaEmpresa = estados.get(objetivo.empresaId);
  if (estadosDeLaEmpresa === undefined) return err("EMPRESA_NO_ENCONTRADA");
  const persona =
    objetivo.persona.por === "EMAIL"
      ? await tx.soporte.personaPorEmail(objetivo.persona.email)
      : await tx.soporte.personaPorId(objetivo.persona.personaId);
  const membresias =
    persona === null ? [] : await tx.soporte.membresiasDe(persona.id, [objetivo.empresaId]);
  const membresia = membresias.find((m) => m.empresaId === objetivo.empresaId) ?? null;
  const hechos: HechosDeAccion<RolDeEmpresa> = {
    empresaId: objetivo.empresaId,
    persona: persona === null ? null : { activoGlobal: persona.activoGlobal },
    membresia: membresia === null ? null : { rol: membresia.rol, activo: membresia.activo },
    modulosActivados: await tx.soporte.modulosActivadosDe(objetivo.empresaId),
    estadoDeEmpresa: estadosDeLaEmpresa.empresa,
    estadoDeTenant: estadosDeLaEmpresa.tenant,
  };
  return ok({
    tipo: "ACCION",
    empresaId: objetivo.empresaId,
    personaId: persona === null ? null : persona.id,
    explicacion: explicarAccionDeEmpresa(reglasDeEmpresa, objetivo.accion, hechos),
  });
}

async function explicarUnaAceptacion(
  tx: TxDeExplicar,
  contexto: ContextoDePlataforma,
  objetivo: Objetivo<"ACEPTACION">,
): Promise<Resultado<SalidaDeExplicar, "INVITACION_NO_ENCONTRADA">> {
  const invitacion = await tx.soporte.invitacionPorId(objetivo.invitacionId);
  if (invitacion === null) return err("INVITACION_NO_ENCONTRADA");
  const empresas = invitacion.empresas.map((e) => e.empresaId);
  const persona = await tx.soporte.personaPorEmail(invitacion.email);
  const membresias = persona === null ? [] : await tx.soporte.membresiasDe(persona.id, empresas);
  const hechos: HechosDeAceptacion = {
    ahora: contexto.ahora,
    persona,
    estados: await tx.soporte.estadosDeEmpresas(empresas),
    miembroActivoEn: new Set(membresias.filter((m) => m.activo).map((m) => m.empresaId)),
    rolesAnteriores: new Map(
      membresias.filter((m) => !m.activo).map((m) => [m.empresaId, m.rol] as const),
    ),
  };
  return ok({
    tipo: "ACEPTACION",
    invitacionId: invitacion.id,
    explicacion: explicarAceptacion(invitacion, hechos),
  });
}

/** La constancia de acceso: quién (lo pone el adaptador), sobre qué, qué persona y acción, y qué resultó. */
function constancia(salida: SalidaDeExplicar) {
  if (salida.tipo === "ACCION") {
    return {
      accion: "SOPORTE_EXPLICAR",
      entidad: "empresa",
      entidadId: salida.empresaId,
      despues: {
        objetivo: "ACCION",
        accion: salida.explicacion.accion,
        personaId: salida.personaId,
        resultado: resultadoDeUnaAccionExplicada(salida.explicacion.decision),
      },
    } as const;
  }
  return {
    accion: "SOPORTE_EXPLICAR",
    entidad: "invitacion",
    entidadId: salida.invitacionId,
    despues: {
      objetivo: "ACEPTACION",
      resultado: resultadoDeUnaAceptacionExplicada(salida.explicacion.decision),
    },
  } as const;
}
