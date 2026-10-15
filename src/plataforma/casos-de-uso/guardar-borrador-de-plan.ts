import {
  validarVersionDePlan,
  type ErrorDeVersionDePlan,
  type VersionDePlanValida,
} from "../../capacidades/planes/version-de-plan";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  traducirErroresDePlanes,
  type ContenidoDeVersionDePlanGuardable,
} from "../../modulos/planes/publico";
import { planId, type PlanId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { Dato } from "../../puertos/sin-secretos";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { validarVersionEsperada } from "../dominio/formas-de-entrada";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { datosDelContenidoDeLaVersion, listaDePerillas } from "./datos-de-planes";
import {
  aplanarError,
  datosIguales,
  ejecutarCasoDeMarcasYPlanes,
  type DependenciasDeMarcasYPlanes,
  type ErrorComunDeMarcasYPlanes,
  type ErrorPlano,
} from "./marcas-y-planes-comun";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_GUARDAR_BORRADOR_DE_PLAN = "planes.guardar_borrador";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_GUARDAR_BORRADOR_DE_PLAN = {
  accion: "planes.editar_borrador",
} as const satisfies DeclaracionDeAccionDePlataforma;

/** El contenido ENTERO del borrador: cada guardado lo reemplaza completo (no se mezcla con el anterior). */
export type EntradaDeGuardarBorradorDePlan = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN escribir ni auditar de nuevo. */
  claveDeIdempotencia: string;
  planId: string;
  /**
   * La `version` del borrador que vio quien edita, o `null` si no había borrador. Si otra persona lo cambió
   * entretanto, `VERSION_DESACTUALIZADA`: no se pierde el trabajo de nadie.
   */
  versionEsperada: number | null;
  nombreComercial: string;
  /** Claves de módulos del catálogo (el techo del plan); los obligatorios cuentan siempre. */
  modulos: readonly string[];
  /** Valor de cada perilla que el plan fija (`{ tipo: "INTERRUPTOR", encendida }` o `{ tipo: "LIMITE", limite }`); las que no figuran valen la base. */
  perillas: Readonly<Record<string, unknown>>;
}>;

export type SalidaDeGuardarBorradorDePlan = Readonly<{
  /** El id de la versión de plan en borrador. */
  borradorId: string;
  /** Su `version` actual: la `versionEsperada` de la próxima edición. */
  version: number;
}>;

/** Los motivos de la base que este caso admite: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITE = [
  "PLAN_NO_ENCONTRADO",
  "PLAN_RETIRADO",
  "NOMBRE_DE_PLAN_INVALIDO",
  "VERSION_DESACTUALIZADA",
] as const;

type ErrorPropio =
  | ErrorDeVersionDePlan
  | "ID_INVALIDO"
  | "VERSION_ESPERADA_INVALIDA"
  | "PLAN_NO_ENCONTRADO"
  | "PLAN_RETIRADO"
  | "VERSION_DESACTUALIZADA";

export type ErrorAlGuardarBorradorDePlan = ErrorPlano<
  ErrorComunDeMarcasYPlanes | ErrorPropio | (typeof MOTIVOS_QUE_ADMITE)[number]
>;

type Pedido = Readonly<{
  planId: PlanId;
  versionEsperada: number | null;
  contenido: VersionDePlanValida;
}>;

/** El contenido como dato plano para la huella y para comparar con el que ya hay. */
const comoDato = (contenido: ContenidoDeVersionDePlanGuardable): Dato => ({
  nombreComercial: contenido.nombreComercial,
  modulos: [...contenido.modulos],
  perillas: listaDePerillas(contenido.perillas),
});

