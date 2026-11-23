import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * Regla «acción → caso de uso» (tercera pata; diseño aprobado por el dueño el 21/11/2026 en
 * `11-especificaciones/regla-tercera-pata-accion-declarada-con-caso-de-uso-2026-11-21.md`): toda acción de permiso declarada en el
 * catálogo de un módulo `disponible` (a) la usa algún caso de uso o consulta de `src/modulos/*`, o (b) está en
 * `arquitectura/pantallas/acciones-reservadas.json` con motivo, ola, referencia y vencimiento.
 *
 * «Usa» (lo que cuenta como caso de uso), leído del código con el árbol de sintaxis, nunca de los comentarios:
 *  - el literal de una propiedad `accion:` o `tambien: [...]` (las declaraciones de los casos y las consultas);
 *  - un literal de acción pasado como argumento de una llamada (`exigirAccion(reglas, "x.y", …)`, `pedir(["x.y"])`, también dentro de un
 *    arreglo o de un condicional), que es como los casos piden las acciones de más que no declaran.
 * Fail-closed (`CLAUDE.md` «Todo nace cerrado»): `exigirAccion` con una acción calculada (plantilla, llamada, condicional…), o una propiedad
 * `accion:` / `tambien:` de una declaración que no es un literal, cuenta como NO ANALIZABLE y falla (no se puede saber qué acción usa).
 * Un nombre (`exigirAccion(reglas, accion, …)` en los `comun.ts`, que reciben la acción de la declaración del caso) se acepta: la acción
 * la cuenta la declaración. Ejemplo que NO ve: un envoltorio al que se le pasa una acción que ninguna declaración nombra.
 * Límites que NO ve (alarma para errores honestos, no un límite de seguridad): un literal de acción pasado a una llamada que no pide
 * permiso (cuenta como uso de más; ej. `registrar("productos.crear")`); una acción armada con una plantilla o una constante pasada por
 * otra función (si pasa por `exigirAccion` es NO ANALIZABLE; por otra llamada, no se ve); un `accion:` vacío o un caso declarado que
 * no se implementa de verdad (lo cubren las pruebas de cada caso); los módulos `en_desarrollo` (se miran al pasar a `disponible`); los
 * permisos que no son del catálogo de módulos (consola de plataforma); la relación acción → pantalla (otra regla).
 *
 * Es pura salvo `leerAccionesUsadas`, que lee el código de `src/modulos` y entrega el mismo resultado que `accionesUsadasEnCodigo`.
 */

export type ModuloDelCatalogo = Readonly<{
  estado: string;
  acciones: Readonly<Record<string, unknown>>;
}>;

export type EntradaDeLaRegla = Readonly<{
  catalogo: Readonly<Record<string, ModuloDelCatalogo>>;
  /** Acciones que usa el código (resultado de `accionesUsadasEnCodigo`). */
  usadas: ReadonlySet<string>;
  /** Usos que el análisis no pudo resolver (también de `accionesUsadasEnCodigo`): cada uno es una falla. */
  noAnalizables: readonly string[];
  /** Contenido de `acciones-reservadas.json`, sin validar. */
  registro: unknown;
  /** Contenido de `tope-reservadas.json`, sin validar. */
  tope: unknown;
  /** El tope más alto que el repositorio acepta jamás: solo se baja. */
  topeMaximo: number;
  /** Hoy en formato `AAAA-MM-DD`, hora de Argentina (UTC-3); se inyecta para poder probar el vencimiento. */
  hoy: string;
}>;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CAMPOS = ["accion", "motivo", "ola", "referencia", "vence"] as const;

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);
const esTexto = (valor: unknown): valor is string =>
  typeof valor === "string" && valor.trim() !== "";
const esFechaReal = (valor: unknown): valor is string =>
  typeof valor === "string" &&
  FECHA.test(valor) &&
  new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) === valor;

