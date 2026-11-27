import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PERMISOS_DE_EMPRESA, tablaDePermisos } from "../src/capacidades/permisos/empresa";

/**
 * Genera la SEMILLA de la migración 0094 (permisos configurables, tramo T1 de H4b) desde la constante `PERMISOS_DE_EMPRESA`:
 * las plantillas `ADMINISTRADOR` y `OPERADOR` (el gerente no tiene lista: su conjunto es «todo lo que el plan habilita»), los pisos
 * de plataforma y las acciones ya introducidas. Previene: que la semilla se escriba a mano y difiera de la tabla de hoy (el
 * comportamiento tiene que quedar idéntico, diseño H4b §6.1). La comprueba `test/integracion/permisos-configurables-migracion.test.ts`.
 *
 *     npm run semilla:plantillas              imprime el bloque
 *     npm run semilla:plantillas -- --declaracion   escribe `migraciones/plantillas-declaradas.json` (lo que el código declara de cada
 *                                                   acción; lo lee el ejecutor para sincronizar las plantillas, H4b §6.3)
 *     npm run semilla:plantillas -- --verificar   falla si el bloque de la migración (mientras no esté sellada) o la declaración no son
 *                                                 los que se generan hoy
 *
 * Pisos iniciales (decisión del dueño del 14/11/2026, Q1 = A, `h4b-permisos-configurables.md` Anexo A en Pedernal-docs): solo-gerente =
 * las acciones que hoy tiene únicamente el GERENTE (se derivan de la constante); «todos los roles» = estas cuatro, que NO se derivan (de las
 * acciones que hoy tienen los tres roles, solo estas cuatro son piso): quien responde un traspaso es el entrante, que puede ser un operador.
 */
export const PISOS_DE_TODOS_LOS_ROLES = [
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "gerencia.ver_traspaso",
  "permisos.ver_propios",
] as const;

/** Quién figura como autor de lo que carga la migración (las tablas guardan texto: el actor de plataforma o este valor). */
export const AUTOR_DE_LA_SEMILLA = "migracion:0094";

export const MARCA_DE_INICIO = "-- >>> SEMILLA GENERADA (npm run semilla:plantillas) >>>";
export const MARCA_DE_FIN = "-- <<< SEMILLA GENERADA <<<";

export type Semilla = Readonly<{
  administrador: readonly string[];
  operador: readonly string[];
  soloGerente: readonly string[];
  todosLosRoles: readonly string[];
  catalogo: readonly string[];
}>;

/** Los datos de la semilla, ordenados (el orden es el de `tablaDePermisos`, para que el bloque sea estable). */
export function datosDeLaSemilla(): Semilla {
  const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
  const soloGerente = tabla.GERENTE.filter((a) => {
    const roles: readonly string[] = PERMISOS_DE_EMPRESA[a];
    return roles.length === 1;
  });
  return {
    administrador: tabla.ADMINISTRADOR,
    operador: tabla.OPERADOR,
    soloGerente,
    todosLosRoles: [...PISOS_DE_TODOS_LOS_ROLES].sort(),
    catalogo: tabla.GERENTE,
  };
}

const lista = (acciones: readonly string[]): string =>
  `ARRAY[\n    ${acciones.map((a) => `'${a}'`).join(",\n    ")}\n  ]::text[]`;

/** El bloque SQL de la semilla, entre sus marcas. Las acciones son claves de la lista cerrada del catálogo (solo `[a-z0-9_.]`). */
export function bloqueDeLaSemilla(): string {
  const s = datosDeLaSemilla();
  const piso = (accion: string, tipo: string): string =>
    `('${accion}', '${tipo}', '${AUTOR_DE_LA_SEMILLA}')`;
  const pisos = [
    ...s.soloGerente.map((a) => piso(a, "SOLO_GERENTE")),
    ...s.todosLosRoles.map((a) => piso(a, "TODOS_LOS_ROLES")),
  ].join(",\n  ");
  return [
    MARCA_DE_INICIO,
    `INSERT INTO plantilla_de_rol (clave) VALUES ('GERENTE'), ('ADMINISTRADOR'), ('OPERADOR');`,
    ``,
    // Los pisos van ANTES de las plantillas: el disparador de la versión los consulta y no acepta que no haya ninguno.
    `INSERT INTO piso_de_plataforma (accion, tipo, autor) VALUES`,
    `  ${pisos};`,
    ``,
    `INSERT INTO version_de_plantilla (clave, numero, acciones, autor) VALUES`,
    `  ('ADMINISTRADOR', 1, ${lista(s.administrador)}, '${AUTOR_DE_LA_SEMILLA}'),`,
    `  ('OPERADOR', 1, ${lista(s.operador)}, '${AUTOR_DE_LA_SEMILLA}');`,
    ``,
    `INSERT INTO accion_introducida (accion) SELECT unnest(${lista(s.catalogo)});`,
    MARCA_DE_FIN,
  ].join("\n");
}

