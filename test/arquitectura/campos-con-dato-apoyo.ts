import ts from "typescript";
import { DATO_PENDIENTE, type DefinicionDeDato } from "../../src/capacidades/datos/registro";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";

/**
 * Analizador de `campos-con-dato.test.ts` (regla 5 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`: sin dato registrado no hay
 * campo). Es puro: recibe rutas y texto, no toca el disco. Fail-closed (dueño: «lo que el chequeo no puede analizar, falla»): además
 * del control crudo y del campo sin dato, se prohíben las formas con las que se esquivaría el chequeo: alias del componente de campo,
 * `createElement`/`jsx`/`jsxs`, tags que no son un literal ni un componente declarado, `dangerouslySetInnerHTML` y HTML armado como
 * texto (`innerHTML`, `outerHTML`, `insertAdjacentHTML`), y el `<input type="hidden">` solo se exime con `type` y `name` literales y sin
 * ningún spread. Límite declarado: no ve un nombre calculado en una expresión (`obj[nombre]`) ni un componente de otro paquete que
 * renderice un `<input>` por dentro.
 */

export type Registro = Readonly<Record<string, DefinicionDeDato>>;
export type Contexto = Readonly<{ componentes: readonly string[]; registro: Registro }>;
export type ResultadoDeArchivo = Readonly<{
  problemas: string[];
  pendientes: number;
  crudos: number;
  /** Tags dinámicos (`<Etiqueta>` que viene de una variable o un parámetro): no se puede saber a qué elemento resuelven. */
  dinamicos: number;
  /** Controles crudos por etiqueta (`input`, `textarea`, `select`). */
  crudosPorEtiqueta: ReadonlyMap<string, number>;
  usos: ReadonlyMap<string, number>;
}>;

const CONTROLES_CRUDOS = new Set(["input", "textarea", "select"]);
const FABRICAS_DE_ELEMENTOS = new Set([
  "createElement",
  "createElementNS",
  "cloneElement",
  "jsx",
  "jsxs",
  "jsxDEV",
  "_jsx",
  "_jsxs",
  "_jsxDEV",
]);
const HTML_COMO_TEXTO = new Set(["innerHTML", "outerHTML", "insertAdjacentHTML"]);
const ENVOLTORIOS_DE_COMPONENTE = new Set(["memo", "forwardRef", "lazy", "createContext"]);

const nombreDeComponente = (ruta: string): string =>
  (ruta.split("/").pop() ?? ruta).replace(/\.tsx$/, "");

type Atributos = readonly ts.JsxAttributeLike[];

function atributo(atributos: Atributos, nombre: string, fuente: ts.SourceFile) {
  return atributos.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(fuente) === nombre,
  );
}

/** El literal de texto de un atributo JSX (`x="a"` o `x={"a"}`), o `undefined` si es dinámico. */
function literalDe(attr: ts.JsxAttribute | undefined): string | undefined {
  const valor = attr?.initializer;
  if (valor === undefined) return undefined;
  if (ts.isStringLiteral(valor)) return valor.text;
  if (ts.isJsxExpression(valor) && valor.expression !== undefined) {
    const e = valor.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  }
  return undefined;
}

const esDeTipos = (nodo: ts.Node): boolean => {
  for (let p: ts.Node | undefined = nodo.parent; p !== undefined; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p))
      return true;
  }
  return false;
};

/** Identificadores que son un componente declarado en el archivo (importado, función, clase o constante-función). */
function componentesDeclarados(fuente: ts.SourceFile): Set<string> {
  const declarados = new Set<string>();
  const mirar = (nodo: ts.Node): void => {
    if (ts.isImportClause(nodo) && !nodo.isTypeOnly && nodo.name !== undefined) {
      declarados.add(nodo.name.text);
    }
    if (ts.isImportSpecifier(nodo) && !nodo.isTypeOnly) declarados.add(nodo.name.text);
    if (ts.isNamespaceImport(nodo)) declarados.add(nodo.name.text);
    if (
      (ts.isFunctionDeclaration(nodo) || ts.isClassDeclaration(nodo)) &&
      nodo.name !== undefined
    ) {
      declarados.add(nodo.name.text);
    }
    if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name)) {
      const i = nodo.initializer;
      const envuelto =
        i !== undefined &&
        ts.isCallExpression(i) &&
        ((ts.isIdentifier(i.expression) && ENVOLTORIOS_DE_COMPONENTE.has(i.expression.text)) ||
          (ts.isPropertyAccessExpression(i.expression) &&
            ENVOLTORIOS_DE_COMPONENTE.has(i.expression.name.text)));
      if (i !== undefined && (ts.isArrowFunction(i) || ts.isFunctionExpression(i) || envuelto)) {
        declarados.add(nodo.name.text);
      }
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  return declarados;
}

