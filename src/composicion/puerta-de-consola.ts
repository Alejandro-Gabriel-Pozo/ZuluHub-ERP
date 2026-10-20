import type { CodigoDePlataforma } from "../capacidades/autenticacion/codigos-de-plataforma";
import type { ClaveAccionDePlataforma } from "../capacidades/permisos/plataforma";
import {
  decidirSegundoFactorRecienteDeLaAccion,
  type ErrorDeSegundoFactorReciente,
} from "../capacidades/permisos/segundo-factor-reciente";
import type { ContextoDePlataforma } from "../contexto/contexto";
import { DECLARACIONES_DE_ALTAS } from "../plataforma/casos-de-uso/altas";
import { DECLARACIONES_DE_DOMINIOS } from "../plataforma/casos-de-uso/dominios";
import { DECLARACIONES_DE_MARCAS_Y_PLANES } from "../plataforma/casos-de-uso/marcas-y-planes";
import { DECLARACIONES_DE_SOPORTE } from "../plataforma/casos-de-uso/soporte";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA } from "../plataforma/consultas/declaraciones";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES } from "../plataforma/consultas/declaraciones-de-marcas-y-planes";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import type { SesionAutenticada } from "../puertos/autenticacion";
import { armarPlataforma, type OpcionesDePlataforma, type Plataforma } from "./plataforma";
import {
  crearContextoDePlataformaDeLaSesion,
  type AccesoDeSesionDePlataforma,
} from "./sesion-de-plataforma";

/**
 * La puerta de la CONSOLA de plataforma (`apps/plataforma/servidor`): la ÚNICA forma de ejecutar un caso o una consulta de
 * plataforma desde una persona con sesión (h5-p8 §2.3 y §2.4 bis). Previene dos fallos de la puerta de plataforma:
 *
 *  - armar el contexto a mano: quien llama NO pasa un contexto, pasa la sesión; el contexto lo arma
 *    `contextoDePlataformaDeLaSesion` con TODO lo que exige (sesión vigente en el host de la consola, email verificado,
 *    administrador activo leído de la base y segundo factor verificado en esa sesión);
 *  - olvidar el segundo factor reciente: cada función que se obtiene de acá comprueba, ANTES de correr el caso, que las
 *    acciones marcadas `segundoFactorReciente` en el catálogo tengan el segundo factor de la sesión de hace 5 minutos o
 *    menos, y devuelve `segundo_factor_reciente_requerido` si no. No hay otra función que ejecute un caso: el objeto de
 *    plataforma sin esa comprobación (`armarPlataforma`) lo importan solo los scripts del dueño y las pruebas (regla de
 *    arquitectura `plataforma-solo-desde-scripts`: `apps/plataforma` entra solo por este archivo).
 *
 * Los scripts del dueño (P7: sin sesión web, el administrador se identifica por su email y el dueño tiene la credencial)
 * quedan FUERA de la exigencia del segundo factor reciente, a propósito: no hay segundo factor que pedirles.
 *
 * Lo que NO se ofrece: el barrido de altas vencidas (lo corre el sistema, no una persona) y registrar la referencia de
 * un error (necesita un contexto que la puerta no entrega); ninguno de los dos pasa por el guard (`sinGuard`).
 *
 * Perezosa como `armarPlataforma`: armarla no lee ni valida nada.
 */

/** Los errores propios de la puerta (los demás son los del caso o la consulta): el segundo factor viejo. */
export type ErrorDeLaPuertaDeConsola = ErrorDeSegundoFactorReciente;

type Funcion = (
  contexto: ContextoDePlataforma,
  ...resto: never[]
) => Promise<Resultado<unknown, unknown>>;

/** La función sin su contexto, con el error de la puerta sumado al suyo. */
type SinContexto<F> = F extends (
  contexto: ContextoDePlataforma,
  ...resto: infer P
) => Promise<Resultado<infer S, infer E>>
  ? (...resto: P) => Promise<Resultado<S, E | ErrorDeLaPuertaDeConsola>>
  : never;