/** El bloque que hoy trae el archivo de la migración (entre marcas), o `null` si no están. */
export function bloqueDelArchivo(sql: string): string | null {
  const desde = sql.indexOf(MARCA_DE_INICIO);
  const hasta = sql.indexOf(MARCA_DE_FIN);
  if (desde < 0 || hasta < desde) return null;
  return sql.slice(desde, hasta + MARCA_DE_FIN.length);
}

const ARCHIVO_DE_LA_MIGRACION = new URL(
  "../migraciones/0094_permisos_configurables.sql",
  import.meta.url,
);

const ARCHIVO_DE_LA_DECLARACION = new URL(
  "../migraciones/plantillas-declaradas.json",
  import.meta.url,
);
const ARCHIVO_DE_LOS_SELLOS = new URL("../migraciones/selladas.json", import.meta.url);
const NOMBRE_DE_LA_MIGRACION = "0094_permisos_configurables.sql";

/**
 * Lo que el código declara de cada acción (los roles que la tienen), tal como lo lee el ejecutor de migraciones. Un archivo aparte de la
 * migración porque una migración sellada no se edita y una acción nueva tiene que poder llegar a las plantillas igual (H4b §6.3).
 * Una acción por línea y los roles en una línea: es el formato que deja prettier, así `format:check` no lo discute.
 */
export function textoDeLaDeclaracion(): string {
  const lineas = Object.keys(PERMISOS_DE_EMPRESA)
    .sort()
    .map((accion) => {
      const roles: readonly string[] =
        PERMISOS_DE_EMPRESA[accion as keyof typeof PERMISOS_DE_EMPRESA];
      return `    ${JSON.stringify(accion)}: [${[...roles]
        .sort()
        .map((rol) => JSON.stringify(rol))
        .join(", ")}]`;
    });
  return `{\n  "formato": 1,\n  "acciones": {\n${lineas.join(",\n")}\n  }\n}\n`;
}

/** Si la migración ya está sellada (aplicada en alguna base), su semilla no se vuelve a comparar: ya no se edita. */
function estaSellada(): boolean {
  const sellos = JSON.parse(readFileSync(ARCHIVO_DE_LOS_SELLOS, "utf8")) as Record<string, unknown>;
  return NOMBRE_DE_LA_MIGRACION in sellos;
}

function principal(argumentos: readonly string[]): number {
  if (argumentos.includes("--declaracion")) {
    writeFileSync(ARCHIVO_DE_LA_DECLARACION, textoDeLaDeclaracion());
    return 0;
  }
  const generado = bloqueDeLaSemilla();
  if (!argumentos.includes("--verificar")) {
    console.log(generado);
    return 0;
  }
  let falla = 0;
  if (
    !estaSellada() &&
    bloqueDelArchivo(readFileSync(ARCHIVO_DE_LA_MIGRACION, "utf8")) !== generado
  ) {
    console.error(
      "El bloque de la semilla de 0094 no es el que se genera desde PERMISOS_DE_EMPRESA: corré `npm run semilla:plantillas` y pegá el bloque (una migración ya aplicada no se edita: la acción nueva llega por la declaración, ver `--declaracion`).",
    );
    falla = 1;
  }
  if (readFileSync(ARCHIVO_DE_LA_DECLARACION, "utf8") !== textoDeLaDeclaracion()) {
    console.error(
      "migraciones/plantillas-declaradas.json no es el que se genera desde PERMISOS_DE_EMPRESA: corré `npm run semilla:plantillas -- --declaracion`.",
    );
    falla = 1;
  }
  return falla;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = principal(process.argv.slice(2));
}
