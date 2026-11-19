import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirArrepentimiento,
  decidirAsignacion,
  traducirErroresDePlanes,
  type AsignacionDePlan,
  type ErrorDeArrepentimiento,
  type ErrorDeAsignacion,
} from "../../modulos/planes/publico";
import { estadoDeDecision, vigenteEn } from "../../capacidades/planes/vigencia";
import { tenantId as comoTenantId, type TenantId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { esDiasDeLaPoliticaDePlan } from "../../primitivas/tiempo/dias-de-la-politica-de-plan";
import { hoyEnArgentina } from "../../primitivas/tiempo/fecha-civil-hasta-hoy";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { validarLargoDelMotivo, validarNumeroEsperado } from "../dominio/formas-de-entrada";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  auditarEnLasEmpresas,
  aplanarError,
  ejecutarCasoDeMarcasYPlanes,
  instanteISO,
  type DependenciasDeMarcasYPlanes,
  type ErrorComunDeMarcasYPlanes,
  type ErrorPlano,
} from "./marcas-y-planes-comun";

/**
 * Política de cambio de plan (H-14a): definirla y arrepentir un cambio. Contexto de PLATAFORMA, solo ADMIN con segundo factor reciente.
 * Sobre la plantilla común: guard, clave de idempotencia, trabajo y auditoría en UNA transacción serializable.
 */

export const OPERACION_DEFINIR_POLITICA_DE_CAMBIO = "politica_de_plan.definir";
export const OPERACION_ARREPENTIR_CAMBIO_DE_PLAN = "planes.arrepentir";

export const DECLARACION_DE_DEFINIR_POLITICA_DE_CAMBIO_DE_PLAN = {
  accion: "politica_de_plan.definir",
} as const satisfies DeclaracionDeAccionDePlataforma;
export const DECLARACION_DE_ARREPENTIR_CAMBIO_DE_PLAN = {
  accion: "planes.arrepentir",
} as const satisfies DeclaracionDeAccionDePlataforma;

// --- definirPoliticaDeCambioDePlan ----------------------------------------------------------------------

export type EntradaDeDefinirPoliticaDeCambioDePlan = Readonly<{
  /** Repetirlo con la misma clave devuelve lo mismo SIN insertar otra versión ni auditar de nuevo. */
  claveDeIdempotencia: string;
  /** La versión vigente que vio quien define. Si otro definió entretanto: `VERSION_DESACTUALIZADA`. */
  versionEsperada: number;
  diasDeAnticipacionDeSuba: number;
  diasDeAnticipacionDeBaja: number;
  diasDeArrepentimiento: number;
  motivo: string;
}>;

export type SalidaDeDefinirPoliticaDeCambioDePlan = Readonly<{
  version: number;
  repetida: boolean;
}>;

type ErrorDeDefinir =
  | "VERSION_ESPERADA_INVALIDA"
  | "DIAS_DE_POLITICA_INVALIDOS"
  | "MOTIVO_OBLIGATORIO"
  | "MOTIVO_DEMASIADO_LARGO"
  | "VERSION_DESACTUALIZADA";

export type ErrorAlDefinirPoliticaDeCambioDePlan = ErrorPlano<
  ErrorComunDeMarcasYPlanes | ErrorDeDefinir
>;

/**
 * Define la versión siguiente de la política (una para toda la plataforma, solo inserción). Con `versionEsperada` distinta de la vigente:
 * `VERSION_DESACTUALIZADA`. Dos administradores a la vez con la misma versión: la base deja entrar una (clave primaria), el reintento de la plantilla le muestra la nueva a la otra
 * y recibe `VERSION_DESACTUALIZADA`. No toca los cambios ya registrados: cada uno conserva la política con la que nació.
 */