/** De las declaraciones, solo lo que pasa por el guard (con `accion`): lo `sinGuard` no se ofrece a la consola. */
type ConGuard<D> = {
  [K in keyof D as D[K] extends { accion: ClaveAccionDePlataforma } ? K : never]: D[K];
};

type Expuestas<Grupo, D> = { [K in keyof ConGuard<D> & keyof Grupo]: SinContexto<Grupo[K]> };

/** Los casos de uso que la consola puede ejecutar, sin contexto: `casos.suspenderPersona(entrada)`. */
export type CasosDeConsola = Expuestas<
  ReturnType<Plataforma["casosDeUsoDeAltas"]>,
  typeof DECLARACIONES_DE_ALTAS
> &
  Expuestas<ReturnType<Plataforma["casosDeUsoDeDominios"]>, typeof DECLARACIONES_DE_DOMINIOS> &
  Expuestas<
    ReturnType<Plataforma["casosDeUsoDeMarcasYPlanes"]>,
    typeof DECLARACIONES_DE_MARCAS_Y_PLANES
  > &
  Expuestas<ReturnType<Plataforma["casosDeUsoDeSoporte"]>, typeof DECLARACIONES_DE_SOPORTE>;

/** Las consultas de solo lectura, sin contexto: `consultas.listarTenants(filtros)`. */
export type ConsultasDeConsola = Expuestas<
  ReturnType<Plataforma["consultasDePlataforma"]>,
  typeof DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA
> &
  Expuestas<
    ReturnType<Plataforma["consultasDeMarcasYPlanes"]>,
    typeof DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES
  >;

type Grupo = Readonly<{
  clase: "casos" | "consultas";
  /** Qué acción exige cada nombre (o por qué no pasa por el guard). */
  declaraciones: Readonly<Record<string, Readonly<{ accion: ClaveAccionDePlataforma }> | object>>;
  armar: (plataforma: PlataformaParaLaConsola) => Readonly<Record<string, Funcion>>;
}>;

/** Los grupos de casos y consultas de plataforma. Cada grupo se arma recién al usarlo y valida SUS variables. */
const GRUPOS: readonly Grupo[] = [
  { clase: "casos", declaraciones: DECLARACIONES_DE_ALTAS, armar: (p) => p.casosDeUsoDeAltas() },
  {
    clase: "casos",
    declaraciones: DECLARACIONES_DE_DOMINIOS,
    armar: (p) => p.casosDeUsoDeDominios(),
  },
  {
    clase: "casos",
    declaraciones: DECLARACIONES_DE_MARCAS_Y_PLANES,
    armar: (p) => p.casosDeUsoDeMarcasYPlanes(),
  },
  {
    clase: "casos",
    declaraciones: DECLARACIONES_DE_SOPORTE,
    armar: (p) => p.casosDeUsoDeSoporte(),
  },
  {
    clase: "consultas",
    declaraciones: DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA,
    armar: (p) => p.consultasDePlataforma(),
  },
  {
    clase: "consultas",
    declaraciones: DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES,
    armar: (p) => p.consultasDeMarcasYPlanes(),
  },
];

/** Los casos y consultas que se ofrecen, con la acción que cada uno exige al guard. `sinGuard` no entra. */
function conAccion(grupo: Grupo): readonly (readonly [string, ClaveAccionDePlataforma])[] {
  return Object.entries(grupo.declaraciones).flatMap(([nombre, declaracion]) =>
    "accion" in declaracion ? [[nombre, declaracion.accion] as const] : [],
  );
}

/** Qué acción del catálogo exige cada caso y cada consulta que la consola ofrece. Las pruebas lo recorren entero. */
export const ACCIONES_DE_LA_CONSOLA: Readonly<
  Record<"casos" | "consultas", Readonly<Record<string, ClaveAccionDePlataforma>>>
> = Object.freeze({
  casos: Object.freeze(
    Object.fromEntries(GRUPOS.filter((g) => g.clase === "casos").flatMap(conAccion)),
  ),
  consultas: Object.freeze(
    Object.fromEntries(GRUPOS.filter((g) => g.clase === "consultas").flatMap(conAccion)),
  ),
});

