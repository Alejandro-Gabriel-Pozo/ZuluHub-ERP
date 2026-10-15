import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirGuardadoDeBorrador,
  traducirErroresDeMarca,
  validarCambiosDeBorrador,
  type CambiosDeBorrador,
  type CambiosValidadosDeBorrador,
  type ErrorDeFormaDeBorrador,
} from "../../modulos/marcas/publico";
import {
  marcaComercialId,
  planId,
  type MarcaComercialId,
  type PlanId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { validarVersionEsperada } from "../dominio/formas-de-entrada";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { datosDeLaDefinicion, definicionesIguales, paresDeVocabulario } from "./datos-de-marcas";
import {
  aplanarError,
  ejecutarCasoDeMarcasYPlanes,
  type DependenciasDeMarcasYPlanes,
  type ErrorComunDeMarcasYPlanes,
  type ErrorPlano,
} from "./marcas-y-planes-comun";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_GUARDAR_BORRADOR_DE_MARCA = "marcas.guardar_borrador";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_GUARDAR_BORRADOR_DE_MARCA = {
  accion: "marcas.editar_borrador",
} as const satisfies DeclaracionDeAccionDePlataforma;

/**
 * Lo que se cambia del borrador. Un campo AUSENTE no se toca; `null` lo vacía (vuelve a heredar de la marca
 * padre); uno con valor lo reemplaza ENTERO (el tema y el vocabulario no se mezclan con los anteriores).
 */
export type EntradaDeGuardarBorradorDeMarca = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN escribir ni auditar de nuevo. */
  claveDeIdempotencia: string;
  marcaId: string;
  /**
   * La `version` del borrador que vio quien edita, o `null` si no había borrador. Si otra persona lo cambió
   * entretanto, `VERSION_DESACTUALIZADA`: no se pierde el trabajo de nadie.
   */
  versionEsperada: number | null;
  nombreVisible?: string | null | undefined;
  /** Colores `#rrggbb` por token (`primary`, `on-primary`, `secondary`, `accent`). */
  tema?: Readonly<Record<string, unknown>> | undefined;
  /** Ruta a un PNG o WebP propio del despliegue (`/marcas/<marca>/<archivo>.png`). */
  logo?: string | null | undefined;
  /** Reemplazos de texto por clave del catálogo de textos. */
  vocabulario?: Readonly<Record<string, string>> | undefined;
  /** Claves de módulos del catálogo, disponibles y no obligatorias; `[]` = solo administración. */
  modulosIniciales?: readonly string[] | null | undefined;
  planPorDefectoId?: string | null | undefined;
}>;

export type SalidaDeGuardarBorradorDeMarca = Readonly<{
  /** El id de la versión de marca en borrador. */
  borradorId: string;
  /** Su `version` actual: la `versionEsperada` de la próxima edición. */
  version: number;
}>;

/** Los motivos de la base que este caso admite: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITE = [
  "MARCA_NO_ENCONTRADA",
  "MARCA_RETIRADA",
  "NOMBRE_DE_MARCA_INVALIDO",
  "LOGO_INVALIDO",
  "PLAN_NO_ENCONTRADO",
  "VERSION_DESACTUALIZADA",
] as const;

type ErrorPropio =
  | ErrorDeFormaDeBorrador
  | "ID_INVALIDO"
  | "VERSION_ESPERADA_INVALIDA"
  | "MARCA_NO_ENCONTRADA"
  | "MARCA_RETIRADA"
  | "PLAN_NO_ENCONTRADO"
  | "VERSION_DESACTUALIZADA";

export type ErrorAlGuardarBorradorDeMarca = ErrorPlano<
  ErrorComunDeMarcasYPlanes | ErrorPropio | (typeof MOTIVOS_QUE_ADMITE)[number]
>;

type Pedido = Readonly<{
  marcaId: MarcaComercialId;
  versionEsperada: number | null;
  cambios: CambiosValidadosDeBorrador;
}>;

/** Los cambios tal como llegan, con el plan por defecto ya como identificador. */
function cambiosDeLaEntrada(
  entrada: EntradaDeGuardarBorradorDeMarca,
  plan: PlanId | null | undefined,
): CambiosDeBorrador {
  return {
    ...(entrada.nombreVisible !== undefined && { nombreVisible: entrada.nombreVisible }),
    ...(entrada.tema !== undefined && { tema: entrada.tema }),
    ...(entrada.logo !== undefined && { logo: entrada.logo }),
    ...(entrada.vocabulario !== undefined && { vocabulario: entrada.vocabulario }),
    ...(entrada.modulosIniciales !== undefined && { modulosIniciales: entrada.modulosIniciales }),
    ...(plan !== undefined && { planPorDefectoId: plan }),
  };
}

/**
 * Guardar el borrador de una marca (M5). Contexto de PLATAFORMA, solo ADMIN. Crea el borrador si no había
 * (`versionEsperada: null`) o aplica los cambios al que hay; una marca tiene a lo sumo un borrador. El
 * borrador no cambia lo que se ve: eso lo hace confirmarlo. Guardar sin cambios reales es éxito sin escribir
 * ni auditar. Deja la constancia `MARCA_BORRADOR_GUARDADO` (el vocabulario, como pares texto, antes,
 * después). Dos ediciones desde la misma `version`: una gana y la otra es `VERSION_DESACTUALIZADA`.
 */
