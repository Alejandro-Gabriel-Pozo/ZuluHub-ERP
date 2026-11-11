import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { arbolConRegistro, control, entrada, forma, MARCA, resumen } from "./decisiones-apoyo";

/**
 * Casos que fijan los bordes del registro de decisiones (anclas de las expresiones, límites de largo, textos exactos de cada mensaje,
 * orden y formato de la lista de archivos tocados, y la corrida como programa). El grupo de mutación `guardián (registro de decisiones)`
 * exige 100 %: cada caso mata un mutante que las otras pruebas dejaban vivo.
 */
const RAIZ = join(import.meta.dirname, "../..");
const REG = [entrada()];
const evaluar = (
  pr: ReturnType<typeof arbolConRegistro>,
  base: ReturnType<typeof arbolConRegistro> | null = null,
) => control.evaluar({ pr, base });
const problemas = (c: Record<string, unknown>) =>
  forma.problemasDelRegistro([{ ...entrada(), ...c }]).map((p) => p.problema);

describe("anclas y bordes de la forma", () => {
  it.each([["xDEC-0001"], ["DEC-0001x"], ["DEC-1"]])("el id %s no tiene la forma", (id) => {
    expect(problemas({ id })).toContain("id tiene la forma DEC-0001.");
  });
  it("un id que no es texto falla aunque su texto se vea bien", () => {
    expect(problemas({ id: ["DEC-0001"] })).toContain("id tiene la forma DEC-0001.");
    expect(forma.problemasDelRegistro([{ ...entrada(), id: 7 }]).map((p) => p.id)).toEqual(
      ["#1", "#1"].slice(0, 1),
    );
  });
  it.each([["2026-11-11x"], ["x2026-11-11"], ["2026-11-1"]])(
    "la fecha %s no es válida",
    (fecha) => {
      expect(problemas({ fecha })).toEqual(["fecha es un día real con la forma AAAA-MM-DD."]);
    },
  );
  it("una fecha que no es texto falla aunque su texto se vea bien", () => {
    expect(problemas({ fecha: ["2026-11-11"] })).toEqual([
      "fecha es un día real con la forma AAAA-MM-DD.",
    ]);
    expect(problemas({ fecha: 20261111 })).toEqual([
      "fecha es un día real con la forma AAAA-MM-DD.",
    ]);
  });
  it("el largo de un texto admite justo el mínimo y el máximo, y no uno menos ni uno más", () => {
    expect(problemas({ decision: "abc" })).toEqual([]);
    expect(problemas({ decision: "a".repeat(200) })).toEqual([]);
    expect(problemas({ decision: "ab" })).toEqual([
      "decision tiene que tener entre 3 y 200 caracteres.",
    ]);
    expect(problemas({ decision: "a".repeat(201) })).toEqual([
      "decision tiene que tener entre 3 y 200 caracteres.",
    ]);
  });
  it("los mensajes de lista separan con coma y espacio", () => {
    expect(problemas({ quien: "x" })).toEqual(["quien es uno de: dueño, padre, sesión."]);
    expect(problemas({ estado: "x" })).toEqual([
      "estado es uno de: PENDIENTE_DE_OK, CONFIRMADA, CORREGIDA.",
    ]);
    expect(problemas({ tipo: "x" })[0]).toContain("tipo es uno de: DINERO, PERMISOS, CLIENTE,");
    expect(problemas({ a: 1, b: 2 })).toEqual(["claves que no existen: a, b."]);
    const faltan = forma.problemasDelRegistro([
      { id: "DEC-0001", fecha: "2026-11-11", quien: "padre", tipo: "DINERO", estado: "CONFIRMADA" },
    ]);
    expect(faltan[0]?.problema).toContain("faltan decision, que_cambia, donde.");
  });
  it("la aclaración del motivo sale solo para un SIN_DECISION al que le falta el motivo", () => {
    const sin = (base: Record<string, unknown>, clave: string) =>
      Object.fromEntries(Object.entries(base).filter(([k]) => k !== clave));
    const tecnica = { ...entrada(), tipo: "SIN_DECISION", motivo: "Cambio técnico de nombres." };
    const lista = (e: unknown) => forma.problemasDelRegistro([e]).map((p) => p.problema);
    expect(lista(sin(tecnica, "motivo"))).toEqual([
      "faltan motivo (un SIN_DECISION explica en `motivo` por qué no es una decisión de negocio).",
    ]);
    expect(lista(sin(tecnica, "donde"))).toContain("faltan donde.");
    expect(lista(sin(entrada() as unknown as Record<string, unknown>, "donde"))).toContain(
      "faltan donde.",
    );
  });
  it("un motivo dentro de una entrada que no es SIN_DECISION no se valida como texto", () => {
    expect(problemas({ motivo: "x" })).toEqual(["claves que no existen: motivo."]);
  });
  it("una ruta de la lista que no es texto falla aunque su texto se vea bien", () => {
    const valor = { sensibles: [{ ruta: ["src/"], que: "algo importante" }] };
    expect(forma.problemasDeLosSensibles(valor).join(" ")).toContain(
      "ruta es un archivo o una carpeta",
    );
  });
});

