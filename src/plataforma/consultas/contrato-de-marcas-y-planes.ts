import type { ReglasDePlataforma } from "../../capacidades/permisos/plataforma";
import type { ClaveDeTexto } from "../../capacidades/vocabulario/catalogo";
import type {
  ContrasteDeUnPar,
  DefinicionDeMarca,
  DominioGuardado,
  EstadoDeVigencia,
  ErrorDeConfirmacion,
  MarcaGuardada,
  TokenDeAspecto,
  TokenDeTema,
} from "../../modulos/marcas/publico";
import type { EstadoDePlan } from "../../modulos/planes/publico";
import type {
  MarcaComercialId,
  PlanId,
  VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import type { Transacciones } from "../../puertos/transacciones";
import type {
  CatalogoDeModulosParaPlanes,
  CatalogoDePerillasParaPlanes,
  ErrorPlano,
  TxDeMarcasYPlanes,
} from "../casos-de-uso/marcas-y-planes-comun";

/**
 * Lo que una consulta de plataforma sobre marcas y planes recibe de su transacción (M5): el guard y los
 * repositorios, para LEER. Es un recorte de lo que recibe un caso de uso (`TxDeMarcasYPlanes`): la misma
 * transacción armada por la composición les sirve a ambos, pero una consulta no puede escribir, auditar ni
 * tocar claves de idempotencia (no las tiene en el tipo).
 */
export type TxDeConsultasDeMarcasYPlanes = Pick<
  TxDeMarcasYPlanes,
  "autorizacionDePlataforma" | "marcas" | "planes" | "derechos"
>;

export type DependenciasDeConsultasDeMarcasYPlanes = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeMarcasYPlanes>;
  /** El catálogo y la matriz de PLATAFORMA con los que se autoriza a quien consulta. */
  reglas: ReglasDePlataforma;
  catalogoDeModulos: CatalogoDeModulosParaPlanes;
  catalogoDePerillas: CatalogoDePerillasParaPlanes;
}>;

// --- fichaDeMarca ---------------------------------------------------------------------------------------

/** Una versión confirmada de la marca, con su estado calculado a hoy. */
export type VersionDeMarcaEnFicha = Readonly<{
  numero: number;
  estado: EstadoDeVigencia;
  vigenteDesde: Date;
  motivo: string;
  reemplazaProgramada: boolean;
  confirmadaEn: Date;
  confirmadaPor: string;
  /** Lo que la versión dice POR SÍ MISMA (un campo vacío hereda de la marca padre). */
  definicion: DefinicionDeMarca;
}>;

export type DominioEnFicha = Readonly<
  Pick<
    DominioGuardado,
    "id" | "host" | "superficie" | "titular" | "estado" | "esCanonico" | "verificadoEn" | "motivo"
  >
>;

/**
 * De dónde sale un campo de la definición efectiva:
 *  - `propio`: lo dice la propia definición;
 *  - `heredado`: lo trae el ancestro `marcaId` (`marcaCodigo`): el padre y, si éste tampoco lo define, el abuelo;
 *  - `defecto`: nadie en la cadena lo define; rige el valor por defecto (el aspecto) o el campo queda sin
 *    definir (`valor: null`: el nombre, el logo, un color, los módulos iniciales, el plan por defecto).
 */
export type OrigenDeCampo =
  | Readonly<{ tipo: "propio" }>
  | Readonly<{ tipo: "heredado"; marcaId: MarcaComercialId; marcaCodigo: string }>
  | Readonly<{ tipo: "defecto" }>;

/** Un campo con el valor que rige y de dónde sale. */
export type CampoEfectivo<T> = Readonly<{ valor: T; origen: OrigenDeCampo }>;

/** El plan por defecto resuelto: el plan y su última versión publicada (la que recibe un tenant nuevo). */
export type PlanPorDefectoEfectivo = Readonly<{
  planId: PlanId;
  codigo: string;
  estado: EstadoDePlan;
  /** `null` si el plan todavía no publicó ninguna versión (no se le puede asignar a nadie). */
  ultimaVersion: Readonly<{
    versionDePlanId: VersionDePlanId;
    numero: number;
    nombreComercial: string;
  }> | null;
}>;