/**
 * Guardar el borrador de una versión de plan (M5). Contexto de PLATAFORMA, solo ADMIN. Crea el borrador si
 * no había (`versionEsperada: null`) o reemplaza el contenido del que hay; un plan tiene a lo sumo un
 * borrador. Se valida el contenido entero (nombre comercial, módulos del catálogo con sus `requiere`,
 * perillas del catálogo con su tipo y sus `requiere`). El borrador no le cambia nada a nadie: eso lo hace
 * publicarlo y asignarlo. Guardar el mismo contenido es éxito sin escribir ni auditar. Deja la constancia
 * `PLAN_BORRADOR_GUARDADO`. Dos ediciones desde la misma `version`: una gana y la otra es
 * `VERSION_DESACTUALIZADA`.
 */
export function armarGuardarBorradorDePlan(dependencias: DependenciasDeMarcasYPlanes) {
  return async function guardarBorradorDePlan(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeGuardarBorradorDePlan,
  ): Promise<Resultado<SalidaDeGuardarBorradorDePlan, ErrorAlGuardarBorradorDePlan>> {
    const resultado = await ejecutarCasoDeMarcasYPlanes<
      SalidaDeGuardarBorradorDePlan,
      Pedido,
      ErrorPropio
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_GUARDAR_BORRADOR_DE_PLAN.accion,
      operacion: OPERACION_GUARDAR_BORRADOR_DE_PLAN,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const plan = uuidDesdeTexto(entrada.planId);
        if (!plan.ok) return plan;
        const version = validarVersionEsperada(entrada.versionEsperada);
        if (!version.ok) return version;
        const contenido = validarVersionDePlan(
          dependencias.catalogoDeModulos,
          dependencias.catalogoDePerillas,
          {
            nombreComercial: entrada.nombreComercial,
            modulos: entrada.modulos,
            perillas: entrada.perillas,
          },
        );
        if (!contenido.ok) return contenido;
        return ok({
          // La huella lleva lo ya validado y en forma canónica: el mismo pedido escrito distinto es el mismo pedido.
          entrada: {
            planId: plan.valor,
            versionEsperada: version.valor,
            contenido: comoDato(contenido.valor),
          },
          valor: {
            planId: planId(plan.valor),
            versionEsperada: version.valor,
            contenido: contenido.valor,
          },
        });
      },
      trabajar: async (tx, pedido) => {
        const plan = await tx.planes.obtenerPlan(pedido.planId);
        if (plan === null) return err("PLAN_NO_ENCONTRADO");
        if (plan.estado === "RETIRADO") return err("PLAN_RETIRADO");
        const existente = await tx.planes.borradorDe(pedido.planId);
        if ((existente === null ? null : existente.version) !== pedido.versionEsperada) {
          return err("VERSION_DESACTUALIZADA");
        }
        if (existente !== null && datosIguales(comoDato(existente), comoDato(pedido.contenido))) {
          return ok({
            salida: { borradorId: existente.id, version: existente.version },
            constancia: null,
          });
        }
        const guardado =
          existente === null
            ? await tx.planes.crearBorrador(pedido.planId, pedido.contenido)
            : await tx.planes.actualizarBorrador(existente.id, existente.version, pedido.contenido);
        // Con SERIALIZABLE otra transacción que cambiara el borrador antes ya habría abortado ésta (40001, que
        // el adaptador reintenta): sin fila acá es un nivel de aislamiento menor y se pide repetir.
        if (guardado === null) return err({ tipo: "ConcurrenciaAgotada" });
        return ok({
          salida: { borradorId: guardado.id, version: guardado.version },
          constancia: {
            accion: "PLAN_BORRADOR_GUARDADO",
            entidad: "version_de_plan",
            entidadId: guardado.id,
            antes: existente === null ? null : datosDelContenidoDeLaVersion(existente),
            despues: {
              planId: pedido.planId,
              planCodigo: plan.codigo,
              esNuevo: existente === null,
              version: guardado.version,
              ...datosDelContenidoDeLaVersion(guardado),
            },
          },
        });
      },
      comoRepeticion: (guardado) => guardado,
    });
    return aplanarError(traducirErroresDePlanes(resultado, MOTIVOS_QUE_ADMITE));
  };
}
