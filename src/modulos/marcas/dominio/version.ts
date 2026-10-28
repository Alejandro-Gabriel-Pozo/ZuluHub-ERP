import type { DefinicionDeModulo } from "../../../capacidades/modulos/catalogo";
import {
  validarVocabulario,
  type ErrorDeVocabulario,
  type Vocabulario,
} from "../../../capacidades/vocabulario/vocabulario";
import type { PlanId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { completarAspecto, validarAspecto, type Aspecto, type ErrorDeAspecto } from "./aspecto";
import {
  DEFINICION_VACIA,
  completarDefinicion,
  resolverDefinicion,
  validarLogo,
  validarModulosIniciales,
  validarNombreVisible,
  type CampoFaltante,
  type DefinicionCompleta,
  type DefinicionDeMarca,
  type ErrorDeModuloInicial,
} from "./definicion";
import {
  parDeContrasteInsuficiente,
  validarTema,
  type ErrorDeTema,
  type ParDeContraste,
  type Tema,
} from "./tema";
import {
  TOLERANCIA_DE_RELOJ_EN_MS,
  hayProgramadaPendiente,
  type VersionConVigencia,
} from "./vigencia";

/**
 * Versión de marca: `BORRADOR` → `CONFIRMADA` (marcas y planes, §B.3 y G.1). Hay a lo sumo UN borrador
 * por marca; al confirmarse queda congelado para siempre (otra versión lo corrige) y su número lo da la
 * base (máximo + 1). Todo lo de acá es puro: el caso de uso lee, llama a estas funciones dentro de la
 * transacción y escribe.
 */

// --- Guardar el borrador -------------------------------------------------------------------------------

/**
 * Lo que el pedido de guardar trae, tal cual llega. Un campo AUSENTE (`undefined`) no se toca; un campo
 * `null` se vacía (vuelve a heredar); uno con valor reemplaza al anterior ENTERO (el tema, el aspecto y el
 * vocabulario se reemplazan completos, no se mezclan).
 */
export type CambiosDeBorrador = Readonly<{
  nombreVisible?: string | null;
  tema?: Readonly<Record<string, unknown>>;
  aspecto?: Readonly<Record<string, unknown>>;
  logo?: string | null;
  vocabulario?: Vocabulario;
  modulosIniciales?: readonly string[] | null;
  planPorDefectoId?: PlanId | null;
}>;

/** Los mismos cambios ya validados y en forma canónica (texto recortado y en NFC, sin módulos repetidos). */
export type CambiosValidadosDeBorrador = Readonly<{
  nombreVisible?: string | null;
  tema?: Tema;
  aspecto?: Aspecto;
  logo?: string | null;
  vocabulario?: Vocabulario;
  modulosIniciales?: readonly string[] | null;
  planPorDefectoId?: PlanId | null;
}>;

export type ErrorDeFormaDeBorrador =
  | "NOMBRE_DE_MARCA_INVALIDO"
  | "LOGO_INVALIDO"
  | ErrorDeTema
  | ErrorDeAspecto
  | ErrorDeVocabulario
  | ErrorDeModuloInicial;

/**
 * La validación de FORMA del borrador, que se hace antes de abrir la transacción (§B.11). El primer
 * problema, en este orden: nombre, tema, aspecto, logo, vocabulario, módulos iniciales. Que el plan exista lo ve
 * el caso de uso contra la base. `catalogoDeModulos` es el de módulos del sistema.
 */
export function validarCambiosDeBorrador(
  cambios: CambiosDeBorrador,
  catalogoDeModulos: Readonly<Record<string, Pick<DefinicionDeModulo, "estado" | "obligatorio">>>,
): Resultado<CambiosValidadosDeBorrador, ErrorDeFormaDeBorrador> {
  const validados: {
    -readonly [C in keyof CambiosValidadosDeBorrador]: CambiosValidadosDeBorrador[C];
  } = {};

  if (cambios.nombreVisible !== undefined) {
    if (cambios.nombreVisible === null) validados.nombreVisible = null;
    else {
      const nombre = validarNombreVisible(cambios.nombreVisible);
      if (!nombre.ok) return nombre;
      validados.nombreVisible = nombre.valor;
    }
  }
  if (cambios.tema !== undefined) {
    const tema = validarTema(cambios.tema);
    if (!tema.ok) return tema;
    validados.tema = tema.valor;
  }
  if (cambios.aspecto !== undefined) {
    const aspecto = validarAspecto(cambios.aspecto);
    if (!aspecto.ok) return aspecto;
    validados.aspecto = aspecto.valor;
  }
  if (cambios.logo !== undefined) {
    if (cambios.logo === null) validados.logo = null;
    else {
      const logo = validarLogo(cambios.logo);
      if (!logo.ok) return logo;
      validados.logo = logo.valor;
    }
  }
  if (cambios.vocabulario !== undefined) {
    const vocabulario = validarVocabulario(cambios.vocabulario);
    if (!vocabulario.ok) return vocabulario;
    validados.vocabulario = vocabulario.valor;
  }
  if (cambios.modulosIniciales !== undefined) {
    if (cambios.modulosIniciales === null) validados.modulosIniciales = null;
    else {
      const modulos = validarModulosIniciales(catalogoDeModulos, cambios.modulosIniciales);
      if (!modulos.ok) return modulos;
      validados.modulosIniciales = modulos.valor;
    }
  }
  if (cambios.planPorDefectoId !== undefined) validados.planPorDefectoId = cambios.planPorDefectoId;
  return ok(validados);
}

/** El borrador que ya existe: su definición y la `version` (el candado optimista de la fila). */
export type BorradorGuardado = Readonly<{ definicion: DefinicionDeMarca; version: number }>;

export type DecisionDeBorrador = Readonly<{
  definicion: DefinicionDeMarca;
  /** `true`: no había borrador y hay que crearlo; `false`: se actualiza el que había. */
  esNuevo: boolean;
}>;

/**
 * La definición de la ÚLTIMA decisión de la marca: la de la versión confirmada de MAYOR `numero`, regida o
 * programada a futuro (la última decisión manda, §B.5.6; el número manda sobre la fecha). `null` si la marca
 * no tiene ninguna confirmada. Es la base del primer borrador (`decidirGuardadoDeBorrador`). No depende del
 * orden en que vengan las versiones.
 */
export function definicionDeLaUltimaDecision(
  confirmadas: readonly Readonly<{ numero: number; definicion: DefinicionDeMarca }>[],
): DefinicionDeMarca | null {
  let ultima: (typeof confirmadas)[number] | null = null;
  for (const version of confirmadas) {
    if (ultima === null || version.numero > ultima.numero) ultima = version;
  }
  return ultima === null ? null : ultima.definicion;
}

/**
 * Aplica los cambios al borrador. Si ya hay uno, parte de él. Si NO hay, el primer borrador parte de la
 * definición de la ÚLTIMA versión confirmada de la marca (`baseDeLaUltimaConfirmada`: la de mayor `numero`,
 * aunque esté programada a futuro, porque la última decisión manda) y no de una definición vacía; sin
 * ninguna confirmada (`null`) parte de `DEFINICION_VACIA`. Previene que cambiar un solo color deje un
 * borrador con solo el tema: lo que la persona ve vigente es lo que se guarda, y confirmar no pierde el resto.
 *
 * `baseDeLaUltimaConfirmada` se ignora cuando ya hay borrador (el borrador manda sobre lo confirmado).
 * Un primer borrador sin cambios, o con cambios iguales a lo confirmado, se crea igual: devuelve la `version`
 * que la persona necesita para seguir editando, y confirmarlo sigue exigiendo motivo y decisión explícita.
 *
 * `versionEsperada` es lo que el cliente vio: `null` = «no había borrador», un número = la `version` del
 * borrador que miró. Si no coincide con lo que hay ahora, `VERSION_DESACTUALIZADA` y no se pierde el
 * trabajo de nadie (dos personas editando).
 */
export function decidirGuardadoDeBorrador(
  existente: BorradorGuardado | null,
  baseDeLaUltimaConfirmada: DefinicionDeMarca | null,
  versionEsperada: number | null,
  cambios: CambiosValidadosDeBorrador,
): Resultado<DecisionDeBorrador, "VERSION_DESACTUALIZADA"> {
  if ((existente === null ? null : existente.version) !== versionEsperada) {
    return err("VERSION_DESACTUALIZADA");
  }
  const base =
    existente !== null
      ? existente.definicion
      : baseDeLaUltimaConfirmada === null
        ? DEFINICION_VACIA
        : baseDeLaUltimaConfirmada;
  return ok({
    esNuevo: existente === null,
    definicion: {
      nombreVisible:
        cambios.nombreVisible === undefined ? base.nombreVisible : cambios.nombreVisible,
      tema: cambios.tema === undefined ? base.tema : cambios.tema,
      aspecto: cambios.aspecto === undefined ? base.aspecto : cambios.aspecto,
      logo: cambios.logo === undefined ? base.logo : cambios.logo,
      vocabulario: cambios.vocabulario === undefined ? base.vocabulario : cambios.vocabulario,
      modulosIniciales:
        cambios.modulosIniciales === undefined ? base.modulosIniciales : cambios.modulosIniciales,
      planPorDefectoId:
        cambios.planPorDefectoId === undefined ? base.planPorDefectoId : cambios.planPorDefectoId,
    },
  });
}

// --- Confirmar la versión ------------------------------------------------------------------------------

/** El plan por defecto al que apunta la definición resuelta, con lo que la confirmación necesita de él. */
export type PlanPorDefecto = Readonly<{
  id: PlanId;
  retirado: boolean;
  /** Los módulos incluidos (el techo) de su versión publicada. */
  modulos: readonly string[];
}>;

export type PedidoDeConfirmacion = Readonly<{
  vigenteDesde: Date;
  motivo: string;
  reemplazaProgramada: boolean;
}>;

export type ErrorDeConfirmacion =
  | Readonly<{ codigo: "SIN_BORRADOR" }>
  | Readonly<{ codigo: "MOTIVO_OBLIGATORIO" }>
  | Readonly<{ codigo: "VIGENCIA_RETROACTIVA" }>
  | Readonly<{ codigo: "CAMBIO_PROGRAMADO_PENDIENTE" }>
  | Readonly<{ codigo: "DEFINICION_INCOMPLETA"; faltan: readonly CampoFaltante[] }>
  | ErrorDeAspecto
  | Readonly<{ codigo: "CONTRASTE_INSUFICIENTE"; par: ParDeContraste }>
  | Readonly<{ codigo: "MODULO_INICIAL_FUERA_DEL_PLAN"; modulo: string }>
  | Readonly<{ codigo: "PLAN_POR_DEFECTO_RETIRADO" }>;

export type ConfirmacionDeMarca = Readonly<{
  motivo: string;
  vigenteDesde: Date;
  /** La definición RESUELTA con herencia y completa: la que la marca va a mostrar. */
  definicion: DefinicionCompleta;
}>;

/**
 * Decide si el borrador de una marca se puede confirmar (§B.3). El primer problema, en el orden de la
 * especificación (§B.11):
 *  1. hay borrador; 2. motivo no vacío; 3. la vigencia no es retroactiva (con un minuto de tolerancia
 *  de reloj, como la base; una fecha inválida cuenta como retroactiva); 4. si hay una versión
 *  programada pendiente, hay que pedir reemplazarla; 5. la definición RESUELTA con la herencia está
 *  completa (el nombre lo define la propia marca); 6. el aspecto resuelto es válido (segunda barrera: la
 *  base y el guardado del borrador ya lo exigen; error `ASPECTO_INVALIDO { token }`); 7. el contraste del
 *  tema; 8. los módulos iniciales resueltos entran en los del plan por defecto resuelto; 9. ese plan no
 *  está retirado.
 *
 * `ancestros` son las definiciones VIGENTES del padre y del abuelo (en ese orden; `null` si no tienen
 * versión vigente). `versiones` son las ya confirmadas de ESTA marca. `planPorDefecto` es el plan al que
 * apunta la definición resuelta (el caso lo busca después de `resolverDefinicion`); si no es ese, es un
 * defecto del llamador y se lanza: validar contra otro plan daría un «sí» falso.
 */
export function decidirConfirmacionDeMarca(entrada: {
  borrador: DefinicionDeMarca | null;
  ancestros: readonly (DefinicionDeMarca | null)[];
  versiones: readonly VersionConVigencia[];
  planPorDefecto: PlanPorDefecto | null;
  pedido: PedidoDeConfirmacion;
  ahora: Date;
}): Resultado<ConfirmacionDeMarca, ErrorDeConfirmacion> {
  const { borrador, ancestros, versiones, planPorDefecto, pedido, ahora } = entrada;
  if (borrador === null) return err({ codigo: "SIN_BORRADOR" });
  const motivo = pedido.motivo.trim();
  if (motivo === "") return err({ codigo: "MOTIVO_OBLIGATORIO" });
  if (!(pedido.vigenteDesde.getTime() >= ahora.getTime() - TOLERANCIA_DE_RELOJ_EN_MS)) {
    return err({ codigo: "VIGENCIA_RETROACTIVA" });
  }
  if (!pedido.reemplazaProgramada && hayProgramadaPendiente(versiones, ahora)) {
    return err({ codigo: "CAMBIO_PROGRAMADO_PENDIENTE" });
  }
  const resuelta = resolverDefinicion([borrador, ...ancestros]);
  const completa = completarDefinicion(borrador, resuelta);
  if (!completa.ok) return err({ codigo: "DEFINICION_INCOMPLETA", faltan: completa.error });
  const aspecto = validarAspecto(resuelta.aspecto);
  if (!aspecto.ok) return aspecto;
  const definicion = completa.valor;

  const par = parDeContrasteInsuficiente(
    definicion.tema,
    completarAspecto(aspecto.valor).superficie,
  );
  if (par !== null) return err({ codigo: "CONTRASTE_INSUFICIENTE", par });

  if (planPorDefecto === null || planPorDefecto.id !== definicion.planPorDefectoId) {
    throw new RangeError("el plan por defecto recibido no es al que apunta la definición resuelta");
  }
  const techo = new Set(planPorDefecto.modulos);
  const fuera = definicion.modulosIniciales.find((modulo) => !techo.has(modulo));
  if (fuera !== undefined) return err({ codigo: "MODULO_INICIAL_FUERA_DEL_PLAN", modulo: fuera });
  if (planPorDefecto.retirado) return err({ codigo: "PLAN_POR_DEFECTO_RETIRADO" });

  return ok({ motivo, vigenteDesde: pedido.vigenteDesde, definicion });
}
