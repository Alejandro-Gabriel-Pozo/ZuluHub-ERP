import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `.github/workflows/migrar.yml` (web-armazon §5.7): la única forma en que las migraciones llegan a una base
 * real. Corre con secretos de la base y como el dueño de la base, así que estas propiedades lo mantienen
 * seguro; si alguien las quita, esta prueba se pone roja. Es una lectura del texto del archivo (no hay un lector
 * de YAML entre las dependencias); `zizmor` (job «flujos» del CI) revisa el resto.
 */

const TEXTO = readFileSync(join(import.meta.dirname, "../../.github/workflows/migrar.yml"), "utf8");
const LINEAS = TEXTO.split("\n");
const SIN_COMENTARIOS = LINEAS.filter((l) => !l.trim().startsWith("#")).join("\n");

/** Los pasos del job `migrar`, en orden: nombre y texto. */
function pasos(): { nombre: string; texto: string }[] {
  const desde = TEXTO.indexOf("\n  migrar:\n");
  const resto = TEXTO.slice(desde);
  return resto
    .split(/\n {6}- /)
    .slice(1)
    .map((bloque) => {
      const nombre = /name: (.+)/.exec(bloque)?.[1] ?? /uses: (\S+)/.exec(bloque)?.[1] ?? "";
      return { nombre, texto: bloque };
    });
}
const paso = (parte: string) => {
  const encontrado = pasos().find((p) => p.nombre.includes(parte));
  if (encontrado === undefined) throw new Error(`no hay un paso que diga «${parte}»`);
  return encontrado;
};

/** Las opciones del campo «ambiente» (en el orden del archivo). */
function opcionesDeAmbiente(texto: string): string[] {
  const desde = texto.indexOf("      ambiente:");
  const hasta = texto.indexOf("      accion:");
  return [...texto.slice(desde, hasta).matchAll(/^ {10}- (\S+)$/gm)].map((m) => m[1] as string);
}

const CODIGO_DE_CLIENTE = /^cliente-[a-z0-9-]{3,30}$/;
const CASO_POR_OMISION = '*) echo "::error::Ambiente no permitido."; exit 1 ;;';

/**
 * Los ambientes de `migrar.yml` y su caso en «validar»: preview y produccion fijos, y los clientes con base propia (extra de plan, dueño
 * 25/11/2026) como lista CERRADA: cada uno con su opción, su caso, su frase `MIGRAR CLIENTE-<CODIGO>` y el respaldo obligatorio. `[]` si cumple.
 * Previene: un cliente que migre sin respaldo (se pierde el punto de retorno de SU base), una frase que no lo nombre (se aprueba una
 * migración por otra) o un ambiente con texto libre (un error de tipeo apunta al Environment equivocado).
 */
