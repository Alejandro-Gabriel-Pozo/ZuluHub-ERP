import { vigenteEn } from "../../capacidades/planes/vigencia";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirAsignacion,
  traducirErroresDePlanes,
  type AsignacionDePlan,
  type ErrorDeAsignacion,
  type OrigenDeAsignacion,
} from "../../modulos/planes/publico";
import {
  tenantId as comoTenantId,
  versionDePlanId as comoVersionDePlanId,
  type TenantId,
  type VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { AccionDePlataforma } from "../../puertos/auditoria-de-plataforma";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  validarLargoDelMotivo,
  validarNumeroEsperado,
  validarVigencia,
} from "../dominio/formas-de-entrada";
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

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_ASIGNAR_PLAN = "planes.asignar";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_ASIGNAR_PLAN = {
  accion: "planes.asignar",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeAsignarPlan = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN asignar otra vez ni auditar de nuevo. */
  claveDeIdempotencia: string;
  tenantId: string;
  /** La versión PUBLICADA que pasa a regir. */
  versionDePlanId: string;
  /** Desde cuándo rige. No puede ser retroactiva (se tolera un minuto de reloj). */
  vigenteDesde: Date;
  motivo: string;
  /**
   * El número de la última asignación que vio quien decide, o `null` si el tenant no tenía ninguna. Si otra
   * persona asignó entretanto, `VERSION_DESACTUALIZADA`: la última decisión manda, sin perder ninguna.
   */
  numeroEsperado: number | null;
  /** Hay una asignación programada que esta deja sin efecto: hay que decirlo (`CAMBIO_PROGRAMADO_PENDIENTE`). */
  reemplazaProgramada: boolean;
}>;

export type SalidaDeAsignarPlan = Readonly<{
  /** El número de la asignación que rige o regirá (el de la nueva, o el de la que ya estaba). */
  numero: number;
  /**
   * `true` cuando esta llamada no escribió nada: la versión pedida ya regía y no había nada programado, o
   * repite una anterior con la misma clave.
   */
  yaExistia: boolean;
}>;

/** Los motivos de la base que este caso admite: la segunda barrera ante una carrera. */
export const MOTIVOS_DE_BASE_DE_ASIGNAR_PLAN = [
  "TENANT_NO_ENCONTRADO",
  "VERSION_DESACTUALIZADA",
  "VERSION_DE_PLAN_NO_PUBLICADA",
  "VIGENCIA_RETROACTIVA",
  "MOTIVO_OBLIGATORIO",
] as const;

type ErrorPropio =
  | ErrorDeAsignacion
  | "ID_INVALIDO"
  | "NUMERO_ESPERADO_INVALIDO"
  | "VIGENCIA_INVALIDA"
  | "MOTIVO_DEMASIADO_LARGO"
  | "TENANT_NO_ENCONTRADO"
  | "VERSION_DE_PLAN_NO_ENCONTRADA";

export type ErrorAlAsignarPlan = ErrorPlano<
  ErrorComunDeMarcasYPlanes | ErrorPropio | (typeof MOTIVOS_DE_BASE_DE_ASIGNAR_PLAN)[number]
>;

/** Cómo se asigna: por qué nace la asignación y cómo se audita (un cambio suelto, o un tenant de un lote). */
export type ModoDeAsignacion = Readonly<{
  origen: OrigenDeAsignacion;
  operacion: string;
  accionDeAuditoria: Extract<AccionDePlataforma, "PLAN_ASIGNADO" | "PLAN_MIGRADO_POR_LOTE">;
  /** La clave del lote, para la constancia; `null` fuera de un lote. */
  lote: string | null;
}>;

/** Lo que se guarda como resultado de la clave: la asignación y si fue una escritura o un «ya estaba». */
export type SalidaInternaDeAsignacion = Readonly<{
  numero: number;
  resultado: "ASIGNADO" | "YA_ESTABA";
  /** `true` cuando es la repetición de una llamada anterior con la misma clave. */
  repetida: boolean;
}>;