export function armarDefinirPoliticaDeCambioDePlan(dependencias: DependenciasDeMarcasYPlanes) {
  return async function definirPoliticaDeCambioDePlan(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeDefinirPoliticaDeCambioDePlan,
  ): Promise<
    Resultado<SalidaDeDefinirPoliticaDeCambioDePlan, ErrorAlDefinirPoliticaDeCambioDePlan>
  > {
    const resultado = await ejecutarCasoDeMarcasYPlanes<
      SalidaDeDefinirPoliticaDeCambioDePlan,
      Readonly<{
        version: number;
        suba: number;
        baja: number;
        arrepentimiento: number;
        motivo: string;
      }>,
      ErrorDeDefinir
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_DEFINIR_POLITICA_DE_CAMBIO_DE_PLAN.accion,
      operacion: OPERACION_DEFINIR_POLITICA_DE_CAMBIO,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const version = entrada.versionEsperada;
        if (!Number.isInteger(version) || version < 1) return err("VERSION_ESPERADA_INVALIDA");
        const dias = [
          entrada.diasDeAnticipacionDeSuba,
          entrada.diasDeAnticipacionDeBaja,
          entrada.diasDeArrepentimiento,
        ];
        if (!dias.every(esDiasDeLaPoliticaDePlan)) return err("DIAS_DE_POLITICA_INVALIDOS");
        const largo = validarLargoDelMotivo(entrada.motivo);
        if (!largo.ok) return largo;
        const motivo = entrada.motivo.trim();
        if (motivo === "") return err("MOTIVO_OBLIGATORIO");
        const valor = {
          version,
          suba: entrada.diasDeAnticipacionDeSuba,
          baja: entrada.diasDeAnticipacionDeBaja,
          arrepentimiento: entrada.diasDeArrepentimiento,
          motivo,
        };
        return ok({ entrada: valor, valor });
      },
      trabajar: async (tx, pedido) => {
        const vigente = (await tx.planes.politicasDeCambio()).at(-1);
        // La migración carga la versión 1: sin política la base está rota, no es un caso de negocio.
        if (vigente === undefined)
          throw new RangeError("no hay política de cambio de plan cargada");
        if (vigente.version !== pedido.version) return err("VERSION_DESACTUALIZADA");
        const nueva = await tx.planes.insertarPoliticaDeCambio({
          version: vigente.version + 1,
          diasDeAnticipacionDeSuba: pedido.suba,
          diasDeAnticipacionDeBaja: pedido.baja,
          diasDeArrepentimiento: pedido.arrepentimiento,
          motivo: pedido.motivo,
        });
        const forma = (
          p: Readonly<{
            version: number;
            diasDeAnticipacionDeSuba: number;
            diasDeAnticipacionDeBaja: number;
            diasDeArrepentimiento: number;
          }>,
        ) => ({
          version: p.version,
          diasDeAnticipacionDeSuba: p.diasDeAnticipacionDeSuba,
          diasDeAnticipacionDeBaja: p.diasDeAnticipacionDeBaja,
          diasDeArrepentimiento: p.diasDeArrepentimiento,
        });
        return ok({
          salida: { version: nueva.version, repetida: false },
          constancias: [
            {
              accion: "POLITICA_DE_PLAN_DEFINIDA",
              entidad: "politica_de_cambio_de_plan",
              entidadId: String(nueva.version),
              antes: forma(vigente),
              despues: { ...forma(nueva), motivo: nueva.motivo },
            },
          ],
        });
      },
      comoRepeticion: (guardado) => ({ ...guardado, repetida: true }),
    });
    return aplanarError(resultado);
  };
}

// --- arrepentirCambioDePlan -----------------------------------------------------------------------------

export type EntradaDeArrepentirCambioDePlan = Readonly<{
  /** Repetirlo con la misma clave devuelve lo mismo SIN asignar otra vez ni auditar de nuevo. */
  claveDeIdempotencia: string;
  tenantId: string;
  /** El número del cambio que se deshace: tiene que ser el último del cliente. */
  numero: number;
  /** El número de la última asignación que vio quien decide. Si cambió: `VERSION_DESACTUALIZADA`. */
  numeroEsperado: number;
  motivo: string;
}>;

export type SalidaDeArrepentirCambioDePlan = Readonly<{
  /** El número de la asignación nueva que vuelve al plan anterior. */
  numero: number;
  repetida: boolean;
}>;

type ErrorDeArrepentir =
  | ErrorDeAsignacion
  | ErrorDeArrepentimiento
  | "ID_INVALIDO"
  | "NUMERO_INVALIDO"
  | "NUMERO_ESPERADO_INVALIDO"
  | "MOTIVO_DEMASIADO_LARGO"
  | "TENANT_NO_ENCONTRADO"
  | "CAMBIO_NO_ENCONTRADO"
  | "SIN_PLAN_ANTERIOR"
  | "VERSION_DE_PLAN_NO_ENCONTRADA";