function problemasDeAmbientes(texto: string): string[] {
  const problemas: string[] = [];
  const opciones = opcionesDeAmbiente(texto);
  if (opciones[0] !== "preview" || opciones[1] !== "produccion") problemas.push("ambientes-fijos");
  if (new Set(opciones).size !== opciones.length) problemas.push("opciones-repetidas");
  for (const o of opciones.slice(2)) {
    if (!CODIGO_DE_CLIENTE.test(o)) problemas.push(`codigo-de-cliente: ${o}`);
  }
  const desde = texto.indexOf('case "$AMBIENTE" in');
  const hasta = texto.indexOf("esac", desde);
  if (desde < 0 || hasta < 0) return [...problemas, "sin-caso-de-ambiente"];
  const lineas = texto
    .slice(desde, hasta)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .slice(1);
  const casos = new Map<string, { frase: string; respaldo: string }>();
  for (const linea of lineas) {
    const caso = /^(\S+)\) esperado="([^"]+)"; con_respaldo=(true|false) ;;$/.exec(linea);
    if (caso !== null) {
      casos.set(caso[1] as string, { frase: caso[2] as string, respaldo: caso[3] as string });
    } else if (linea !== CASO_POR_OMISION) {
      problemas.push(`caso-ilegible: ${linea}`);
    }
  }
  if (!lineas.includes(CASO_POR_OMISION)) problemas.push("sin-cierre-por-omision");
  for (const o of opciones) if (!casos.has(o)) problemas.push(`opcion-sin-caso: ${o}`);
  for (const c of casos.keys()) if (!opciones.includes(c)) problemas.push(`caso-sin-opcion: ${c}`);
  const esperado = (o: string) =>
    o === "preview"
      ? { frase: "MIGRAR PREVIEW", respaldo: "false" }
      : o === "produccion"
        ? { frase: "MIGRAR PRODUCCION", respaldo: "true" }
        : { frase: `MIGRAR CLIENTE-${o.slice("cliente-".length).toUpperCase()}`, respaldo: "true" };
  for (const o of opciones) {
    const real = casos.get(o);
    if (real === undefined) continue;
    const debe = esperado(o);
    if (real.frase !== debe.frase) problemas.push(`frase: ${o}`);
    if (real.respaldo !== debe.respaldo) problemas.push(`respaldo: ${o}`);
  }
  return problemas;
}