/** El acceso de UN pedido: lo que el administrador es y lo que puede ejecutar. No se guarda entre pedidos. */
export type AccesoDeConsola = Readonly<{
  admin: AccesoDeSesionDePlataforma["admin"];
  /** Lo que le queda a la ventana de 5 minutos del segundo factor, o 0 (para que la pantalla pida el código antes). */
  segundoFactorRecienteHastaMs: number;
  casos: CasosDeConsola;
  consultas: ConsultasDeConsola;
}>;

export type OpcionesDeLaPuertaDeConsola = OpcionesDePlataforma &
  Readonly<{
    /** El host de la consola: una sesión que nació en otro no entra. Lo decide la app (su dominio), no una variable de acá. */
    hostDeLaConsola: string;
    /** Solo para las pruebas: el reloj. */
    reloj?: () => Date;
  }>;

export type PuertaDeConsola = Readonly<{
  /**
   * El acceso de este pedido, o el código público por el que no se lo da (`sesion_vencida`, `no_habilitado`,
   * `segundo_factor_requerido`, `segundo_factor_a_enrolar`). `sesion` es lo que devolvió `sesionDe(pedido, host)` de la
   * autenticación de la consola; `null` es «sin sesión». Nunca lanza por una sesión que no vale.
   */
  conSesion(
    sesion: SesionAutenticada | null,
  ): Promise<Resultado<AccesoDeConsola, CodigoDePlataforma>>;
  /** Cierra las conexiones que se hayan abierto. */
  cerrar(): Promise<void>;
}>;

/** Lo que la puerta usa de la puerta de plataforma sin sesión: se inyecta en las pruebas. */
export type PlataformaParaLaConsola = Pick<
  Plataforma,
  | "buscarAdmin"
  | "casosDeUsoDeAltas"
  | "casosDeUsoDeDominios"
  | "casosDeUsoDeMarcasYPlanes"
  | "casosDeUsoDeSoporte"
  | "consultasDePlataforma"
  | "consultasDeMarcasYPlanes"
  | "cerrar"
>;

export function armarPuertaDeConsola(opciones: OpcionesDeLaPuertaDeConsola): PuertaDeConsola {
  return crearPuertaDeConsola(armarPlataforma(opciones), opciones);
}

/** Lo mismo sobre una puerta de plataforma ya armada (las pruebas le ponen una de mentira). */
export function crearPuertaDeConsola(
  plataforma: PlataformaParaLaConsola,
  opciones: Pick<OpcionesDeLaPuertaDeConsola, "hostDeLaConsola" | "reloj" | "registrar">,
): PuertaDeConsola {
  const contextoDeLaSesion = crearContextoDePlataformaDeLaSesion({
    hostDeLaConsola: opciones.hostDeLaConsola,
    buscarAdmin: plataforma.buscarAdmin,
    reloj: opciones.reloj ?? (() => new Date()),
    registrar: opciones.registrar,
  });

  return {
    async conSesion(sesion) {
      const dada = await contextoDeLaSesion(sesion);
      if (!dada.ok) return dada;
      const { contexto, segundoFactorEn, ahora } = dada.valor;

      /** Cada nombre se vuelve una función sin contexto que primero comprueba el segundo factor reciente de su acción. */
      const ofrecer = (clase: Grupo["clase"]) =>
        Object.fromEntries(
          GRUPOS.filter((g) => g.clase === clase).flatMap((grupo) =>
            conAccion(grupo).map(([nombre, accion]) => {
              const llamar = async (...argumentos: never[]) => {
                const reciente = decidirSegundoFactorRecienteDeLaAccion(
                  accion,
                  segundoFactorEn,
                  ahora,
                );
                if (!reciente.ok) return reciente;
                return (grupo.armar(plataforma)[nombre] as Funcion)(contexto, ...argumentos);
              };
              return [nombre, llamar] as const;
            }),
          ),
        );

      return ok({
        admin: dada.valor.admin,
        segundoFactorRecienteHastaMs: dada.valor.segundoFactorRecienteHastaMs,
        casos: ofrecer("casos") as unknown as CasosDeConsola,
        consultas: ofrecer("consultas") as unknown as ConsultasDeConsola,
      });
    },
    cerrar: () => plataforma.cerrar(),
  };
}