describe("anclas de los archivos que mira el control", () => {
  it("solo se escanean los archivos cuyo nombre TERMINA en una extensión de programa o SQL", () => {
    const pr = arbolConRegistro(REG, {
      "src/a.ts.bak": `// ${MARCA}\n`,
      "src/a.sqlx": `// ${MARCA}\n`,
    });
    expect(evaluar(pr).fallas).toEqual([]);
  });
  it("una carpeta que solo se llama migraciones más adentro no es de migraciones", () => {
    const nombrada = [entrada({ donde: "src/migraciones/a.sql y src/migraciones/b.ts" })];
    const archivos = {
      "src/migraciones/a.sql": `-- ${MARCA}\n`,
      "migraciones/b.sql.ts": `// ${MARCA}\n`,
    };
    const base = arbolConRegistro(nombrada, archivos);
    expect(evaluar(arbolConRegistro(nombrada, archivos), base).fallas).toHaveLength(2);
    const nombradaSql = [entrada({ donde: "migraciones/b.sql.ts" })];
    expect(
      evaluar(arbolConRegistro(nombradaSql, archivos), arbolConRegistro(nombradaSql, archivos))
        .fallas,
    ).toHaveLength(2);
  });
  it("basta UNA entrada que nombre la migración, aunque otras no", () => {
    const registro = [
      entrada({ donde: "otro lado" }),
      entrada({ id: "DEC-0002", donde: "migraciones/0001_x.sql" }),
    ];
    const sql = { "migraciones/0001_x.sql": `-- ${MARCA}\n` };
    expect(
      evaluar(arbolConRegistro(registro, sql), arbolConRegistro(registro, sql)).fallas,
    ).toEqual([]);
  });
  it("la cita desconocida sale en su línea y el SUPUESTO sin cita de una migración NUEVA no dice que está en la base", () => {
    const pr = arbolConRegistro(REG, {
      "src/a.ts": "\n\n// ver DEC-0099\n",
      "migraciones/0009_n.sql": `-- ${MARCA}\n`,
    });
    const { fallas } = evaluar(pr, arbolConRegistro(REG));
    expect(fallas.find((f) => f.archivo === "src/a.ts")?.linea).toBe(3);
    const nueva = fallas.find((f) => f.archivo === "migraciones/0009_n.sql");
    expect(nueva?.motivo).toContain("SUPUESTO sin decisión registrada");
    expect(nueva?.motivo).not.toContain("ya está en la base");
  });
  it("el mensaje de cómo agregar trae el ejemplo completo de una entrada", () => {
    for (const campo of [
      '"que_cambia"',
      '"donde"',
      '"decision"',
      '"quien": "sesión"',
      "SIN_DECISION",
    ]) {
      expect(control.COMO_AGREGAR).toContain(campo);
    }
  });
  it("las pruebas de la carpeta sensible no cuentan, sea cual sea su extensión de prueba, pero un nombre parecido sí", () => {
    const antes = arbolConRegistro(REG, {
      "src/primitivas/dinero/a.test.mts": "a",
      "src/primitivas/dinero/b.test.js": "a",
      "src/primitivas/dinero/c.test.ts.txt": "a",
    });
    const pr = arbolConRegistro(REG, {
      "src/primitivas/dinero/a.test.mts": "b",
      "src/primitivas/dinero/b.test.js": "b",
      "src/primitivas/dinero/c.test.ts.txt": "b",
    });
    const { fallas } = evaluar(pr, antes);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]?.archivo).toBe("src/primitivas/dinero/c.test.ts.txt");
  });
  it("un archivo exacto de la lista no es una carpeta: no alcanza a otro que empieza igual", () => {
    const antes = arbolConRegistro(REG, {
      "arquitectura/decisiones/archivos-sensibles.json.bak": "a",
    });
    const pr = arbolConRegistro(REG, {
      "arquitectura/decisiones/archivos-sensibles.json.bak": "b",
    });
    expect(evaluar(pr, antes).fallas).toEqual([]);
  });
  it("una entrada con las mismas claves en otro orden es la misma: no cuenta como cambiada", () => {
    const e = entrada();
    const barajada = Object.fromEntries(Object.entries(e).reverse());
    const antes = arbolConRegistro([e], { "src/primitivas/dinero/a.ts": "a" });
    const pr = arbolConRegistro([barajada], { "src/primitivas/dinero/a.ts": "b" });
    expect(evaluar(pr, antes).fallas).toHaveLength(1);
  });
  it("los archivos tocados salen ordenados, hasta tres con coma y espacio, y con tres justos no dice más", () => {
    const antes = arbolConRegistro(REG, {
      "src/primitivas/dinero/a.ts": "x",
      "src/primitivas/dinero/z.ts": "x",
    });
    const pr = arbolConRegistro(REG, {
      "src/primitivas/dinero/b.ts": "x",
      "src/primitivas/dinero/z.ts": "y",
    });
    const dos = evaluar(pr, antes).fallas[0];
    expect(dos?.archivo).toBe("src/primitivas/dinero/a.ts");
    expect(dos?.motivo).toContain(
      "(src/primitivas/dinero/a.ts, src/primitivas/dinero/b.ts, src/primitivas/dinero/z.ts)",
    );
    expect(dos?.motivo).not.toContain(" más");
    const unico = evaluar(
      arbolConRegistro(REG, { "src/primitivas/dinero/q.ts": "x" }),
      arbolConRegistro(REG),
    ).fallas[0];
    expect(unico?.motivo).toContain("el dinero y el redondeo (src/primitivas/dinero/q.ts) y");
    expect(unico?.motivo).not.toContain(" más");
  });
});