const MOTIVOS_DE_BASE_DE_ARREPENTIR = [
  "TENANT_NO_ENCONTRADO",
  "VERSION_DESACTUALIZADA",
  "VERSION_DE_PLAN_NO_PUBLICADA",
  "VIGENCIA_RETROACTIVA",
  "MOTIVO_OBLIGATORIO",
] as const;

export type ErrorAlArrepentirCambioDePlan = ErrorPlano<
  ErrorComunDeMarcasYPlanes | ErrorDeArrepentir | (typeof MOTIVOS_DE_BASE_DE_ARREPENTIR)[number]
>;

type PedidoDeArrepentir = Readonly<{
  tenantId: TenantId;
  numero: number;
  numeroEsperado: number;
  motivo: string;
}>;

/**
 * Arrepentirse de un cambio de plan (lo hace la plataforma a pedido del cliente). Solo sobre el ÚLTIMO cambio, de origen CAMBIO, hasta su fecha límite
 * (inclusive) y UNA sola vez. Registra una asignación nueva que vuelve a la versión que regía antes, con vigencia inmediata (y deja sin efecto lo
 * programado); no borra ni edita nada. La asignación nueva no tiene condiciones: el arrepentimiento no se arrepiente ni tiene anticipación. Dos
 * pedidos a la vez: uno gana (único por cambio arrepentido en la base); el otro, tras el reintento de la plantilla, recibe `YA_ARREPENTIDO` o `VERSION_DESACTUALIZADA`.
 */
