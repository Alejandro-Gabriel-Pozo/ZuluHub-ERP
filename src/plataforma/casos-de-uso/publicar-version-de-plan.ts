import {
  validarVersionDePlan,
  type ErrorDeVersionDePlan,
} from "../../capacidades/planes/version-de-plan";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { traducirErroresDePlanes } from "../../modulos/planes/publico";
import { planId, type PlanId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { validarLargoDelMotivo } from "../dominio/formas-de-entrada";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { datosDelContenidoDeLaVersion } from "./datos-de-planes";
import {
  aplanarError,
  ejecutarCasoDeMarcasYPlanes,
  instanteISO,
  type DependenciasDeMarcasYPlanes,
  type ErrorComunDeMarcasYPlanes,
  type ErrorPlano,
} from "./marcas-y-planes-comun";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_PUBLICAR_VERSION_DE_PLAN = "planes.publicar_version";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_PUBLICAR_VERSION_DE_PLAN = {
  accion: "planes.publicar_version",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDePublicarVersionDePlan = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN publicar otra versión ni auditar de nuevo. */
  claveDeIdempotencia: string;
  planId: string;
  motivo: string;
}>;

export type SalidaDePublicarVersionDePlan = Readonly<{
  /** El número consecutivo de la versión dentro de su plan. */
  numero: number;
}>;

/** Los motivos de la base que este caso admite: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITE = [
  "PLAN_NO_ENCONTRADO",
  "PLAN_RETIRADO",
  "NOMBRE_DE_PLAN_INVALIDO",
] as const;

type ErrorPropio =
  | ErrorDeVersionDePlan
  | "ID_INVALIDO"
  | "MOTIVO_DEMASIADO_LARGO"
  | "PLAN_NO_ENCONTRADO"
  | "PLAN_RETIRADO"
  | "SIN_BORRADOR"
  | "MOTIVO_OBLIGATORIO";

export type ErrorAlPublicarVersionDePlan = ErrorPlano<
  ErrorComunDeMarcasYPlanes | ErrorPropio | (typeof MOTIVOS_QUE_ADMITE)[number]
>;

type Pedido = Readonly<{ planId: PlanId; motivo: string }>;

/**
 * Publicar la versión de un plan (M5). Contexto de PLATAFORMA, solo ADMIN. Convierte el borrador en la
 * versión siguiente del plan: queda congelada para siempre (también para el dueño de la base) y la base le
 * pone el número. Publicar NO mueve a nadie: cada tenant sigue con la versión que tenía hasta que se le
 * asigne otra (`asignarPlan`, `migrarTenantsDeVersion`). El contenido se vuelve a validar contra los
 * catálogos de ahora (el código pudo cambiar desde que se guardó el borrador). Deja la constancia
 * `PLAN_VERSION_PUBLICADA`. Dos publicaciones del mismo borrador a la vez: una sola publica y la otra ve que
 * ya no hay borrador (`SIN_BORRADOR`), salvo que sea la misma clave, que devuelve lo mismo.
 */
export function armarPublicarVersionDePlan(dependencias: DependenciasDeMarcasYPlanes) {
  return async function publicarVersionDePlan(
    contexto: ContextoDePlataforma,
    entrada: EntradaDePublicarVersionDePlan,
  ): Promise<Resultado<SalidaDePublicarVersionDePlan, ErrorAlPublicarVersionDePlan>> {
    const resultado = await ejecutarCasoDeMarcasYPlanes<
      SalidaDePublicarVersionDePlan,
      Pedido,
      ErrorPropio
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_PUBLICAR_VERSION_DE_PLAN.accion,
      operacion: OPERACION_PUBLICAR_VERSION_DE_PLAN,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const plan = uuidDesdeTexto(entrada.planId);
        if (!plan.ok) return plan;
        const motivo = validarLargoDelMotivo(entrada.motivo);
        if (!motivo.ok) return motivo;
        return ok({
          entrada: { planId: plan.valor, motivo: motivo.valor.trim() },
          valor: { planId: planId(plan.valor), motivo: motivo.valor.trim() },
        });
      },
      trabajar: async (tx, pedido) => {
        const plan = await tx.planes.obtenerPlan(pedido.planId);
        if (plan === null) return err("PLAN_NO_ENCONTRADO");
        if (plan.estado === "RETIRADO") return err("PLAN_RETIRADO");
        const borrador = await tx.planes.borradorDe(pedido.planId);
        if (borrador === null) return err("SIN_BORRADOR");
        if (pedido.motivo === "") return err("MOTIVO_OBLIGATORIO");
        const contenido = validarVersionDePlan(
          dependencias.catalogoDeModulos,
          dependencias.catalogoDePerillas,
          borrador,
        );
        if (!contenido.ok) return contenido;

        const publicadas = await tx.planes.publicadasDe(pedido.planId);
        const numero = (publicadas.at(-1)?.numero ?? 0) + 1;
        const publicada = await tx.planes.publicar(borrador.id, borrador.version, {
          numero,
          motivo: pedido.motivo,
          publicadaEn: contexto.ahora,
        });
        // Con SERIALIZABLE otra transacción que cambiara el borrador antes ya habría abortado ésta (40001, que
        // el adaptador reintenta): sin fila acá es un nivel de aislamiento menor y se pide repetir.
        if (publicada === null) return err({ tipo: "ConcurrenciaAgotada" });
        return ok({
          salida: { numero: publicada.numero },
          constancias: [
            {
              accion: "PLAN_VERSION_PUBLICADA",
              entidad: "version_de_plan",
              entidadId: publicada.id,
              antes: null,
              despues: {
                planId: pedido.planId,
                planCodigo: plan.codigo,
                numero: publicada.numero,
                motivo: publicada.motivo,
                publicadaEn: instanteISO(publicada.publicadaEn),
                ...datosDelContenidoDeLaVersion(publicada),
              },
            },
          ],
        });
      },
      comoRepeticion: (guardado) => guardado,
    });
    return aplanarError(traducirErroresDePlanes(resultado, MOTIVOS_QUE_ADMITE));
  };
}