type Pedido = Readonly<{
  tenantId: TenantId;
  versionDePlanId: VersionDePlanId;
  vigenteDesde: Date;
  motivo: string;
  numeroEsperado: number | null;
  reemplazaProgramada: boolean;
}>;

/**
 * La asignación de un plan a UN tenant, en una transacción propia: la comparten `asignarPlan` y cada
 * tenant de `migrarTenantsDeVersion`. Ver `armarAsignarPlan` por las reglas.
 */
export async function asignarAUnTenant(
  dependencias: DependenciasDeMarcasYPlanes,
  contexto: ContextoDePlataforma,
  entrada: EntradaDeAsignarPlan,
  modo: ModoDeAsignacion,
): Promise<Resultado<SalidaInternaDeAsignacion, ErrorAlAsignarPlan>> {
  const resultado = await ejecutarCasoDeMarcasYPlanes<
    SalidaInternaDeAsignacion,
    Pedido,
    ErrorPropio
  >(dependencias, {
    contexto,
    accion: DECLARACION_DE_ASIGNAR_PLAN.accion,
    operacion: modo.operacion,
    claveDeIdempotencia: entrada.claveDeIdempotencia,
    validar: () => {
      const tenant = uuidDesdeTexto(entrada.tenantId);
      if (!tenant.ok) return tenant;
      const version = uuidDesdeTexto(entrada.versionDePlanId);
      if (!version.ok) return version;
      const vigencia = validarVigencia(entrada.vigenteDesde);
      if (!vigencia.ok) return vigencia;
      const motivo = validarLargoDelMotivo(entrada.motivo);
      if (!motivo.ok) return motivo;
      const numero = validarNumeroEsperado(entrada.numeroEsperado);
      if (!numero.ok) return numero;
      return ok({
        entrada: {
          tenantId: tenant.valor,
          versionDePlanId: version.valor,
          vigenteDesde: instanteISO(vigencia.valor),
          motivo: motivo.valor.trim(),
          numeroEsperado: numero.valor,
          reemplazaProgramada: entrada.reemplazaProgramada,
        },
        valor: {
          tenantId: comoTenantId(tenant.valor),
          versionDePlanId: comoVersionDePlanId(version.valor),
          vigenteDesde: vigencia.valor,
          motivo: motivo.valor,
          numeroEsperado: numero.valor,
          reemplazaProgramada: entrada.reemplazaProgramada,
        },
      });
    },
    trabajar: async (tx, pedido) => {
      if (!(await tx.planes.existeElTenant(pedido.tenantId))) return err("TENANT_NO_ENCONTRADO");
      const version = await tx.planes.versionPorId(pedido.versionDePlanId);
      if (version === null) return err("VERSION_DE_PLAN_NO_ENCONTRADA");
      const plan = await tx.planes.obtenerPlan(version.planId);
      // Una versión siempre pertenece a un plan que existe (`version_de_plan_plan_id_fkey`).
      if (plan === null) throw new RangeError(`la versión ${version.id} no tiene plan`);

      const guardadas = await tx.planes.asignacionesDelTenant(pedido.tenantId);
      const historial: AsignacionDePlan[] = guardadas.map((a) => ({
        numero: a.numero,
        vigenteDesde: a.vigenteDesde,
        planId: a.planId,
        versionDePlanId: a.versionDePlanId,
      }));
      const decision = decidirAsignacion(historial, {
        ahora: contexto.ahora,
        destino: {
          planId: version.planId,
          versionDePlanId: version.id,
          publicada: version.estado === "PUBLICADA",
          planRetirado: plan.estado === "RETIRADO",
        },
        vigenteDesde: pedido.vigenteDesde,
        motivo: pedido.motivo,
        numeroEsperado: pedido.numeroEsperado,
        reemplazaProgramada: pedido.reemplazaProgramada,
        origen: modo.origen,
      });
      if (!decision.ok) return decision;
      if (decision.valor.resultado === "YA_ESTABA") {
        return ok({
          salida: { numero: decision.valor.numero, resultado: "YA_ESTABA", repetida: false },
          constancia: null,
        });
      }

      const asignada = await tx.planes.asignar({
        tenantId: pedido.tenantId,
        numero: decision.valor.numero,
        versionDePlanId: decision.valor.versionDePlanId,
        vigenteDesde: pedido.vigenteDesde,
        origen: decision.valor.origen,
        reemplazaProgramada: pedido.reemplazaProgramada,
        motivo: decision.valor.motivo,
      });
      const anterior = vigenteEn(guardadas, contexto.ahora);
      const constancia = {
        accion: modo.accionDeAuditoria,
        entidad: "plan_de_tenant",
        entidadId: asignada.id,
        antes:
          anterior === null
            ? null
            : {
                numero: anterior.numero,
                versionDePlanId: anterior.versionDePlanId,
                planId: anterior.planId,
                planCodigo: anterior.planCodigo,
                versionNumero: anterior.versionNumero,
              },
        despues: {
          tenantId: pedido.tenantId,
          numero: asignada.numero,
          versionDePlanId: asignada.versionDePlanId,
          planId: asignada.planId,
          planCodigo: asignada.planCodigo,
          versionNumero: asignada.versionNumero,
          nombreComercial: asignada.nombreComercial,
          vigenteDesde: instanteISO(asignada.vigenteDesde),
          origen: asignada.origen,
          motivo: asignada.motivo,
          reemplazaProgramada: asignada.reemplazaProgramada,
          reemplazadas: [...decision.valor.reemplazadas],
          lote: modo.lote,
        },
      } as const;
      // Lo que afecta a una empresa deja además su constancia en CADA empresa del tenant (actor nulo).
      await auditarEnLasEmpresas(
        tx,
        await tx.planes.empresasDelTenant(pedido.tenantId),
        constancia,
      );
      return ok({
        salida: { numero: asignada.numero, resultado: "ASIGNADO", repetida: false },
        constancia,
      });
    },
    comoRepeticion: (guardado) => ({ ...guardado, repetida: true }),
  });
  return aplanarError(traducirErroresDePlanes(resultado, MOTIVOS_DE_BASE_DE_ASIGNAR_PLAN));
}