/** Un texto del vocabulario que algún eslabón reemplaza (con un reemplazo válido); los demás rigen por defecto (`catalogosDeMarca`). */
export type TextoEfectivo = Readonly<{
  /** La clave del texto en el catálogo (`CATALOGO_DE_TEXTOS`). */
  texto: ClaveDeTexto;
  /** El reemplazo que rige, ya validado y en su forma canónica. */
  valor: string;
  origen: OrigenDeCampo;
}>;

/**
 * La definición RESUELTA con la herencia (`resolverDefinicion`: marca, padre, abuelo), campo por campo con su
 * origen. El aspecto sale completo (los tokens que nadie define toman `ASPECTO_POR_DEFECTO`, con origen
 * `defecto`).
 */
export type DefinicionEfectivaDeMarca = Readonly<{
  nombreVisible: CampoEfectivo<string | null>;
  tema: Readonly<Record<TokenDeTema, CampoEfectivo<string | null>>>;
  aspecto: Readonly<Record<TokenDeAspecto, CampoEfectivo<string>>>;
  logo: CampoEfectivo<string | null>;
  vocabulario: readonly TextoEfectivo[];
  modulosIniciales: CampoEfectivo<readonly string[] | null>;
  planPorDefecto: CampoEfectivo<PlanPorDefectoEfectivo | null>;
}>;

/**
 * Lo que daría confirmar el borrador ahora, sin escribir nada: `{ ok: true }` o el error EXACTO de
 * `confirmarVersionDeMarca` (misma forma: un texto si no trae datos, un objeto `{ codigo, ... }` si los trae).
 * Se evalúa con motivo no vacío, vigencia desde ahora y reemplazando lo programado: NO mira
 * `MOTIVO_OBLIGATORIO`, `VIGENCIA_RETROACTIVA` ni `CAMBIO_PROGRAMADO_PENDIENTE`, que dependen de lo que se
 * escriba en el formulario de confirmación (la ficha ya dice qué versión está programada). Sí mira todo lo demás,
 * en el orden de la confirmación: `SIN_BORRADOR`, `DEFINICION_INCOMPLETA`, `ASPECTO_INVALIDO`,
 * `CONTRASTE_INSUFICIENTE`, `MODULO_INICIAL_FUERA_DEL_PLAN` y `PLAN_POR_DEFECTO_RETIRADO`.
 */
export type PuedeConfirmarse =
  Readonly<{ ok: true }> | Readonly<{ ok: false; error: ErrorPlano<ErrorDeConfirmacion> }>;

export type FichaDeMarca = Readonly<{
  marca: MarcaGuardada;
  /** El padre y el abuelo, en ese orden (vacía si no tiene padre). */
  cadena: readonly MarcaGuardada[];
  /** Las versiones confirmadas, por número ascendente. */
  versiones: readonly VersionDeMarcaEnFicha[];
  /** El borrador, con la `version` que va en `versionEsperada` de la próxima edición; `null` si no hay. */
  borrador: Readonly<{
    id: string;
    version: number;
    definicion: DefinicionDeMarca;
  }> | null;
  dominios: readonly DominioEnFicha[];
  /** Los textos del vocabulario (del borrador y de las versiones) que el catálogo del código ya no tiene: se ignoran al pintar. */
  clavesDeTextoHuerfanas: readonly string[];
  /**
   * Lo que rige hoy: la definición de la versión vigente resuelta con las versiones VIGENTES del padre y del
   * abuelo, con el origen de cada campo; `null` si la marca todavía no tiene versión vigente.
   */
  efectiva: DefinicionEfectivaDeMarca | null;
  /** Lo mismo para el borrador, resuelto contra las versiones vigentes de los ancestros; `null` si no hay borrador. */
  borradorEfectivo: DefinicionEfectivaDeMarca | null;
  puedeConfirmarse: PuedeConfirmarse;
  /**
   * Los tres pares de colores que se miden al confirmar, del borrador efectivo contra la superficie que
   * resuelve su aspecto; `null` si no hay borrador. Un par al que le falta un color sale sin medir
   * (`razon` y `cumple` nulos). `razon` va sin redondear: 4,499 no cumple 4,5.
   */
  contraste: readonly ContrasteDeUnPar[] | null;
}>;

export type EntradaDeFichaDeMarca = Readonly<{ marcaId: string }>;
