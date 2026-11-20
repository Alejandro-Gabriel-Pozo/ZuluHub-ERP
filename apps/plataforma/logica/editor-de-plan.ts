/**
 * La lógica del editor de un borrador de plan (pantalla «Planes» de la consola). Puro: sin Next ni React. Las reglas de integridad las decide el servidor (`validarVersionDePlan`); acá solo se
 * ayuda a armar el contenido: los módulos que otro pide se marcan solos, al quitar uno se quitan los que dependen de él, y se advierte (sin bloquear) lo que el plan deja inconsistente.
 */
import { CATALOGO_DE_MODULOS } from "../../../src/capacidades/modulos/catalogo";
import {
  diferenciaEntreVersiones,
  type ContenidoParaComparar,
} from "../../../src/capacidades/planes/diferencia";
import {
  CATALOGO_DE_PERILLAS,
  type DefinicionDePerilla,
} from "../../../src/capacidades/planes/perillas";
import { valorBaseDe, type ValorDePerilla } from "../../../src/capacidades/planes/valores";
import { rotuloDeModulo, rotuloDePerilla } from "./plan";
import { textoDePlanes } from "./textos-de-planes";

export type ContenidoDePlan = Readonly<{
  nombreComercial: string;
  modulos: readonly string[];
  perillas: Readonly<Record<string, ValorDePerilla>>;
}>;

type DefinicionDeModulo = (typeof CATALOGO_DE_MODULOS)[keyof typeof CATALOGO_DE_MODULOS];
const MODULOS = CATALOGO_DE_MODULOS as Readonly<Record<string, DefinicionDeModulo>>;
const PERILLAS: Readonly<Record<string, DefinicionDePerilla>> = CATALOGO_DE_PERILLAS;

/** Las claves del catálogo, en su orden. */
export const CLAVES_DE_MODULOS: readonly string[] = Object.keys(MODULOS);
export const CLAVES_DE_PERILLAS: readonly string[] = Object.keys(PERILLAS);

export type ModuloParaElegir = Readonly<{
  clave: string;
  rotulo: string;
  obligatorio: boolean;
  enDesarrollo: boolean;
  requiere: readonly string[];
}>;

export const modulosParaElegir = (): readonly ModuloParaElegir[] =>
  CLAVES_DE_MODULOS.map((clave) => {
    const d = MODULOS[clave] as DefinicionDeModulo;
    return {
      clave,
      rotulo: rotuloDeModulo(clave),
      obligatorio: d.obligatorio,
      enDesarrollo: d.estado === "en_desarrollo",
      requiere: d.requiere,
    };
  });

export type PerillaParaElegir = Readonly<{
  clave: string;
  rotulo: string;
  tipo: "INTERRUPTOR" | "LIMITE";
  modulo: string;
  requiere: string | null;
}>;

export const perillasParaElegir = (): readonly PerillaParaElegir[] =>
  CLAVES_DE_PERILLAS.map((clave) => {
    const d = PERILLAS[clave] as DefinicionDePerilla;
    return {
      clave,
      rotulo: rotuloDePerilla(clave),
      tipo: d.tipo,
      modulo: d.modulo,
      requiere: d.requiere ?? null,
    };
  });

/** Los módulos elegidos más los obligatorios y todo lo que se requiera, en orden de catálogo. */
export function conLoQueSePide(elegidos: readonly string[]): readonly string[] {
  const dentro = new Set(elegidos.filter((k) => Object.hasOwn(MODULOS, k)));
  for (const k of CLAVES_DE_MODULOS)
    if ((MODULOS[k] as DefinicionDeModulo).obligatorio) dentro.add(k);
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const k of [...dentro]) {
      for (const r of (MODULOS[k] as DefinicionDeModulo).requiere) {
        if (!dentro.has(r)) {
          dentro.add(r);
          cambio = true;
        }
      }
    }
  }
  return CLAVES_DE_MODULOS.filter((k) => dentro.has(k));
}

/**
 * Marca o desmarca un módulo (los obligatorios no cambian). Al marcarlo, los que requiere se muestran marcados solos (`conLoQueSePide`); al quitarlo, salen también los elegidos que dependen de él.
 */
export function conModulo(
  elegidos: readonly string[],
  clave: string,
  marcado: boolean,
): readonly string[] {
  const modulo = MODULOS[clave];
  if (modulo === undefined || !Object.hasOwn(MODULOS, clave) || modulo.obligatorio) return elegidos;
  if (marcado) return elegidos.includes(clave) ? elegidos : [...elegidos, clave];
  return elegidos.filter((k) => k !== clave && !conLoQueSePide([k]).includes(clave));
}

/** El valor de una perilla en el contenido: el que fija el plan o, si no, el de base. */
export function valorDe(
  perillas: Readonly<Record<string, ValorDePerilla>>,
  clave: string,
): ValorDePerilla {
  const fijado = Object.hasOwn(perillas, clave) ? perillas[clave] : undefined;
  return fijado ?? valorBaseDe(PERILLAS[clave] as DefinicionDePerilla);
}

/** Las perillas de interruptor encendidas cuyo módulo el plan no incluye: se advierte, no se bloquea (decisión del dueño, 19/11/2026). */
export function advertenciasDeLaVersion(contenido: ContenidoDePlan): readonly string[] {
  const incluidos = conLoQueSePide(contenido.modulos);
  return perillasParaElegir().flatMap((p) => {
    const v = valorDe(contenido.perillas, p.clave);
    return v.tipo === "INTERRUPTOR" && v.encendida && !incluidos.includes(p.modulo)
      ? [
          textoDePlanes("plataforma.planes.advertencia_perilla", {
            perilla: p.rotulo,
            modulo: rotuloDeModulo(p.modulo),
          }),
        ]
      : [];
  });
}

export function textoDelValor(valor: ValorDePerilla): string {
  if (valor.tipo === "INTERRUPTOR") {
    return textoDePlanes(
      valor.encendida ? "plataforma.planes.valor_encendida" : "plataforma.planes.valor_apagada",
    );
  }
  return valor.limite === "ILIMITADO" ? "∞" : String(valor.limite);
}

/** Lo que cambia entre dos contenidos, en líneas de texto. Es el mismo cálculo del servidor (`capacidades/planes/diferencia.ts`), sin clientes. */
export function lineasDeDiferencia(
  desde: ContenidoDePlan,
  hasta: ContenidoDePlan,
): readonly string[] {
  const comparar = (c: ContenidoDePlan): ContenidoParaComparar => ({
    modulos: conLoQueSePide(c.modulos),
    perillas: c.perillas,
  });
  const d = diferenciaEntreVersiones({
    catalogoDeModulos: MODULOS,
    catalogoDePerillas: PERILLAS,
    desde: comparar(desde),
    hasta: comparar(hasta),
    tenants: [],
    ahora: new Date(0),
  });
  return [
    ...d.modulosQueEntran.map((m) =>
      textoDePlanes("plataforma.planes.dif_suma", { m: rotuloDeModulo(m) }),
    ),
    ...d.modulosQueSalen.map((m) =>
      textoDePlanes("plataforma.planes.dif_quita", { m: rotuloDeModulo(m) }),
    ),
    ...d.perillas.map((p) =>
      textoDePlanes("plataforma.planes.dif_perilla", {
        perilla: rotuloDePerilla(p.perilla),
        a: textoDelValor(p.desde),
        b: textoDelValor(p.hasta),
      }),
    ),
  ];
}