/** Las fechas de cierre de cada ola, validadas (`{ "1": "2027-01-20", … }`). */
function leerOlas(registro: Record<string, unknown>, problemas: string[]): Map<string, string> {
  const olas = new Map<string, string>();
  if (!esObjeto(registro["olas"]) || Object.keys(registro["olas"]).length === 0) {
    problemas.push("acciones-reservadas.json: falta «olas» (el cierre de cada ola, AAAA-MM-DD)");
    return olas;
  }
  for (const [ola, fecha] of Object.entries(registro["olas"])) {
    if (esFechaReal(fecha)) olas.set(ola, fecha);
    else
      problemas.push(
        `acciones-reservadas.json: la ola ${ola} no tiene una fecha AAAA-MM-DD válida`,
      );
  }
  return olas;
}

/** Todos los problemas de la regla; vacío = cumple. */
export function evaluarAccionConCasoDeUso(entrada: EntradaDeLaRegla): string[] {
  const problemas: string[] = [...entrada.noAnalizables.map((n) => `no analizable: ${n}`)];
  const { catalogo, usadas, hoy } = entrada;

  const modulosDe = new Map<string, string>();
  for (const [clave, modulo] of Object.entries(catalogo)) {
    for (const accion of Object.keys(modulo.acciones)) modulosDe.set(accion, clave);
  }

  // El registro: forma exacta (nace cerrado: una clave de más o un tipo raro falla).
  const registro = entrada.registro;
  if (!esObjeto(registro) || !Array.isArray(registro["reservadas"])) {
    return [...problemas, "acciones-reservadas.json: tiene que ser { olas, reservadas: [...] }"];
  }
  for (const clave of Object.keys(registro)) {
    if (clave !== "olas" && clave !== "reservadas") {
      problemas.push(`acciones-reservadas.json: clave desconocida «${clave}»`);
    }
  }
  const olas = leerOlas(registro, problemas);

  const reservadas = new Set<string>();
  let validas = 0;
  for (const [indice, fila] of registro["reservadas"].entries()) {
    const donde = `reservada #${indice + 1}`;
    if (!esObjeto(fila)) {
      problemas.push(`${donde}: tiene que ser un objeto { ${CAMPOS.join(", ")} }`);
      continue;
    }
    validas += 1;
    const nombre = esTexto(fila["accion"]) ? fila["accion"] : donde;
    for (const clave of Object.keys(fila)) {
      if (!(CAMPOS as readonly string[]).includes(clave)) {
        problemas.push(`${nombre}: clave desconocida «${clave}»`);
      }
    }
    for (const campo of ["accion", "motivo", "referencia"] as const) {
      if (!esTexto(fila[campo])) problemas.push(`${nombre}: falta ${campo}`);
    }
    if (!esFechaReal(fila["vence"])) problemas.push(`${nombre}: falta vence (AAAA-MM-DD)`);
    const ola = typeof fila["ola"] === "number" ? String(fila["ola"]) : undefined;
    if (ola === undefined) problemas.push(`${nombre}: falta ola (número)`);
    else if (!olas.has(ola)) problemas.push(`${nombre}: la ola ${ola} no tiene fecha en «olas»`);

    if (!esTexto(fila["accion"])) continue;
    const accion = fila["accion"];
    if (reservadas.has(accion)) problemas.push(`${accion}: está repetida en las reservadas`);
    reservadas.add(accion);

    const duenoDeLaAccion = modulosDe.get(accion);
    const modulo = duenoDeLaAccion === undefined ? undefined : catalogo[duenoDeLaAccion];
    if (modulo === undefined) {
      problemas.push(`${accion}: está reservada pero no existe en el catálogo`);
    } else if (modulo.estado !== "disponible") {
      problemas.push(
        `${accion}: está reservada pero su módulo (${duenoDeLaAccion}) no está disponible; esta regla no lo mira`,
      );
    }
    if (usadas.has(accion)) {
      problemas.push(`${accion}: ya tiene caso de uso; sacala de las reservadas y bajá el tope`);
    }
    if (esFechaReal(fila["vence"])) {
      if (fila["vence"] < hoy) {
        problemas.push(`${accion}: la reserva venció el ${fila["vence"]} (hoy es ${hoy})`);
      }
      const cierre = ola === undefined ? undefined : olas.get(ola);
      if (cierre !== undefined && fila["vence"] > cierre) {
        problemas.push(
          `${accion}: vence el ${fila["vence"]}, después del cierre de su ola (${cierre})`,
        );
      }
    }
  }

  // Lo declarado y disponible tiene caso de uso o reserva.
  for (const [clave, modulo] of Object.entries(catalogo)) {
    if (modulo.estado !== "disponible") continue;
    for (const accion of Object.keys(modulo.acciones)) {
      if (!usadas.has(accion) && !reservadas.has(accion)) {
        problemas.push(
          `${accion} (${clave}): declarada en el catálogo y ningún caso de uso la usa; construí el caso, quitala del catálogo o reservala con ola y vencimiento`,
        );
      }
    }
  }

  // El presupuesto solo baja: la cuenta es exacta, y el tope no puede pasar del máximo histórico.
  const valorDelTope = esObjeto(entrada.tope) ? entrada.tope["tope"] : undefined;
  if (typeof valorDelTope !== "number" || !Number.isInteger(valorDelTope) || valorDelTope < 0) {
    problemas.push("tope-reservadas.json: tiene que ser { tope: entero desde 0 }");
  } else {
    const tope = valorDelTope;
    if (tope > entrada.topeMaximo) {
      problemas.push(
        `tope-reservadas.json: el tope (${tope}) sube por encima de ${entrada.topeMaximo}; solo baja`,
      );
    }
    if (validas > tope) {
      problemas.push(`hay ${validas} reservadas y el tope es ${tope}; el total solo baja`);
    } else if (validas < tope) {
      problemas.push(`hay ${validas} reservadas y el tope es ${tope}; bajá el tope a ${validas}`);
    }
  }
  return problemas;
}