export function armarArrepentirCambioDePlan(dependencias: DependenciasDeMarcasYPlanes) {
  return async function arrepentirCambioDePlan(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeArrepentirCambioDePlan,
  ): Promise<Resultado<SalidaDeArrepentirCambioDePlan, ErrorAlArrepentirCambioDePlan>> {
    const resultado = await ejecutarCasoDeMarcasYPlanes<
      SalidaDeArrepentirCambioDePlan,
      PedidoDeArrepentir,
      ErrorDeArrepentir
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_ARREPENTIR_CAMBIO_DE_PLAN.accion,
      operacion: OPERACION_ARREPENTIR_CAMBIO_DE_PLAN,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const tenant = uuidDesdeTexto(entrada.tenantId);
        if (!tenant.ok) return tenant;
        const numero = validarNumeroEsperado(entrada.numero);
        if (!numero.ok || numero.valor === null) return err("NUMERO_INVALIDO");
        const esperado = validarNumeroEsperado(entrada.numeroEsperado);
        if (!esperado.ok || esperado.valor === null) return err("NUMERO_ESPERADO_INVALIDO");
        const largo = validarLargoDelMotivo(entrada.motivo);
        if (!largo.ok) return largo;
        const motivo = entrada.motivo.trim();
        return ok({
          entrada: {
            tenantId: tenant.valor,
            numero: numero.valor,
            numeroEsperado: esperado.valor,
            motivo,
          },
          valor: {
            tenantId: comoTenantId(tenant.valor),
            numero: numero.valor,
            numeroEsperado: esperado.valor,
            motivo,
          },
        });
      },
      trabajar: async (tx, pedido) => {
        if (!(await tx.planes.existeElTenant(pedido.tenantId))) return err("TENANT_NO_ENCONTRADO");
        const guardadas = await tx.planes.asignacionesDelTenant(pedido.tenantId);
        const cambio = guardadas.find((a) => a.numero === pedido.numero);
        if (cambio === undefined) return err("CAMBIO_NO_ENCONTRADO");
        const hoy = hoyEnArgentina(contexto.ahora);
        // El instante del contexto es válido (lo firma la puerta): si no lo es, no se decide nada.
        if (!hoy.ok) throw new RangeError("el instante del contexto no tiene día de Argentina");
        const ultimo = guardadas.reduce((m, a) => Math.max(m, a.numero), 0);
        const decision = decidirArrepentimiento({
          hoy: hoy.valor,
          esElUltimo: cambio.numero === ultimo,
          origen: cambio.origen,
          condiciones: await tx.planes.condicionesDeCambio(pedido.tenantId, cambio.numero),
          yaArrepentido:
            (await tx.planes.arrepentimientoDe(pedido.tenantId, cambio.numero)) !== null,
        });
        if (!decision.ok) return decision;

        // Vuelve a lo que regía antes del cambio: lo que rige hoy sin contar el cambio que se deshace.
        const sinElCambio = guardadas.filter((a) => a.numero !== cambio.numero);
        const anterior = vigenteEn(sinElCambio, contexto.ahora);
        if (anterior === null) return err("SIN_PLAN_ANTERIOR");
        const version = await tx.planes.versionPorId(anterior.versionDePlanId);
        if (version === null) return err("VERSION_DE_PLAN_NO_ENCONTRADA");
        const plan = await tx.planes.obtenerPlan(version.planId);
        // Una versión siempre pertenece a un plan que existe (`version_de_plan_plan_id_fkey`).
        if (plan === null) throw new RangeError(`la versión ${version.id} no tiene plan`);

        const historial: AsignacionDePlan[] = guardadas.map((a) => ({
          numero: a.numero,
          vigenteDesde: a.vigenteDesde,
          planId: a.planId,
          versionDePlanId: a.versionDePlanId,
        }));
        const reemplazaProgramada = historial.some(
          (a) => estadoDeDecision(historial, a, contexto.ahora) === "PROGRAMADA",
        );
        const asignacion = decidirAsignacion(historial, {
          ahora: contexto.ahora,
          destino: {
            planId: version.planId,
            versionDePlanId: version.id,
            publicada: version.estado === "PUBLICADA",
            planRetirado: plan.estado === "RETIRADO",
          },
          vigenteDesde: contexto.ahora,
          motivo: pedido.motivo,
          numeroEsperado: pedido.numeroEsperado,
          reemplazaProgramada,
          origen: "CAMBIO",
        });
        if (!asignacion.ok) return asignacion;
        // Ya regía y no había nada programado: el cambio no tuvo efecto que deshacer (no hay asignación nueva que enlazar).
        if (asignacion.valor.resultado === "YA_ESTABA") return err("SIN_PLAN_ANTERIOR");

        const asignada = await tx.planes.asignar({
          tenantId: pedido.tenantId,
          numero: asignacion.valor.numero,
          versionDePlanId: asignacion.valor.versionDePlanId,
          vigenteDesde: contexto.ahora,
          origen: "CAMBIO",
          reemplazaProgramada,
          motivo: asignacion.valor.motivo,
        });
        await tx.planes.registrarArrepentimiento({
          tenantId: pedido.tenantId,
          numeroArrepentido: cambio.numero,
          numeroNuevo: asignada.numero,
          motivo: asignacion.valor.motivo,
        });
        const constancia = {
          accion: "PLAN_ARREPENTIDO",
          entidad: "plan_de_tenant",
          entidadId: asignada.id,
          antes: {
            numero: cambio.numero,
            versionDePlanId: cambio.versionDePlanId,
            planCodigo: cambio.planCodigo,
            versionNumero: cambio.versionNumero,
            vigenteDesde: instanteISO(cambio.vigenteDesde),
          },
          despues: {
            tenantId: pedido.tenantId,
            numero: asignada.numero,
            versionDePlanId: asignada.versionDePlanId,
            planCodigo: asignada.planCodigo,
            versionNumero: asignada.versionNumero,
            vigenteDesde: instanteISO(asignada.vigenteDesde),
            motivo: asignada.motivo,
            numeroArrepentido: cambio.numero,
            reemplazadas: [...asignacion.valor.reemplazadas],
          },
        } as const;
        await auditarEnLasEmpresas(
          tx,
          await tx.planes.empresasDelTenant(pedido.tenantId),
          constancia,
        );
        return ok({
          salida: { numero: asignada.numero, repetida: false },
          constancias: [constancia],
        });
      },
      comoRepeticion: (guardado) => ({ ...guardado, repetida: true }),
    });
    return aplanarError(traducirErroresDePlanes(resultado, MOTIVOS_DE_BASE_DE_ARREPENTIR));
  };
}