/**
 * Asignar un plan a un tenant (M5). Contexto de PLATAFORMA, solo ADMIN. Inserta una asignación más (nunca
 * pisa ni borra la anterior): rige la de mayor número entre las que ya empezaron («la última decisión
 * manda»). Una baja que quita módulos o baja un límite NO se rechaza: los módulos quedan en solo lectura y
 * todo se conserva. Si la versión pedida ya rige y no hay nada programado, es éxito sin escribir. Deja la
 * constancia `PLAN_ASIGNADO` y una en la auditoría de CADA empresa del tenant (actor nulo). Dos cambios
 * desde el mismo `numeroEsperado`: uno gana y el otro es `VERSION_DESACTUALIZADA`, sin huecos ni números
 * repetidos.
 */
export function armarAsignarPlan(dependencias: DependenciasDeMarcasYPlanes) {
  return async function asignarPlan(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeAsignarPlan,
  ): Promise<Resultado<SalidaDeAsignarPlan, ErrorAlAsignarPlan>> {
    const hecha = await asignarAUnTenant(dependencias, contexto, entrada, {
      origen: "CAMBIO",
      operacion: OPERACION_ASIGNAR_PLAN,
      accionDeAuditoria: "PLAN_ASIGNADO",
      lote: null,
    });
    if (!hecha.ok) return hecha;
    const { numero, resultado, repetida } = hecha.valor;
    return ok({ numero, yaExistia: resultado === "YA_ESTABA" || repetida });
  };
}