export function armarGuardarBorradorDeMarca(dependencias: DependenciasDeMarcasYPlanes) {
  return async function guardarBorradorDeMarca(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeGuardarBorradorDeMarca,
  ): Promise<Resultado<SalidaDeGuardarBorradorDeMarca, ErrorAlGuardarBorradorDeMarca>> {
    const resultado = await ejecutarCasoDeMarcasYPlanes<
      SalidaDeGuardarBorradorDeMarca,
      Pedido,
      ErrorPropio
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_GUARDAR_BORRADOR_DE_MARCA.accion,
      operacion: OPERACION_GUARDAR_BORRADOR_DE_MARCA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const marca = uuidDesdeTexto(entrada.marcaId);
        if (!marca.ok) return marca;
        const version = validarVersionEsperada(entrada.versionEsperada);
        if (!version.ok) return version;
        let plan: PlanId | null | undefined;
        if (entrada.planPorDefectoId === undefined || entrada.planPorDefectoId === null) {
          plan = entrada.planPorDefectoId;
        } else {
          const id = uuidDesdeTexto(entrada.planPorDefectoId);
          if (!id.ok) return id;
          plan = planId(id.valor);
        }
        const cambios = validarCambiosDeBorrador(
          cambiosDeLaEntrada(entrada, plan),
          dependencias.catalogoDeModulos,
        );
        if (!cambios.ok) return cambios;
        return ok({
          // La huella lleva lo ya validado y en forma canónica: el mismo pedido escrito distinto es el mismo pedido.
          entrada: {
            marcaId: marca.valor,
            versionEsperada: version.valor,
            cambios: {
              ...(cambios.valor.nombreVisible !== undefined && {
                nombreVisible: cambios.valor.nombreVisible,
              }),
              ...(cambios.valor.tema !== undefined && { tema: { ...cambios.valor.tema } }),
              ...(cambios.valor.logo !== undefined && { logo: cambios.valor.logo }),
              ...(cambios.valor.vocabulario !== undefined && {
                vocabulario: { ...cambios.valor.vocabulario },
              }),
              ...(cambios.valor.modulosIniciales !== undefined && {
                modulosIniciales:
                  cambios.valor.modulosIniciales === null
                    ? null
                    : [...cambios.valor.modulosIniciales],
              }),
              ...(cambios.valor.planPorDefectoId !== undefined && {
                planPorDefectoId: cambios.valor.planPorDefectoId,
              }),
            },
          },
          valor: {
            marcaId: marcaComercialId(marca.valor),
            versionEsperada: version.valor,
            cambios: cambios.valor,
          },
        });
      },
      trabajar: async (tx, pedido) => {
        const marca = await tx.marcas.obtener(pedido.marcaId);
        if (marca === null) return err("MARCA_NO_ENCONTRADA");
        if (marca.estado === "RETIRADA") return err("MARCA_RETIRADA");
        const plan = pedido.cambios.planPorDefectoId;
        if (plan !== undefined && plan !== null && (await tx.planes.obtenerPlan(plan)) === null) {
          return err("PLAN_NO_ENCONTRADO");
        }
        const existente = await tx.marcas.borradorDe(pedido.marcaId);
        const decision = decidirGuardadoDeBorrador(
          existente === null
            ? null
            : { definicion: existente.definicion, version: existente.version },
          pedido.versionEsperada,
          pedido.cambios,
        );
        if (!decision.ok) return decision;
        const { definicion, esNuevo } = decision.valor;
        if (existente !== null && definicionesIguales(existente.definicion, definicion)) {
          return ok({
            salida: { borradorId: existente.id, version: existente.version },
            constancia: null,
          });
        }
        const guardado =
          existente === null
            ? await tx.marcas.crearBorrador(pedido.marcaId, definicion)
            : await tx.marcas.actualizarBorrador(existente.id, existente.version, definicion);
        // Con SERIALIZABLE otra transacción que cambiara el borrador antes ya habría abortado ésta (40001, que
        // el adaptador reintenta): sin fila acá es un nivel de aislamiento menor y se pide repetir.
        if (guardado === null) return err({ tipo: "ConcurrenciaAgotada" });
        const antes = existente === null ? null : existente.definicion;
        return ok({
          salida: { borradorId: guardado.id, version: guardado.version },
          constancia: {
            accion: "MARCA_BORRADOR_GUARDADO",
            entidad: "version_de_marca",
            entidadId: guardado.id,
            antes: antes === null ? null : datosDeLaDefinicion(antes),
            despues: {
              marcaId: pedido.marcaId,
              esNuevo,
              version: guardado.version,
              ...datosDeLaDefinicion(guardado.definicion),
              vocabulario: paresDeVocabulario(antes, guardado.definicion),
            },
          },
        });
      },
      comoRepeticion: (guardado) => guardado,
    });
    return aplanarError(traducirErroresDeMarca(resultado, MOTIVOS_QUE_ADMITE));
  };
}
