import { validarCodigoDePlan } from "../../capacidades/planes/version-de-plan";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { traducirErroresDePlanes } from "../../modulos/planes/publico";
import type { PlanId } from "../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  aplanarError,
  ejecutarCasoDeMarcasYPlanes,
  type DependenciasDeMarcasYPlanes,
  type ErrorComunDeMarcasYPlanes,
  type ErrorPlano,
} from "./marcas-y-planes-comun";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_CREAR_PLAN = "planes.crear";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_CREAR_PLAN = {
  accion: "planes.crear",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeCrearPlan = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN registrar otro plan ni otra constancia. */
  claveDeIdempotencia: string;
  /** El código técnico del plan: minúsculas, dígitos y guion, de 2 a 40, empieza con letra. No cambia nunca. */
  codigo: string;
}>;

export type SalidaDeCrearPlan = Readonly<{
  planId: PlanId;
  /** `true` cuando el plan ya existía o esta llamada repite una anterior con la misma clave. */
  yaExistia: boolean;
}>;

/** Los motivos de la base que este caso admite: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITE = ["CODIGO_DE_PLAN_INVALIDO"] as const;

export type ErrorAlCrearPlan = ErrorPlano<
  ErrorComunDeMarcasYPlanes | (typeof MOTIVOS_QUE_ADMITE)[number]
>;

/**
 * Crear un plan (M5). Contexto de PLATAFORMA, solo ADMIN. Registra el plan con su código técnico; nace
 * `ACTIVO` y sin versiones: el contenido (nombre comercial, módulos, perillas) vive en sus versiones, que
 * se arman en un borrador y se publican. Crear el plan que ya existe es éxito sin escribir (`yaExistia`).
 * Deja la constancia `PLAN_CREADO` con el actor del contexto. Dos altas del mismo código a la vez: una
 * gana y la otra ve el plan y devuelve `yaExistia`.
 */
export function armarCrearPlan(dependencias: DependenciasDeMarcasYPlanes) {
  return async function crearPlan(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeCrearPlan,
  ): Promise<Resultado<SalidaDeCrearPlan, ErrorAlCrearPlan>> {
    const resultado = await ejecutarCasoDeMarcasYPlanes<
      SalidaDeCrearPlan,
      string,
      "CODIGO_DE_PLAN_INVALIDO"
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_CREAR_PLAN.accion,
      operacion: OPERACION_CREAR_PLAN,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const codigo = validarCodigoDePlan(entrada.codigo);
        if (!codigo.ok) return codigo;
        return ok({ entrada: { codigo: codigo.valor }, valor: codigo.valor });
      },
      trabajar: async (tx, codigo) => {
        const existente = await tx.planes.obtenerPlanPorCodigo(codigo);
        if (existente !== null) {
          return ok({ salida: { planId: existente.id, yaExistia: true }, constancias: [] });
        }
        const creado = await tx.planes.crearPlan(codigo);
        return ok({
          salida: { planId: creado.id, yaExistia: false },
          constancias: [
            {
              accion: "PLAN_CREADO",
              entidad: "plan",
              entidadId: creado.id,
              antes: null,
              despues: { codigo: creado.codigo, estado: creado.estado },
            },
          ],
        });
      },
      comoRepeticion: (guardado) => ({ ...guardado, yaExistia: true }),
    });
    return aplanarError(traducirErroresDePlanes(resultado, MOTIVOS_QUE_ADMITE));
  };
}