/** Problemas, deuda y usos de un archivo de aplicación (no de un componente de campo). */
export function analizarArchivo(
  ruta: string,
  texto: string,
  contexto: Contexto,
): ResultadoDeArchivo {
  const tipoDeArchivo = ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, tipoDeArchivo);
  const campos = new Set(contexto.componentes.map(nombreDeComponente));
  const declarados = componentesDeclarados(fuente);
  const problemas: string[] = [];
  const usos = new Map<string, number>();
  const crudosPorEtiqueta = new Map<string, number>();
  let pendientes = 0;
  let dinamicos = 0;
  const donde = (nodo: ts.Node): string =>
    `${ruta}:${fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1}`;

  const usoDeCampo = (nodo: ts.JsxOpeningLikeElement, etiqueta: string): void => {
    const lugar = `${donde(nodo)} <${etiqueta}>`;
    const atributos = nodo.attributes.properties;
    const dato = atributo(atributos, "dato", fuente);
    const literal = literalDe(dato);
    const despues =
      dato === undefined
        ? []
        : atributos.slice(atributos.indexOf(dato) + 1).filter(ts.isJsxSpreadAttribute);
    if (despues.length > 0) {
      problemas.push(`${lugar} usa {...props} después de dato: podría pisarlo`);
    } else if (dato === undefined) {
      problemas.push(`${lugar} no declara qué dato pide (falta la prop dato)`);
    } else if (literal === undefined) {
      problemas.push(`${lugar} declara su dato con una expresión: tiene que ser un literal`);
    } else if (literal === DATO_PENDIENTE) {
      pendientes += 1;
    } else {
      const definicion = contexto.registro[literal];
      if (definicion === undefined) {
        problemas.push(`${lugar} pide el dato «${literal}», que no está en el registro de datos`);
      } else if (!definicion.consumidores.includes(ruta)) {
        problemas.push(
          `${lugar} pide el dato «${literal}» pero ${ruta} no figura entre sus consumidores`,
        );
      } else {
        usos.set(literal, (usos.get(literal) ?? 0) + 1);
      }
    }
  };

  const usoDeControlCrudo = (nodo: ts.JsxOpeningLikeElement, etiqueta: string): void => {
    const atributos = nodo.attributes.properties;
    const oculto =
      etiqueta === "input" &&
      literalDe(atributo(atributos, "type", fuente)) === "hidden" &&
      literalDe(atributo(atributos, "name", fuente)) !== undefined &&
      !atributos.some(ts.isJsxSpreadAttribute);
    if (!oculto) crudosPorEtiqueta.set(etiqueta, (crudosPorEtiqueta.get(etiqueta) ?? 0) + 1);
  };

  const mirar = (nodo: ts.Node): void => {
    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const tag = nodo.tagName;
      if (!ts.isIdentifier(tag)) {
        problemas.push(
          `${donde(nodo)} <${tag.getText(fuente)}> tiene un tag que no se puede analizar (compuesto o con espacio de nombres)`,
        );
      } else if (/^[a-z]/.test(tag.text)) {
        if (CONTROLES_CRUDOS.has(tag.text)) usoDeControlCrudo(nodo, tag.text);
      } else if (campos.has(tag.text)) {
        usoDeCampo(nodo, tag.text);
      } else if (!declarados.has(tag.text)) {
        dinamicos += 1;
      }
    }
    if (ts.isJsxAttribute(nodo) && nodo.name.getText(fuente) === "dangerouslySetInnerHTML") {
      problemas.push(
        `${donde(nodo)} usa dangerouslySetInnerHTML: puede traer un control que el chequeo no ve`,
      );
    }
    if (
      ts.isImportSpecifier(nodo) &&
      nodo.propertyName !== undefined &&
      campos.has(nodo.propertyName.text)
    ) {
      problemas.push(
        `${donde(nodo)} importa ${nodo.propertyName.text} con otro nombre: el alias esconde el campo`,
      );
    }
    if (ts.isNamespaceImport(nodo)) {
      const modulo = nodo.parent.parent.moduleSpecifier;
      if (ts.isStringLiteral(modulo) && campos.has(nombreDeComponente(modulo.text))) {
        problemas.push(`${donde(nodo)} importa el componente de campo como espacio de nombres`);
      }
    }
    if (ts.isImportDeclaration(nodo) && ts.isStringLiteral(nodo.moduleSpecifier)) {
      if (/^react\/jsx(-dev)?-runtime$/.test(nodo.moduleSpecifier.text)) {
        problemas.push(
          `${donde(nodo)} importa el runtime de JSX: arma elementos sin pasar por el chequeo`,
        );
      }
    }
    if (ts.isCallExpression(nodo)) {
      const f = nodo.expression;
      const nombre = ts.isIdentifier(f)
        ? f.text
        : ts.isPropertyAccessExpression(f)
          ? f.name.text
          : "";
      const [primero] = nodo.arguments;
      const deHtmlLiteral =
        (nombre === "createElement" || nombre === "createElementNS") &&
        ts.isPropertyAccessExpression(f) &&
        primero !== undefined &&
        ts.isStringLiteral(primero) &&
        !CONTROLES_CRUDOS.has(primero.text);
      if (FABRICAS_DE_ELEMENTOS.has(nombre) && !deHtmlLiteral) {
        problemas.push(
          `${donde(nodo)} llama a ${nombre}(): arma elementos sin pasar por el chequeo`,
        );
      }
    }
    if (ts.isPropertyAccessExpression(nodo) && HTML_COMO_TEXTO.has(nodo.name.text)) {
      problemas.push(
        `${donde(nodo)} usa ${nodo.name.text}: arma HTML como texto sin pasar por el chequeo`,
      );
    }
    if (ts.isIdentifier(nodo) && campos.has(nodo.text)) {
      const p = nodo.parent;
      const comoTag =
        (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) &&
        p.tagName === nodo;
      const enImportSinAlias = ts.isImportSpecifier(p) && p.propertyName === undefined;
      const enImportPorDefecto = ts.isImportClause(p);
      if (!comoTag && !enImportSinAlias && !enImportPorDefecto && !esDeTipos(nodo)) {
        problemas.push(
          `${donde(nodo)} usa ${nodo.text} fuera de un tag JSX directo (alias o referencia): esconde el campo`,
        );
      }
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  const crudos = [...crudosPorEtiqueta.values()].reduce((a, b) => a + b, 0);
  return { problemas, pendientes, crudos, dinamicos, crudosPorEtiqueta, usos };
}

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