/** Los literales de texto (con comillas o con plantilla sin partes) de un nodo, como lista. */
function literalDe(nodo: ts.Node): string | undefined {
  return ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)
    ? nodo.text
    : undefined;
}

const NOMBRE_DE_ACCION = /^[a-z_]+\.[a-z_]+$/;

/** ¿El nodo es un argumento (a cualquier profundidad) de una llamada? */
function esArgumentoDeLlamada(nodo: ts.Node): boolean {
  let hijo: ts.Node = nodo;
  for (let padre: ts.Node | undefined = nodo.parent; padre !== undefined; padre = padre.parent) {
    if (ts.isCallExpression(padre) && padre.arguments.some((a) => a === hijo)) return true;
    if (ts.isBlock(padre) || ts.isSourceFile(padre)) return false;
    hijo = padre;
  }
  return false;
}

/** El nombre de la propiedad que contiene al nodo si el nodo es su valor (o un elemento de su arreglo). */
function propiedadDeAccion(nodo: ts.Node): "accion" | "tambien" | undefined {
  const padre = nodo.parent;
  const candidata = ts.isArrayLiteralExpression(padre) ? padre.parent : padre;
  if (!ts.isPropertyAssignment(candidata)) return undefined;
  const nombre = candidata.name;
  const texto = ts.isIdentifier(nombre) || ts.isStringLiteral(nombre) ? nombre.text : undefined;
  if (texto === "accion" && candidata.initializer === nodo) return "accion";
  if (texto === "tambien" && ts.isArrayLiteralExpression(padre)) return "tambien";
  return undefined;
}

/**
 * Lee UN archivo: devuelve las acciones que usa y lo que no pudo analizar. `catalogo` son las claves conocidas del catálogo (un literal
 * que no es una acción del catálogo no cuenta).
 */
