import ts from "typescript";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import type { Registro } from "./campos-con-dato-apoyo";

/** Lo que `campos-con-dato.test.ts` comprueba además del código de las pantallas: el componente, el registro y la deuda. */

/** Un componente de campo declara la prop `dato` tipada como `DatoDeCampo`, obligatoria. */
export function problemasDeComponente(ruta: string, texto: string): string[] {
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let correcto = false;
  const mirar = (nodo: ts.Node): void => {
    if (
      ts.isPropertySignature(nodo) &&
      nodo.name.getText(fuente) === "dato" &&
      nodo.questionToken === undefined &&
      nodo.type?.getText(fuente) === "DatoDeCampo"
    ) {
      correcto = true;
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  return correcto
    ? []
    : [`${ruta} es un componente de campo y no declara «dato: DatoDeCampo» (obligatoria)`];
}

const accionesDelCatalogo = (): Set<string> =>
  new Set(Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones)));

/** El registro contra la realidad: fichas, acciones, módulos, fuentes y consumidores que de verdad lo piden. */
export function problemasDelRegistro(
  registro: Registro,
  usosPorArchivo: ReadonlyMap<string, ReadonlyMap<string, number>>,
  existe: (ruta: string) => boolean,
): string[] {
  const problemas: string[] = [];
  const acciones = accionesDelCatalogo();
  for (const [id, d] of Object.entries(registro)) {
    if (!existe(d.ficha)) problemas.push(`${id}: la ficha ${d.ficha} no existe`);
    if (d.propositos.length === 0) problemas.push(`${id}: no dice para qué existe`);
    for (const p of d.propositos) {
      if (p.para.trim() === "" || !/\.md\b/.test(p.fuente)) {
        problemas.push(
          `${id}: cada propósito lleva «para» y una fuente verificable (un documento .md)`,
        );
      }
    }
    if (d.consumidores.length === 0)
      problemas.push(`${id}: dato huérfano, no tiene consumidores declarados`);
    for (const c of d.consumidores) {
      if (!existe(c)) problemas.push(`${id}: el consumidor ${c} no existe`);
      else if ((usosPorArchivo.get(c)?.get(id) ?? 0) === 0) {
        problemas.push(
          `${id}: el consumidor ${c} declarado no pide el dato (huérfano o desactualizado)`,
        );
      }
    }
    if (d.ponerPor.length === 0) problemas.push(`${id}: no dice quién puede ponerlo`);
    for (const a of d.ponerPor) {
      if (!acciones.has(a))
        problemas.push(`${id}: la acción de permiso «${a}» no existe en el catálogo`);
    }
    if (!(d.requiere.modulo in CATALOGO_DE_MODULOS)) {
      problemas.push(`${id}: el módulo «${d.requiere.modulo}» no existe en el catálogo`);
    }
    if (d.requiere.estadoDeEmpresa.length === 0)
      problemas.push(`${id}: no dice en qué estado de empresa existe`);
  }
  return problemas;
}

export type Cuenta = Readonly<{ pendientes: number; crudos: number; dinamicos: number }>;

const CLAVES_DE_CUENTA = ["pendientes", "crudos", "dinamicos"] as const;
const hayDeuda = (c: Cuenta | undefined): boolean =>
  c !== undefined && CLAVES_DE_CUENTA.some((k) => c[k] > 0);
const resumen = (c: Cuenta): string => CLAVES_DE_CUENTA.map((k) => `${k} ${c[k]}`).join(", ");

/**
 * La deuda real contra el presupuesto por archivo (`arquitectura/deuda/campos-sin-dato.json`): tiene que coincidir EXACTO. Que
 * no suba contra la base lo comprueba `campos-sin-dato.cjs` en el CI; acá se comprueba que el presupuesto no miente.
 */
export function problemasDeDeuda(
  reales: ReadonlyMap<string, Cuenta>,
  presupuesto: Readonly<Record<string, Cuenta>>,
): string[] {
  const problemas: string[] = [];
  for (const [ruta, real] of reales) {
    if (!hayDeuda(real)) continue;
    const previsto = presupuesto[ruta];
    if (previsto === undefined) {
      problemas.push(
        `${ruta} tiene deuda de campos (${resumen(real)}) y no está en el presupuesto (deuda nueva)`,
      );
    } else if (CLAVES_DE_CUENTA.some((k) => real[k] > previsto[k])) {
      problemas.push(
        `${ruta} supera su presupuesto: tiene ${resumen(real)} y el presupuesto dice ${resumen(previsto)}`,
      );
    } else if (CLAVES_DE_CUENTA.some((k) => real[k] < previsto[k])) {
      problemas.push(
        `${ruta} bajó su deuda (${resumen(real)}): bajá el presupuesto (hoy ${resumen(previsto)}) en arquitectura/deuda/campos-sin-dato.json`,
      );
    }
  }
  for (const ruta of Object.keys(presupuesto)) {
    if (!hayDeuda(reales.get(ruta))) {
      problemas.push(
        `${ruta} ya no tiene deuda de campos: sacalo de arquitectura/deuda/campos-sin-dato.json y de campos-sin-dato--* en el registro de deuda`,
      );
    }
  }
  return problemas;
}