describe("mensajes exactos de las declaraciones", () => {
  const vacio = { rutas: [], leer: () => null };
  it("sin registro ni lista, dos fallas con su archivo y sin prefijo", () => {
    expect(evaluar(vacio).fallas).toEqual([
      { archivo: control.ARCHIVO_DEL_REGISTRO, linea: 1, motivo: "no existe." },
      { archivo: control.ARCHIVO_DE_LOS_SENSIBLES, linea: 1, motivo: "no existe." },
    ]);
  });
  it("JSON roto en el cambio: el mensaje trae el archivo y no el prefijo de la base", () => {
    const roto = { rutas: [], leer: () => Buffer.from("{roto") };
    const [uno, dos] = evaluar(roto).fallas;
    expect(uno?.motivo).toMatch(/^arquitectura\/decisiones\/registro\.json: no se puede leer \(/);
    expect(dos?.motivo).toMatch(
      /^arquitectura\/decisiones\/archivos-sensibles\.json: no se puede leer \(/,
    );
  });
  it("una lista de sensibles que es null no rompe el control", () => {
    const pr = arbolConRegistro(REG, {}, null);
    expect(evaluar(pr).fallas.map((f) => f.motivo)).toEqual([
      expect.stringContaining("tiene que ser"),
    ]);
  });
  it("si el cambio ya tiene fallas, no se compara con la base", () => {
    const pr = arbolConRegistro([entrada({ tipo: "OTRO" })]);
    const base = arbolConRegistro([entrada(), entrada({ id: "DEC-0002" })]);
    expect(evaluar(pr, base).fallas).toHaveLength(1);
  });
  it("las fallas de la base llevan el prefijo Base y su lista de sensibles también", () => {
    const registroMalo = arbolConRegistro([entrada({ tipo: "OTRO" })]);
    expect(evaluar(arbolConRegistro(REG), registroMalo).fallas[0]?.motivo).toBe(
      "Base: DEC-0001: tipo es uno de: DINERO, PERMISOS, CLIENTE, DATOS, COMERCIAL, INFRAESTRUCTURA, SIN_DECISION.",
    );
    const sinLista = arbolConRegistro(REG, {}, { sensibles: [] });
    expect(evaluar(arbolConRegistro(REG), sinLista).fallas[0]?.motivo).toBe(
      "Base: archivos-sensibles.json no puede quedar vacío.",
    );
    const sinArchivo = {
      rutas: [],
      leer: (r: string) => (r.endsWith("registro.json") ? Buffer.from("[]") : null),
    };
    expect(evaluar(arbolConRegistro(REG), sinArchivo).fallas[0]?.motivo).toBe("Base: no existe.");
    const rotaLista = {
      rutas: [],
      leer: (r: string) => Buffer.from(r.endsWith("registro.json") ? "[]" : "{roto"),
    };
    expect(evaluar(arbolConRegistro(REG), rotaLista).fallas[0]?.motivo).toMatch(
      /^Base: arquitectura\/decisiones\/archivos-sensibles\.json: no se puede leer/,
    );
  });
});

describe("corrida como programa", () => {
  const carpetas: string[] = [];
  afterEach(() => {
    for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
  });
  function repo(archivos: Record<string, string>): string {
    const raiz = mkdtempSync(join(tmpdir(), "decisiones-prog-"));
    carpetas.push(raiz);
    spawnSync("git", ["init", "-q"], { cwd: raiz });
    for (const [ruta, contenido] of Object.entries(archivos)) {
      mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
      writeFileSync(join(raiz, ruta), contenido);
    }
    return raiz;
  }
  const declaraciones = (registro: unknown) => ({
    [control.ARCHIVO_DEL_REGISTRO]: JSON.stringify(registro),
    [control.ARCHIVO_DE_LOS_SENSIBLES]: JSON.stringify({
      sensibles: [{ ruta: "src/primitivas/dinero/", que: "el dinero" }],
    }),
  });
  const correr = (script: string, cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [join(RAIZ, "arquitectura/decisiones", script), ...args], {
      cwd,
      encoding: "utf8",
    });

  it("decisiones.cjs toma la raíz del directorio actual y sale con el código del control", () => {
    const bien = correr("decisiones.cjs", repo(declaraciones(REG)));
    expect(bien.status).toBe(0);
    expect(bien.stdout).toBe("Registro de decisiones: 0 fallas, 0 avisos.\n");
    const mal = correr(
      "decisiones.cjs",
      repo({ ...declaraciones(REG), "src/a.ts": `// ${MARCA}\n` }),
    );
    expect(mal.status).toBe(1);
    expect(mal.stdout).toContain("FALLA src/a.ts:1");
  });
  it("la base que no es una carpeta dice cuál escribió la persona", () => {
    const raiz = repo(declaraciones(REG));
    const salida = control.ejecutar(["--base=falta-esta"], raiz);
    expect(salida.lineas).toEqual(["--base: «falta-esta» no es una carpeta."]);
    expect(correr("decisiones.cjs", raiz, "--base=falta-esta").status).toBe(2);
  });
  it("una base extraída dentro del repositorio no se cuenta como parte del cambio", () => {
    const raiz = repo({
      ...declaraciones(REG),
      "base/src/a.ts": `// ${MARCA}\n`,
      "base/x.txt": "x",
    });
    for (const [ruta, contenido] of Object.entries(declaraciones(REG))) {
      mkdirSync(dirname(join(raiz, "base", ruta)), { recursive: true });
      writeFileSync(join(raiz, "base", ruta), contenido);
    }
    expect(control.ejecutar([`--base=${join(raiz, "base")}`], raiz)).toEqual({
      codigo: 0,
      lineas: ["Registro de decisiones: 0 fallas, 0 avisos."],
    });
  });

  it("resumen.cjs imprime el resumen del registro del directorio actual", () => {
    const registro = [entrada({ id: "DEC-0007", tipo: "DINERO" })];
    const corrida = correr("resumen.cjs", repo(declaraciones(registro)));
    expect(corrida.status).toBe(0);
    expect(corrida.stdout).toBe(resumen.resumir(registro));
    expect(corrida.stderr).toBe("");
  });
  it("resumen.cjs con un registro ilegible o inválido falla con el motivo y no imprime nada", () => {
    const roto = correr("resumen.cjs", repo({ [control.ARCHIVO_DEL_REGISTRO]: "{roto" }));
    expect(roto.status).toBe(1);
    expect(roto.stdout).toBe("");
    expect(roto.stderr).toContain("arquitectura/decisiones/registro.json: no se puede leer (");
    const invalido = correr("resumen.cjs", repo(declaraciones([entrada({ tipo: "OTRO" })])));
    expect(invalido.status).toBe(1);
    expect(invalido.stdout).toBe("");
    expect(invalido.stderr).toBe(
      "arquitectura/decisiones/registro.json DEC-0001: tipo es uno de: DINERO, PERMISOS, CLIENTE, DATOS, COMERCIAL, INFRAESTRUCTURA, SIN_DECISION.\n",
    );
    expect(resumen.ejecutar(repo({})).errores).toHaveLength(1);
  });
});