export function accionesUsadasEnCodigo(
  archivo: string,
  codigo: string,
  conocidas: ReadonlySet<string>,
): { usadas: Set<string>; noAnalizables: string[] } {
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true);
  const usadas = new Set<string>();
  const noAnalizables: string[] = [];
  const posicion = (nodo: ts.Node): string =>
    `${archivo}:${fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1}`;

  const visitar = (nodo: ts.Node): void => {
    const texto = literalDe(nodo);
    if (texto !== undefined && conocidas.has(texto)) {
      if (propiedadDeAccion(nodo) !== undefined || esArgumentoDeLlamada(nodo)) usadas.add(texto);
    }
    // `accion:` o `tambien:` con algo que no es un literal: no se sabe qué acción es.
    if (
      ts.isPropertyAssignment(nodo) &&
      (ts.isIdentifier(nodo.name) || ts.isStringLiteral(nodo.name))
    ) {
      if (nodo.name.text === "accion" && /declaraciones/.test(archivo)) {
        const valor = nodo.initializer;
        const texto2 = literalDe(valor);
        if (texto2 === undefined || !NOMBRE_DE_ACCION.test(texto2)) {
          noAnalizables.push(`${posicion(nodo)} accion: que no es un literal de acción`);
        }
      }
      if (nodo.name.text === "tambien" && /declaraciones/.test(archivo)) {
        const valor = nodo.initializer;
        const todosLiterales =
          ts.isArrayLiteralExpression(valor) &&
          valor.elements.every((e) => {
            const t = literalDe(e);
            return t !== undefined && NOMBRE_DE_ACCION.test(t);
          });
        if (!todosLiterales) {
          noAnalizables.push(`${posicion(nodo)} tambien: que no es un arreglo de literales`);
        }
      }
    }
    // `exigirAccion(reglas, <acción>, …)`: la acción es un literal, `….accion` (que lee la declaración) o un nombre (el parámetro de un
    // envoltorio `comun.ts`, que recibe la acción de la declaración del caso que lo llama). Calculada de otro modo: no analizable.
    if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression)) {
      if (nodo.expression.text === "exigirAccion") {
        const accion = nodo.arguments[1];
        const analizable =
          accion !== undefined &&
          ((literalDe(accion) !== undefined && NOMBRE_DE_ACCION.test(literalDe(accion) ?? "")) ||
            ts.isIdentifier(accion) ||
            (ts.isPropertyAccessExpression(accion) && accion.name.text === "accion"));
        if (!analizable)
          noAnalizables.push(
            `${posicion(nodo)} exigirAccion con una acción calculada (no es un literal, un nombre ni «….accion»)`,
          );
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return { usadas, noAnalizables };
}

/** Los archivos de código (sin pruebas) de los casos de uso y las consultas de cada módulo. */
export function archivosDeCasosDeUso(raiz: string): string[] {
  const salida: string[] = [];
  const recorrer = (carpeta: string): void => {
    for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = join(carpeta, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name))
        salida.push(ruta);
    }
  };
  const modulos = join(raiz, "src/modulos");
  for (const modulo of readdirSync(modulos, { withFileTypes: true })) {
    if (!modulo.isDirectory()) continue;
    for (const carpeta of ["casos-de-uso", "consultas"]) {
      try {
        recorrer(join(modulos, modulo.name, carpeta));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return salida.sort();
}

/** Lee todo `src/modulos/*\/{casos-de-uso,consultas}` y junta lo que usa y lo que no pudo analizar. */
export function leerAccionesUsadas(
  raiz: string,
  conocidas: ReadonlySet<string>,
): { usadas: Set<string>; noAnalizables: string[] } {
  const usadas = new Set<string>();
  const noAnalizables: string[] = [];
  for (const archivo of archivosDeCasosDeUso(raiz)) {
    const relativo = archivo.slice(raiz.length + 1);
    const leido = accionesUsadasEnCodigo(relativo, readFileSync(archivo, "utf8"), conocidas);
    for (const accion of leido.usadas) usadas.add(accion);
    noAnalizables.push(...leido.noAnalizables);
  }
  return { usadas, noAnalizables };
}
