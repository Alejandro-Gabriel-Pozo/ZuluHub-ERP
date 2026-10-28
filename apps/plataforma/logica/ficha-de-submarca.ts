/**
 * De la ficha del backend (`FichaDeMarca`) a la ficha mínima y serializable que recibe la pantalla de Submarca.
 * Puro: sin Next ni React. No lleva ids internos de más ni fechas: solo lo que la pantalla pinta.
 */
import type {
  DefinicionEfectivaDeMarca,
  FichaDeMarca,
  VistaDeCatalogosDeMarca,
} from "../../../src/plataforma/consultas/contrato-de-marcas-y-planes";
import type { CatalogoDeContraste, ResultadoDeContraste } from "./contraste-de-submarca";
import { errorParaLaPantalla, type ErrorParaLaPantalla } from "./errores-de-plataforma";
import { ASPECTO_POR_DEFECTO, SIN_PROPIOS, type FormularioDeSubmarca } from "./submarca";

export type FichaDeSubmarca = Readonly<{
  id: string;
  codigo: string;
  nombre: string;
  estado: string;
  versionVigente: number | null;
  /** El número que tendrá la versión que nace al confirmar: la mayor confirmada más uno (NO es la `version` del borrador). */
  numeroDeLaVersionNueva: number;
  borrador: { version: number } | null;
  hayProgramada: boolean;
  /** Lo que se edita: el borrador efectivo; si no hay, lo que rige; si tampoco, vacío con el aspecto por defecto. */
  formulario: FormularioDeSubmarca;
  formularioDeLaVigente: FormularioDeSubmarca | null;
  puedeConfirmarse: { ok: true } | { ok: false; error: ErrorParaLaPantalla };
  /** La razón va sin redondear; `texto` queda en `null` y la pantalla lo calcula con `evaluarContraste`. */
  contrasteDelBorrador: ResultadoDeContraste[] | null;
  catalogo: CatalogoDeContraste;
}>;

const esPropio = (campo: { origen: { tipo: string } }): boolean => campo.origen.tipo === "propio";

function formularioDe(definicion: DefinicionEfectivaDeMarca): FormularioDeSubmarca {
  const { tema, aspecto } = definicion;
  return {
    nombreVisible: definicion.nombreVisible.valor ?? "",
    colores: {
      primary: definicion.tema["primary"].valor ?? "",
      onPrimary: definicion.tema["on-primary"].valor ?? "",
      secondary: definicion.tema["secondary"].valor ?? "",
      accent: definicion.tema["accent"].valor ?? "",
    },
    aspecto: {
      estilo: definicion.aspecto.estilo.valor,
      superficie: definicion.aspecto.superficie.valor,
      esquinas: definicion.aspecto.esquinas.valor,
      titulos: definicion.aspecto.titulos.valor,
      ingreso: definicion.aspecto.ingreso.valor,
    },
    propio: {
      colores: {
        primary: esPropio(tema["primary"]),
        onPrimary: esPropio(tema["on-primary"]),
        secondary: esPropio(tema["secondary"]),
        accent: esPropio(tema["accent"]),
      },
      aspecto: {
        estilo: esPropio(aspecto.estilo),
        superficie: esPropio(aspecto.superficie),
        esquinas: esPropio(aspecto.esquinas),
        titulos: esPropio(aspecto.titulos),
        ingreso: esPropio(aspecto.ingreso),
      },
    },
  } as FormularioDeSubmarca;
}

const FORMULARIO_VACIO: FormularioDeSubmarca = {
  nombreVisible: "",
  colores: { primary: "", onPrimary: "", secondary: "", accent: "" },
  aspecto: ASPECTO_POR_DEFECTO,
  propio: SIN_PROPIOS,
};

export function armarFichaDeSubmarca(
  ficha: FichaDeMarca,
  catalogos: VistaDeCatalogosDeMarca,
): FichaDeSubmarca {
  const vigente = ficha.efectiva === null ? null : formularioDe(ficha.efectiva);
  const delBorrador = ficha.borradorEfectivo === null ? null : formularioDe(ficha.borradorEfectivo);
  return {
    id: ficha.marca.id,
    codigo: ficha.marca.codigo,
    nombre: ficha.efectiva?.nombreVisible.valor ?? ficha.marca.codigo,
    estado: ficha.marca.estado,
    versionVigente: ficha.versiones.find((v) => v.estado === "VIGENTE")?.numero ?? null,
    numeroDeLaVersionNueva: Math.max(0, ...ficha.versiones.map((v) => v.numero)) + 1,
    borrador: ficha.borrador === null ? null : { version: ficha.borrador.version },
    hayProgramada: ficha.versiones.some((v) => v.estado === "PROGRAMADA"),
    formulario: delBorrador ?? vigente ?? FORMULARIO_VACIO,
    formularioDeLaVigente: vigente,
    puedeConfirmarse: ficha.puedeConfirmarse.ok
      ? { ok: true }
      : { ok: false, error: errorParaLaPantalla(ficha.puedeConfirmarse.error, "SUBMARCA") },
    contrasteDelBorrador:
      ficha.contraste === null
        ? null
        : ficha.contraste.map((c) => ({
            par: c.par,
            razon: c.razon,
            minimo: c.minimo,
            cumple: c.cumple,
            texto: null,
          })),
    catalogo: {
      superficies: catalogos.superficies.map((s) => ({
        valor: s.valor,
        fondo: s.fondo,
        superficie: s.superficie,
      })),
      pares: catalogos.tema.pares.map((p) => ({ par: p.par, minimo: p.minimo })),
    },
  };
}
