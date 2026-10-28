import type { ReglasDePlataforma } from "../../capacidades/permisos/plataforma";
import type { ClaveDeTexto } from "../../capacidades/vocabulario/catalogo";
import type { EstadoDeTenant } from "../../contexto/estados";
import type {
  ContrasteDeUnPar,
  DefinicionDeMarca,
  DominioGuardado,
  ErrorDeConfirmacion,
  EstadoDeVigencia,
  LecturaDeMarcaParaElAlta,
  MarcaGuardada,
  ParDeContraste,
  SuperficieDeAspecto,
  TokenDeAspecto,
  TokenDeTema,
} from "../../modulos/marcas/publico";
import type {
  EstadoDePlan,
  LecturaDeVersionesDePlanParaElAlta,
} from "../../modulos/planes/publico";
import type {
  MarcaComercialId,
  PlanId,
  TenantId,
  VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import type { Transacciones } from "../../puertos/transacciones";
import type {
  CatalogoDeModulosParaPlanes,
  CatalogoDePerillasParaPlanes,
  ErrorPlano,
  TxDeMarcasYPlanes,
} from "../casos-de-uso/marcas-y-planes-comun";
import type { ErrorDeMarcaDelAlta } from "../dominio/alta-con-marca";
import type { EntradaDePagina } from "../dominio/soporte/consulta";

/**
 * Lo que una consulta de plataforma sobre marcas y planes recibe de su transacción (M5): el guard y los
 * repositorios, para LEER. Es un recorte de lo que recibe un caso de uso (`TxDeMarcasYPlanes`): la misma
 * transacción armada por la composición les sirve a ambos, pero una consulta no puede escribir, auditar ni
 * tocar claves de idempotencia (no las tiene en el tipo).
 */
export type TxDeConsultasDeMarcasYPlanes = Pick<
  TxDeMarcasYPlanes,
  "autorizacionDePlataforma" | "marcas" | "planes" | "derechos"
> &
  Readonly<{
    /**
     * Lo que el alta de una empresa lee de una marca (M6), para que `marcasParaElAlta` decida con LA MISMA
     * lectura que el alta. Se llama `marcaParaElAlta` y no `marcas` porque `marcas` ya es el repositorio.
     */
    marcaParaElAlta: LecturaDeMarcaParaElAlta;
    /** Las versiones de plan que el alta resuelve (la elegida o la última publicada del plan por defecto). */
    versionesDePlan: LecturaDeVersionesDePlanParaElAlta;
  }>;

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

/**
 * La última decisión de la marca: la versión confirmada de MAYOR `numero`, rija ya o esté programada a futuro
 * (con una programada, NO es la vigente). Es la definición de la que parte el primer borrador al guardar
 * (`guardarBorradorDeMarca`), calculada con la misma función (`definicionDeLaUltimaDecision`).
 */
export type UltimaConfirmadaEnFicha = Readonly<{
  numero: number;
  vigenteDesde: Date;
  /** Lo que la versión dice POR SÍ MISMA (un campo vacío hereda): es lo que el primer borrador copia tal cual. */
  definicion: DefinicionDeMarca;
  /** La misma definición resuelta con la herencia de HOY, con el origen de cada campo (como `efectiva`). */
  efectiva: DefinicionEfectivaDeMarca;
}>;

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
  /**
   * La última versión confirmada (mayor `numero`, regida o programada); `null` si la marca no tiene ninguna.
   * Sin borrador, el formulario de edición tiene que armarse desde ESTA y no desde `efectiva`: con un cambio
   * programado, `efectiva` es la vigente y el primer borrador parte de la programada.
   */
  ultimaConfirmada: UltimaConfirmadaEnFicha | null;
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

// --- marcasParaElAlta -----------------------------------------------------------------------------------

/** Por qué una marca no sirve para dar de alta una empresa con tenant nuevo: los errores de marca del alta y la falta de plan por defecto. */
export type MotivoDeMarcaNoElegible = ErrorDeMarcaDelAlta | "MARCA_SIN_PLAN_POR_DEFECTO";

/** El plan por defecto de una marca que el alta asignaría a un tenant nuevo: la última versión publicada de su plan por defecto. */
export type PlanPorDefectoDelAlta = Readonly<{
  planId: PlanId;
  codigo: string;
  versionDePlanId: VersionDePlanId;
  numero: number;
  nombreComercial: string;
}>;

export type MarcaParaElAlta = Readonly<{
  marcaId: MarcaComercialId;
  codigo: string;
  /** El nombre visible de la PROPIA marca (su versión vigente); `null` si todavía no tiene. */
  nombre: string | null;
  /**
   * `true`: el alta de una empresa con TENANT NUEVO por esta marca y SIN elegir versión de plan sería aceptada
   * en lo que toca a la marca y al plan (los demás errores del alta dependen de los datos de la empresa: CUIT,
   * email, etc.). Es la decisión del propio alta, no una copia.
   */
  elegible: boolean;
  /** El primer motivo por el que no es elegible, en el orden en que el alta los decide; `null` si lo es. */
  motivoSiNo: MotivoDeMarcaNoElegible | null;
  /** `null` si la marca no tiene un plan por defecto utilizable (sin plan, sin versión publicada o plan retirado). */
  planPorDefecto: PlanPorDefectoDelAlta | null;
  /** Los módulos que la marca propone al nacer una empresa, con la herencia aplicada (`[]`: solo administración; también si la marca no es elegible). */
  modulosIniciales: readonly string[];
}>;

export type VistaDeMarcasParaElAlta = Readonly<{
  /** Todas las marcas (también las retiradas, para mostrarlas deshabilitadas), por código. */
  marcas: readonly MarcaParaElAlta[];
}>;

// --- catalogosDeMarca --------------------------------------------------------------

/** Una lista cerrada del aspecto: el token, sus valores posibles y el que rige si nadie define el token. */
export type ListaDeAspecto = Readonly<{
  token: TokenDeAspecto;
  valores: readonly string[];
  porDefecto: string;
}>;

/** Los colores de una superficie del aspecto: `fondo` es el de la página y `superficie` el de las tarjetas y paneles. */
export type ColoresDeSuperficie = Readonly<{
  valor: SuperficieDeAspecto;
  fondo: string;
  superficie: string;
}>;

/** Un texto del vocabulario que la marca puede reemplazar. */
export type TextoDelCatalogo = Readonly<{
  texto: ClaveDeTexto;
  porDefecto: string;
  /** Hasta cuántos caracteres puede tener un reemplazo. */
  largoMaximo: number;
  /** Los marcadores (sin llaves) que el reemplazo debe traer, ni más ni menos. */
  marcadores: readonly string[];
}>;

/**
 * Con qué se arma el editor de una marca, tal como lo valida el guardado del borrador: los tokens del
 * tema y su formato, las listas cerradas del aspecto, las superficies con sus colores y el catálogo de textos
 * del vocabulario. Son constantes del código: no se lee ninguna tabla.
 */
export type VistaDeCatalogosDeMarca = Readonly<{
  tema: Readonly<{
    tokens: readonly TokenDeTema[];
    /** Cómo se escribe un color: seis dígitos hexadecimales en minúsculas con numeral. */
    formato: "#rrggbb";
    /** El mismo formato como expresión regular (`RegExp.source`). */
    patron: string;
    /** Los pares de colores que se miden al confirmar y lo mínimo que se les exige. */
    pares: readonly Readonly<{ par: ParDeContraste; minimo: number }>[];
  }>;
  aspecto: readonly ListaDeAspecto[];
  superficies: readonly ColoresDeSuperficie[];
  vocabulario: readonly TextoDelCatalogo[];
}>;

// --- tenantsConLaVersion --------------------------------------------------------------------------------

export type EntradaDeTenantsConLaVersion = EntradaDePagina &
  Readonly<{
    /** La versión de plan (su id) cuyos tenants se piden. */
    versionDePlanId: string;
  }>;

/**
 * Un tenant cuya asignación VIGENTE es la versión pedida. Es una fila lista para armar el lote de
 * `migrarTenantsDeVersion`: `{ tenantId, numeroEsperado: ultimoNumeroDeAsignacion }`.
 */
export type TenantConLaVersion = Readonly<{
  tenantId: TenantId;
  nombre: string;
  estado: EstadoDeTenant;
  marcaId: MarcaComercialId;
  marcaCodigo: string;
  /**
   * El MAYOR número de asignación del tenant, el de la última decisión que se tomó sobre su plan (aunque esté
   * programada): es lo que `asignarPlan` y `migrarTenantsDeVersion` piden como `numeroEsperado` (la última
   * asignación que viste).
   */
  ultimoNumeroDeAsignacion: number;
  /** Hay una asignación que va a regir más adelante y que nada deja sin efecto: migrar exige decir `reemplazaProgramada`. */
  hayProgramada: boolean;
  /** Las empresas del tenant que no están canceladas. */
  empresas: number;
}>;