describe("workflow migrar.yml", () => {
  it("solo se dispara a mano: sin push, pull request, cron ni otro disparador", () => {
    expect(TEXTO).toMatch(/^on:\n {2}workflow_dispatch:/m);
    const disparadores =
      /^ {2}(push|pull_request|pull_request_target|schedule|workflow_run|release|issues|issue_comment|repository_dispatch):/m;
    expect(TEXTO).not.toMatch(disparadores);
    const dentroDeOn = TEXTO.slice(TEXTO.indexOf("on:\n"), TEXTO.indexOf("\npermissions:"));
    expect(dentroDeOn.match(/^ {2}[a-z_]+:/gm)).toEqual(["  workflow_dispatch:"]);
  });

  it("los ambientes son preview, produccion y, a lo sumo, clientes de la lista cerrada (hoy vacía), cada uno con su caso", () => {
    expect(problemasDeAmbientes(TEXTO)).toEqual([]);
    // La lista de clientes con base propia está VACÍA hoy (dueño, 25/11/2026): sumar uno es una decisión y un cambio a propósito.
    expect(opcionesDeAmbiente(TEXTO)).toEqual(["preview", "produccion"]);
  });

  it("solo corre desde main, y lo verifica ANTES de entregar los secretos", () => {
    expect(TEXTO).toContain('[ "$REF" != "refs/heads/main" ]');
    expect(TEXTO).toContain("REF: ${{ github.ref }}");
    // `github.event.repository.fork` dice si ESTE repositorio es un fork, no quién corre: no protege nada.
    // La protección de fondo es «Deployment branches: solo main» en los Environments (PRIMER-DESPLIEGUE.md, B.1).
    expect(TEXTO).not.toContain("repository.fork");
    expect(TEXTO).not.toContain("ES_FORK");
    // El job con los secretos espera al que valida, y no hay otro job.
    expect(TEXTO).toMatch(/\n {2}migrar:\n(?:.*\n)*? {4}needs: validar\n/);
    expect(TEXTO.match(/^ {2}[a-z]+:$/gm)).toEqual(["  validar:", "  migrar:"]);
  });

  it("aplicar exige la frase exacta de cada ambiente; ver no", () => {
    expect(TEXTO).toContain('preview) esperado="MIGRAR PREVIEW"; con_respaldo=false ;;');
    expect(TEXTO).toContain('produccion) esperado="MIGRAR PRODUCCION"; con_respaldo=true ;;');
    expect(TEXTO).toContain('[ "$CONFIRMACION" != "$esperado" ]');
    expect(TEXTO).toMatch(/aplicar\)\n\s+if \[ "\$CONFIRMACION"/);
    expect(TEXTO).toContain('*) echo "::error::Ambiente no permitido."; exit 1 ;;');
  });

  it("el Environment sale solo de la salida YA validada (un preview no puede apuntar a producción)", () => {
    expect(TEXTO).toContain("environment: ${{ needs.validar.outputs.ambiente }}");
    // Ningún paso mira las entradas del usuario: solo `validar` (en env) y el grupo de concurrencia.
    const fuera = LINEAS.filter((l) => l.includes("inputs.") && !l.trim().startsWith("#"));
    expect(fuera.map((l) => l.trim())).toEqual([
      "group: migrar-${{ inputs.ambiente }}",
      "AMBIENTE: ${{ inputs.ambiente }}",
      "ACCION: ${{ inputs.accion }}",
      "CONFIRMACION: ${{ inputs.confirmacion }}",
    ]);
  });

  it("ningún comando recibe una expresión interpolada: van en env, nombres, condiciones y claves", () => {
    const permitida =
      /^\s*(- )?([A-Z_]+|name|group|environment|ambiente|accion|con_respaldo|outputs?|confirmacion|node-version|if):/;
    const conExpresion = LINEAS.filter((l) => l.includes("${{") && !l.trim().startsWith("#"));
    expect(conExpresion.length).toBeGreaterThan(0);
    for (const linea of conExpresion) expect(linea, linea).toMatch(permitida);
    expect(TEXTO).not.toMatch(/run:[^\n]*\$\{\{/);
    // Y dentro de los bloques `run: |` tampoco.
    for (const { texto } of pasos()) {
      const run = texto.includes("run: |")
        ? texto.slice(texto.indexOf("run: |"), texto.indexOf("\n        env:"))
        : "";
      expect(run).not.toContain("${{");
    }
  });

  it("permisos mínimos: solo lectura de contenido, y el job de validación sin ninguno", () => {
    expect(TEXTO).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(TEXTO).not.toMatch(/:\s*write\b/);
    expect(TEXTO).toMatch(/validar:(?:.*\n)*? {4}permissions: \{\}\n/);
  });

  it("los secretos son solo los declarados, salen del Environment, van únicamente en `env` y nunca en claro", () => {
    const usados = [...SIN_COMENTARIOS.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect([...new Set(usados)].sort()).toEqual([
      "NEON_API_KEY",
      "NEON_PROJECT_ID",
      "PEDERNAL_CLAVE_CONTEXTO",
      "PEDERNAL_DB_DUENO_DIRECTA",
    ]);
    for (const linea of LINEAS.filter((l) => l.includes("secrets.") && !l.trim().startsWith("#"))) {
      expect(linea.trim(), linea).toMatch(/^[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/);
    }
    expect(TEXTO).not.toContain("secrets: inherit");
    expect(TEXTO).not.toContain("toJSON(secrets)");
    // Ningún valor en claro: ni una cadena de conexión con usuario y clave, ni tiras largas de claves o tokens.
    expect(SIN_COMENTARIOS).not.toMatch(/postgres(ql)?:\/\/[^\s$]*:[^\s$@]+@/);
    expect(SIN_COMENTARIOS).not.toMatch(/\b[0-9a-fA-F]{40,}\b(?! #)/);
    expect(SIN_COMENTARIOS).not.toMatch(/\bnapi_[A-Za-z0-9]{10,}/);
    expect(SIN_COMENTARIOS).not.toMatch(/Bearer [A-Za-z0-9_-]{16,}/);
  });

  it("la base se alimenta con el secreto de la cadena DIRECTA del dueño, solo en los pasos que migran", () => {
    const conLaBase = pasos().filter((p) => p.texto.includes("secrets.PEDERNAL_DB_DUENO_DIRECTA"));
    expect(conLaBase.map((p) => p.nombre)).toEqual([
      "Ver qué falta aplicar",
      "Aplicar las migraciones",
      "Instalar la clave de contexto (si el Environment la tiene)",
    ]);
    for (const p of conLaBase) {
      expect(p.texto).toContain(
        "PEDERNAL_DB_MIGRACIONES: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}",
      );
    }
    // Nunca la cadena del pooler ni la de la aplicación, y nada de Vercel.
    expect(SIN_COMENTARIOS).not.toMatch(/pooler|PEDERNAL_DB_APP|PEDERNAL_DB_TRABAJOS|VERCEL/i);
  });

  it("los pasos que ven la base no tienen los secretos de Neon, y el de Neon no ve la base", () => {
    const respaldo = paso("Rama de respaldo");
    expect(respaldo.texto).not.toContain("PEDERNAL_DB_DUENO_DIRECTA");
    expect(respaldo.texto).not.toContain("PEDERNAL_CLAVE_CONTEXTO");
    for (const nombre of ["Ver qué falta", "Aplicar las migraciones", "Instalar la clave"]) {
      expect(paso(nombre).texto).not.toContain("NEON_");
    }
    expect(paso("Aplicar las migraciones").texto).not.toContain("PEDERNAL_CLAVE_CONTEXTO");
    expect(paso("Ver qué falta").texto).not.toContain("PEDERNAL_CLAVE_CONTEXTO");
  });

  it("el orden es: ver, respaldo, aplicar, clave de contexto", () => {
    const nombres = pasos().map((p) => p.nombre);
    const posicion = (parte: string) => nombres.findIndex((n) => n.includes(parte));
    expect(posicion("Ver qué falta")).toBeLessThan(posicion("Rama de respaldo"));
    expect(posicion("Rama de respaldo")).toBeLessThan(posicion("Aplicar las migraciones"));
    expect(posicion("Aplicar las migraciones")).toBeLessThan(posicion("Instalar la clave"));
    expect(posicion("Dependencias")).toBeLessThan(posicion("Ver qué falta"));
  });

  it("aplicar y la clave solo corren con la acción «aplicar»", () => {
    for (const nombre of ["Aplicar las migraciones", "Instalar la clave", "Rama de respaldo"]) {
      expect(paso(nombre).texto).toContain("needs.validar.outputs.accion == 'aplicar'");
    }
    expect(paso("Aplicar las migraciones").texto).toContain("run: npm run migrar -- --aplicar");
    expect(paso("Ver qué falta").texto).toContain("npm run migrar -- --ver");
    expect(paso("Ver qué falta").texto).not.toContain("--aplicar");
  });

  it("el respaldo: solo producción, solo con algo para aplicar, por el nombre de la rama, y si falta o falla NO se migra", () => {
    const { texto } = paso("Rama de respaldo");
    expect(texto).toContain("needs.validar.outputs.con_respaldo == 'true'");
    expect(texto).toContain('grep -q "faltan aplicar"');
    expect(texto).toContain('grep -q "la base está al día"');
    expect(texto).toContain('nombre="antes-de-$ultima"');
    expect(texto).toContain('select(.name == "production")');
    expect(texto).toContain("https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches");
    // Sin las dos variables NO se migra producción (antes era un aviso y se migraba sin respaldo): lo detalla
    // `problemasDelRespaldo`, con una violación inyectada por cada propiedad.
    expect(texto).toContain("sin respaldo no se migra producción");
    expect(texto).not.toContain("::warning::");
    // Cada falla del respaldo corta el paso con error (el job no sigue a «Aplicar»).
    expect(texto.match(/exit 1/g)?.length).toBeGreaterThanOrEqual(4);
    expect(texto).toContain("No se migra.");
    // Nunca se imprime una respuesta de la API ni la clave: solo códigos HTTP.
    expect(texto).toContain("-o /dev/null -w '%{http_code}'");
    expect(texto).not.toMatch(/cat |echo "\$NEON|set -x|-v\b/);
    // El identificador del proyecto se valida antes de armar la URL.
    expect(texto).toContain('*[!a-z0-9-]*|"") echo "::error::NEON_PROJECT_ID');
  });

  it("la clave de contexto se instala solo si el Environment la tiene, con el mismo script del dueño", () => {
    const { texto } = paso("Instalar la clave");
    expect(texto).toContain('[ -z "${PEDERNAL_CLAVE_CONTEXTO:-}" ]');
    expect(texto).toContain("npm run instalar-clave");
    expect(texto).toContain("PEDERNAL_CLAVE_CONTEXTO: ${{ secrets.PEDERNAL_CLAVE_CONTEXTO }}");
  });

  it("`--ver` falla el paso si el script falla (pipefail) y los pasos con tuberías usan bash", () => {
    expect(paso("Ver qué falta").texto).toContain("shell: bash");
    expect(paso("Rama de respaldo").texto).toContain("shell: bash");
  });

  it("dos migraciones a la vez no se pisan y la que está corriendo nunca se cancela", () => {
    expect(TEXTO).toContain("group: migrar-${{ inputs.ambiente }}");
    expect(TEXTO).toContain("cancel-in-progress: false");
  });

  it("todas las acciones están fijadas por el SHA de un commit, sin credenciales persistentes", () => {
    const usos = LINEAS.filter((l) => l.includes("uses:") && !l.trim().startsWith("#"));
    expect(usos.length).toBe(2);
    for (const uso of usos) expect(uso, uso).toMatch(/uses: [\w./-]+@[0-9a-f]{40} # v\d/);
    expect(TEXTO).toContain("persist-credentials: false");
  });

  it("instala solo lo de producción y sin scripts de instalación (el job tiene los secretos)", () => {
    expect(TEXTO).toContain("run: npm ci --omit=dev --ignore-scripts");
    expect(TEXTO).not.toMatch(/cache:\s*npm/);
  });
});

/**
 * «Sin respaldo no se migra producción» (dueño, 25/11/2026, respuesta a la pregunta H-1 de `base-por-cliente-opciones.md`).
 * Devuelve los códigos de lo que NO se cumple en el paso de respaldo de un texto de `migrar.yml`; `[]` si todo se cumple.
 * Previene: migrar producción sin punto de retorno porque faltan las claves de Neon (antes: un aviso y se migraba), porque el
 * texto de `--ver` cambió y el paso lo tomó por «al día», o porque la falla del respaldo no cortó el job.
 */
function problemasDelRespaldo(texto: string): string[] {
  const problemas: string[] = [];
  const exigir = (codigo: string, cumple: boolean) => {
    if (!cumple) problemas.push(codigo);
  };
  const desde = texto.indexOf("      - name: Rama de respaldo");
  const hasta = texto.indexOf("      - name: Aplicar las migraciones");
  exigir("paso-de-respaldo-antes-de-aplicar", desde >= 0 && hasta > desde);
  if (desde < 0 || hasta <= desde) return problemas;
  const paso = texto.slice(desde, hasta);
  const sinClaves = /if \[ -z "\$\{NEON_API_KEY:-\}" \][^\n]*; then\n([\s\S]*?)\n\s+fi\n/.exec(
    paso,
  )?.[1];
  exigir("claves-obligatorias", sinClaves !== undefined);
  exigir(
    "sin-claves-corta",
    sinClaves !== undefined &&
      /exit 1/.test(sinClaves) &&
      !/exit 0/.test(sinClaves) &&
      !/::warning::/.test(sinClaves),
  );
  exigir("sin-avisos-en-lugar-de-error", !/::warning::/.test(paso));
  // Lo desconocido no es «al día»: el texto de «ver» tiene que ser uno de los dos resultados conocidos o se corta.
  const iPendientes = paso.indexOf('grep -q "faltan aplicar"');
  const iAlDia = paso.indexOf('grep -q "la base está al día"');
  exigir("resultado-conocido", iPendientes >= 0 && iAlDia > iPendientes);
  exigir(
    "salida-desconocida-corta",
    /\n {10}else\n[^\n]*::error::No se pudo saber si hay migraciones pendientes[^\n]*\n {12}exit 1\n {10}fi\n/.test(
      paso,
    ),
  );
  const iSinPendientes = paso.indexOf("No hay migraciones pendientes");
  exigir("sin-pendientes-solo-si-al-dia", iAlDia >= 0 && iSinPendientes > iAlDia);
  // Cada falla corta el paso: salida desconocida, claves, forma del proyecto, listar, rama de producción y crear.
  exigir("cada-falla-corta", (paso.match(/exit 1/g)?.length ?? 0) >= 6);
  exigir(
    "solo-con-respaldo-y-aplicar",
    /needs\.validar\.outputs\.con_respaldo == 'true'/.test(paso),
  );
  exigir("el-paso-no-se-ignora", !/continue-on-error/.test(texto));
  return problemas;
}

describe("workflow migrar.yml: sin respaldo no se migra producción", () => {
  it("cumple todas las propiedades", () => {
    expect(problemasDelRespaldo(TEXTO)).toEqual([]);
  });

  const reemplazar = (de: string, a: string) => (texto: string) => {
    if (!texto.includes(de)) throw new Error(`la violación inyectada no encuentra «${de}»`);
    return texto.replace(de, a);
  };
  const SIN_CLAVES = [
    '            echo "::error::Faltan NEON_API_KEY o NEON_PROJECT_ID en el Environment: sin respaldo no se migra producción ni la base de un cliente. No se migra."',
    "            exit 1",
  ].join("\n");
  const casos: [string, string, (texto: string) => string][] = [
    [
      "sin-claves-corta",
      "sin las claves se migra con un aviso (el comportamiento anterior)",
      reemplazar(
        SIN_CLAVES,
        '            echo "::warning::Sin NEON_API_KEY y NEON_PROJECT_ID: se migra SIN rama de respaldo."\n            exit 0',
      ),
    ],
    [
      "claves-obligatorias",
      "se quita la comprobación de las claves",
      reemplazar('if [ -z "${NEON_API_KEY:-}" ]', 'if [ -z "${NEON_OTRA:-}" ]'),
    ],
    [
      "salida-desconocida-corta",
      "una salida de «ver» desconocida se toma por «al día»",
      reemplazar(
        '            echo "::error::No se pudo saber si hay migraciones pendientes (la salida de «ver» no tiene un resultado conocido). No se migra."\n            exit 1',
        '            echo "No hay migraciones pendientes: no hace falta respaldo."\n            exit 0',
      ),
    ],
    [
      "resultado-conocido",
      "se vuelve a mirar solo «faltan aplicar»",
      reemplazar('grep -q "la base está al día"', 'grep -q "algo distinto"'),
    ],
    [
      "el-paso-no-se-ignora",
      "el paso del respaldo con continue-on-error",
      reemplazar(
        "        shell: bash\n        run: |\n          set -eu\n          # Fail closed",
        "        shell: bash\n        continue-on-error: true\n        run: |\n          set -eu\n          # Fail closed",
      ),
    ],
    [
      "cada-falla-corta",
      "la creación de la rama no corta el paso",
      reemplazar(
        '*) echo "::error::No se pudo crear la rama de respaldo «$nombre» (HTTP $codigo; si ya existe, borrala en Neon o elegí otra). No se migra."; exit 1 ;;',
        '*) echo "::error::No se pudo crear la rama de respaldo «$nombre» (HTTP $codigo). No se migra." ;;',
      ),
    ],
    [
      "solo-con-respaldo-y-aplicar",
      "el respaldo sin mirar si el ambiente lo exige",
      reemplazar(" && needs.validar.outputs.con_respaldo == 'true'", ""),
    ],
  ];

  it.each(casos)("violación inyectada «%s»: %s", (codigo, _descripcion, inyectar) => {
    expect(problemasDelRespaldo(inyectar(TEXTO))).toContain(codigo);
  });
});

describe("workflow migrar.yml: clientes con base propia (lista cerrada)", () => {
  const CASO_FINAL = `            ${CASO_POR_OMISION}`;
  const OPCION_PRODUCCION = "          - produccion\n";

  /** Suma un cliente de EJEMPLO al texto (la lista real está vacía): la opción y el caso, como se sumaría a mano. */
  function conCliente(
    texto: string,
    codigo: string,
    caso = `esperado="MIGRAR CLIENTE-${codigo.slice("cliente-".length).toUpperCase()}"; con_respaldo=true`,
  ): string {
    if (!texto.includes(OPCION_PRODUCCION) || !texto.includes(CASO_FINAL)) {
      throw new Error("la violación inyectada no encuentra dónde sumar el cliente");
    }
    return texto
      .replace(OPCION_PRODUCCION, `${OPCION_PRODUCCION}          - ${codigo}\n`)
      .replace(CASO_FINAL, `            ${codigo}) ${caso} ;;\n${CASO_FINAL}`);
  }

  it("un cliente bien sumado (opción, caso, frase y respaldo) cumple", () => {
    expect(problemasDeAmbientes(conCliente(TEXTO, "cliente-ejemplo"))).toEqual([]);
    const dos = conCliente(conCliente(TEXTO, "cliente-uno"), "cliente-dos-ar");
    expect(problemasDeAmbientes(dos)).toEqual([]);
  });

  const casos: [string, string, string][] = [
    [
      "respaldo: cliente-ejemplo",
      "un cliente sin respaldo obligatorio",
      conCliente(TEXTO, "cliente-ejemplo", 'esperado="MIGRAR CLIENTE-EJEMPLO"; con_respaldo=false'),
    ],
    [
      "frase: cliente-ejemplo",
      "un cliente cuya frase no lo nombra (la de producción)",
      conCliente(TEXTO, "cliente-ejemplo", 'esperado="MIGRAR PRODUCCION"; con_respaldo=true'),
    ],
    [
      "codigo-de-cliente: Cliente_Ejemplo",
      "un código con mayúsculas y guion bajo",
      conCliente(TEXTO, "Cliente_Ejemplo"),
    ],
    ["codigo-de-cliente: cliente-x", "un código demasiado corto", conCliente(TEXTO, "cliente-x")],
    [
      "codigo-de-cliente: otro",
      "una opción que no empieza con «cliente-»",
      conCliente(TEXTO, "otro"),
    ],
    [
      "opcion-sin-caso: cliente-ejemplo",
      "una opción sin su caso (se rechazaría recién al correr)",
      TEXTO.replace(OPCION_PRODUCCION, `${OPCION_PRODUCCION}          - cliente-ejemplo\n`),
    ],
    [
      "caso-sin-opcion: cliente-ejemplo",
      "un caso sin su opción (un ambiente fantasma que nadie puede elegir)",
      TEXTO.replace(
        CASO_FINAL,
        `            cliente-ejemplo) esperado="MIGRAR CLIENTE-EJEMPLO"; con_respaldo=true ;;\n${CASO_FINAL}`,
      ),
    ],
    [
      "sin-cierre-por-omision",
      "sin el caso final: un ambiente desconocido pasaría",
      TEXTO.replace(CASO_FINAL, ""),
    ],
    [
      "respaldo: produccion",
      "producción sin respaldo obligatorio",
      TEXTO.replace(
        'produccion) esperado="MIGRAR PRODUCCION"; con_respaldo=true',
        'produccion) esperado="MIGRAR PRODUCCION"; con_respaldo=false',
      ),
    ],
  ];

  it.each(casos)("violación inyectada «%s»: %s", (codigo, _descripcion, texto) => {
    expect(texto).not.toBe(TEXTO);
    expect(problemasDeAmbientes(texto)).toContain(codigo);
  });
});
