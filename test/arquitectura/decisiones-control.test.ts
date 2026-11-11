import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { arbolConRegistro, control, entrada, MARCA } from "./decisiones-apoyo";

/**
 * El control del registro de decisiones (`arquitectura/decisiones/decisiones.cjs`, enchufado en `npm run gate` y en el job del guardián
 * del CI con `--base=base`). Previene: decisiones de permisos, dinero, lo que ve un cliente o lo comercial tomadas por una sesión y
 * anotadas solo como «SUPUESTO» (caso real, 11/11/2026: `presentacion_de_producto` pasó de catálogo a compras contra el diseño
 * aprobado). Cada caso inyectado abajo rompe el control; si se lo debilita, esta prueba se pone roja.
 */
const RAIZ_DEL_REPO = join(import.meta.dirname, "../..");
const REGISTRO = [entrada()];
const motivos = (r: { fallas: { motivo: string }[] }) => r.fallas.map((f) => f.motivo);
const evaluar = (
  pr: ReturnType<typeof arbolConRegistro>,
  base: ReturnType<typeof arbolConRegistro> | null = null,
) => control.evaluar({ pr, base });
const CODIGO = (cita: string) => `// ${MARCA} del ingeniero ${cita}\nexport const x = 1;\n`;

describe("(a) todo SUPUESTO cita una decisión registrada", () => {
  it("un marcador con su cita registrada pasa", () => {
    const pr = arbolConRegistro(REGISTRO, { "src/a.ts": CODIGO("(DEC-0001)") });
    expect(evaluar(pr)).toEqual({ fallas: [], avisos: [] });
  });

  it("un marcador sin cita falla, con archivo y línea, y dice cómo agregar la entrada", () => {
    const pr = arbolConRegistro(REGISTRO, { "src/a.ts": `export const y = 0;\n${CODIGO("")}` });
    const { fallas } = evaluar(pr);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toMatchObject({ archivo: "src/a.ts", linea: 2 });
    expect(fallas[0]?.motivo).toContain("sin decisión registrada");
    expect(fallas[0]?.motivo).toContain("arquitectura/decisiones/registro.json");
    expect(fallas[0]?.motivo).toContain('"estado": "PENDIENTE_DE_OK"');
  });

  it("se ve en pruebas, en SQL y en cualquier extensión de programa", () => {
    const archivos = Object.fromEntries(
      [
        "src/a.test.ts",
        "test/b.test.tsx",
        "migraciones/0099_x.sql",
        "apps/web/c.mjs",
        "scripts/d.cjs",
        "e.js",
      ].map((ruta) => [ruta, `-- ${MARCA} sin cita\n`]),
    );
    const { fallas } = evaluar(arbolConRegistro(REGISTRO, archivos));
    expect(fallas.map((f) => f.archivo).sort()).toEqual(Object.keys(archivos).sort());
  });

  it("la palabra en minúscula, dentro de otra palabra o en un .md no es un marcador", () => {
    const pr = arbolConRegistro(REGISTRO, {
      "src/a.ts":
        "// el supuesto de arriba y el PRESUPUESTO por archivo\n// NOSUPUESTO y SUPUESTOX\n",
      "docs/a.md": `${MARCA} en un documento\n`,
    });
    expect(evaluar(pr).fallas).toEqual([]);
  });

  it("el plural también es un marcador", () => {
    const pr = arbolConRegistro(REGISTRO, { "src/a.ts": `// todos ${MARCA}S del dominio\n` });
    expect(evaluar(pr).fallas).toHaveLength(1);
  });

  it("una cita a un DEC que no existe falla, con o sin marcador", () => {
    const pr = arbolConRegistro(REGISTRO, {
      "src/a.ts": CODIGO("(DEC-0099)"),
      "src/b.ts": "// ver DEC-0098\n",
    });
    const { fallas } = evaluar(pr);
    expect(fallas.map((f) => f.archivo).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(fallas[0]?.motivo).toContain("que no está en arquitectura/decisiones/registro.json");
  });

  it("una cita de cinco dígitos no cuenta como cita", () => {
    const pr = arbolConRegistro(REGISTRO, { "src/a.ts": CODIGO("(DEC-00011)") });
    expect(evaluar(pr).fallas).toHaveLength(1);
  });

  it("este control y sus pruebas están exentos por su ruta", () => {
    const pr = arbolConRegistro(REGISTRO, {
      "arquitectura/decisiones/ejemplo.cjs": `// ${MARCA}\n`,
      "test/arquitectura/decisiones-ejemplo.test.ts": `// ${MARCA}\n`,
      "test/arquitectura/otra.test.ts": `// ${MARCA}\n`,
    });
    expect(evaluar(pr).fallas.map((f) => f.archivo)).toEqual(["test/arquitectura/otra.test.ts"]);
    expect(control.EXENTOS).toEqual(["arquitectura/decisiones/", "test/arquitectura/decisiones"]);
  });

  it("una migración ya aplicada (está en la base) no se edita: la cubre una entrada que la nombra en `donde`", () => {
    const sql = { "migraciones/0006_fiscal.sql": `-- ${MARCA} del dominio\n` };
    const base = arbolConRegistro(REGISTRO, sql);
    const sinNombrar = evaluar(arbolConRegistro(REGISTRO, sql), base);
    expect(motivos(sinNombrar)[0]).toContain("ya está en la base");
    expect(motivos(sinNombrar)[0]).toContain("no se edita");
    const nombrada = [entrada({ donde: "migraciones/0006_fiscal.sql" })];
    expect(
      evaluar(arbolConRegistro(nombrada, sql), arbolConRegistro(nombrada, sql)).fallas,
    ).toEqual([]);
  });

  it("una migración nueva (no está en la base) tiene que citar en la línea, aunque la nombre un `donde`", () => {
    const nombrada = [entrada({ donde: "migraciones/0099_nueva.sql" })];
    const sql = { "migraciones/0099_nueva.sql": `-- ${MARCA} nuevo\n` };
    const base = arbolConRegistro(nombrada);
    expect(evaluar(arbolConRegistro(nombrada, sql), base).fallas).toHaveLength(1);
    const citada = { "migraciones/0099_nueva.sql": `-- ${MARCA} nuevo (DEC-0001)\n` };
    expect(evaluar(arbolConRegistro(nombrada, citada), base).fallas).toEqual([]);
  });

  it("sin base, una migración nombrada en un `donde` alcanza (el gate local no sabe cuál es nueva)", () => {
    const nombrada = [entrada({ donde: "migraciones/0099_nueva.sql" })];
    const sql = { "migraciones/0099_nueva.sql": `-- ${MARCA} nuevo\n` };
    expect(evaluar(arbolConRegistro(nombrada, sql)).fallas).toEqual([]);
  });

  it("un archivo ilegible o que desaparece entre la lista y la lectura no rompe el control", () => {
    const pr = arbolConRegistro(REGISTRO);
    pr.rutas.push("src/fantasma.ts");
    expect(evaluar(pr).fallas).toEqual([]);
  });
});

describe("la forma del registro y de la lista de sensibles también falla el control", () => {
  it("sin registro, sin la lista o con JSON roto falla (nunca pasa porque no se pudo mirar)", () => {
    const vacio = { rutas: [], leer: () => null };
    expect(motivos(evaluar(vacio)).join("|")).toContain("no existe");
    const roto = { rutas: ["x"], leer: () => Buffer.from("{no es json") };
    expect(motivos(evaluar(roto)).join("|")).toContain("no se puede leer");
  });

  it("una entrada inválida falla con su id y no se sigue con el resto", () => {
    const pr = arbolConRegistro([entrada({ tipo: "OTRO" })], { "src/a.ts": CODIGO("") });
    const { fallas } = evaluar(pr);
    expect(fallas.every((f) => f.archivo === "arquitectura/decisiones/registro.json")).toBe(true);
    expect(motivos({ fallas }).join("|")).toContain("DEC-0001: tipo es uno de");
  });

  it("una lista de sensibles inválida falla", () => {
    const pr = arbolConRegistro(REGISTRO, {}, { sensibles: [] });
    expect(motivos(evaluar(pr)).join("|")).toContain("no puede quedar vacío");
  });
});

describe("(b) contra la base: un archivo sensible tocado exige una entrada nueva o cambiada", () => {
  const base = (extra: Record<string, string> = {}) => arbolConRegistro(REGISTRO, extra);

  it("sin cambios sensibles, no se pide nada", () => {
    const pr = arbolConRegistro(REGISTRO, { "src/otra/x.ts": "a" });
    expect(evaluar(pr, base()).fallas).toEqual([]);
  });

  it("tocar la matriz de permisos sin entrada nueva falla y nombra el archivo y qué es", () => {
    const antes = base({ "src/capacidades/permisos/empresa.ts": "a" });
    const pr = arbolConRegistro(REGISTRO, { "src/capacidades/permisos/empresa.ts": "b" });
    const { fallas } = evaluar(pr, antes);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toMatchObject({ archivo: "src/capacidades/permisos/empresa.ts", linea: 1 });
    expect(fallas[0]?.motivo).toContain("la matriz de permisos");
    expect(fallas[0]?.motivo).toContain("no trae ninguna entrada nueva ni cambiada");
    expect(fallas[0]?.motivo).toContain("SIN_DECISION");
  });

  it("agregar o borrar un archivo sensible también cuenta", () => {
    const pr = arbolConRegistro(REGISTRO, { "src/primitivas/dinero/nuevo.ts": "a" });
    expect(evaluar(pr, base()).fallas).toHaveLength(1);
    const borrado = base({ "src/primitivas/dinero/viejo.ts": "a" });
    expect(evaluar(arbolConRegistro(REGISTRO), borrado).fallas).toHaveLength(1);
  });

  it("una entrada NUEVA lo cubre", () => {
    const antes = base({ "src/capacidades/permisos/empresa.ts": "a" });
    const nuevo = [...REGISTRO, entrada({ id: "DEC-0002" })];
    const pr = arbolConRegistro(nuevo, { "src/capacidades/permisos/empresa.ts": "b" });
    expect(evaluar(pr, antes).fallas).toEqual([]);
  });

  it("una entrada CAMBIADA lo cubre (por ejemplo, pasa a CORREGIDA)", () => {
    const antes = base({ "src/primitivas/dinero/a.ts": "a" });
    const cambiada = [entrada({ estado: "CORREGIDA" })];
    const pr = arbolConRegistro(cambiada, { "src/primitivas/dinero/a.ts": "b" });
    expect(evaluar(pr, antes).fallas).toEqual([]);
  });

  it("una entrada SIN_DECISION con motivo lo cubre (cambio puramente técnico)", () => {
    const antes = base({ "src/primitivas/dinero/a.ts": "a" });
    const tecnica = entrada({
      id: "DEC-0002",
      tipo: "SIN_DECISION",
      motivo: "Cambio de nombre interno: no cambia ningún importe.",
    });
    const pr = arbolConRegistro([...REGISTRO, tecnica], { "src/primitivas/dinero/a.ts": "b" });
    expect(evaluar(pr, antes).fallas).toEqual([]);
  });

  it("un cambio en una prueba de la carpeta sensible no pide entrada", () => {
    const antes = base({ "src/capacidades/permisos/a.test.ts": "a" });
    const pr = arbolConRegistro(REGISTRO, { "src/capacidades/permisos/a.test.ts": "b" });
    expect(evaluar(pr, antes).fallas).toEqual([]);
  });

  it("un archivo sensible igual a la base no cuenta", () => {
    const archivos = { "src/capacidades/permisos/a.ts": "igual" };
    expect(evaluar(arbolConRegistro(REGISTRO, archivos), base(archivos)).fallas).toEqual([]);
  });

  it("varios archivos tocados salen en UN mensaje, con los tres primeros y cuántos más", () => {
    const antes = base();
    const muchos = Object.fromEntries(
      [1, 2, 3, 4, 5].map((n) => [`src/primitivas/dinero/f${n}.ts`, "x"]),
    );
    const { fallas } = evaluar(arbolConRegistro(REGISTRO, muchos), antes);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]?.motivo).toContain(
      "f1.ts, src/primitivas/dinero/f2.ts, src/primitivas/dinero/f3.ts y 2 más",
    );
  });

  it("una carpeta sensible no se confunde con otra que empieza igual", () => {
    const pr = arbolConRegistro(REGISTRO, { "src/primitivas/dinero-otro/a.ts": "x" });
    expect(evaluar(pr, base()).fallas).toEqual([]);
  });

  it("un archivo exacto de la lista (la propia lista) es sensible", () => {
    const ampliada = {
      sensibles: [
        { ruta: "src/primitivas/dinero/", que: "el dinero y el redondeo" },
        {
          ruta: "arquitectura/decisiones/archivos-sensibles.json",
          que: "la lista de archivos sensibles",
        },
        { ruta: "src/capacidades/planes/", que: "los planes y perillas" },
      ],
    };
    const pr = arbolConRegistro(REGISTRO, {}, ampliada);
    const { fallas } = evaluar(pr, base());
    expect(fallas).toHaveLength(1);
    expect(fallas[0]?.motivo).toContain("la lista de archivos sensibles");
  });

  it("sacar una carpeta de la lista no la libera: rige la unión de la base y del cambio", () => {
    const sinDinero = {
      sensibles: [{ ruta: "src/capacidades/permisos/", que: "la matriz de permisos" }],
    };
    const antes = base({ "src/primitivas/dinero/a.ts": "a" });
    const pr = arbolConRegistro(REGISTRO, { "src/primitivas/dinero/a.ts": "b" }, sinDinero);
    expect(evaluar(pr, antes).fallas.length).toBeGreaterThan(0);
  });

  it("borrar una entrada de la base falla (se corrige con otra, no se borra)", () => {
    const antes = arbolConRegistro([entrada(), entrada({ id: "DEC-0002" })]);
    const { fallas } = evaluar(arbolConRegistro([entrada()]), antes);
    expect(motivos({ fallas })).toEqual([expect.stringContaining("DEC-0002 estaba en la base")]);
  });

  it("si la base todavía no trae el registro, avisa y no compara", () => {
    const sinRegistro = { rutas: ["x"], leer: () => null };
    const pr = arbolConRegistro(REGISTRO, { "src/primitivas/dinero/a.ts": "b" });
    const resultado = evaluar(pr, sinRegistro);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toHaveLength(1);
    expect(resultado.avisos[0]?.motivo).toContain("primera vez que se incorpora");
  });

  it("si la base trae el registro pero no se puede leer, falla (nunca pasa porque no se pudo mirar)", () => {
    const rota = {
      rutas: ["x"],
      leer: (ruta: string) => (ruta.endsWith("registro.json") ? Buffer.from("{roto") : null),
    };
    const { fallas } = evaluar(arbolConRegistro(REGISTRO), rota);
    expect(motivos({ fallas }).join("|")).toContain("Base:");
  });
});

describe("la línea de comandos", () => {
  const carpetas: string[] = [];
  afterEach(() => {
    for (const carpeta of carpetas.splice(0)) rmSync(carpeta, { recursive: true, force: true });
  });
  /** Un repositorio git de juguete con los archivos dados, sin hacer commit (`git ls-files --others` los lista). */
  function repo(archivos: Record<string, string>): string {
    const raiz = mkdtempSync(join(tmpdir(), "decisiones-"));
    carpetas.push(raiz);
    spawnSync("git", ["init", "-q"], { cwd: raiz });
    for (const [ruta, contenido] of Object.entries(archivos)) {
      mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
      writeFileSync(join(raiz, ruta), contenido);
    }
    return raiz;
  }
  const declaraciones = (registro: unknown[]) => ({
    [control.ARCHIVO_DEL_REGISTRO]: JSON.stringify(registro),
    [control.ARCHIVO_DE_LOS_SENSIBLES]: JSON.stringify({
      sensibles: [{ ruta: "src/primitivas/dinero/", que: "el dinero" }],
    }),
  });

  it("un argumento desconocido o dos --base dan el uso (código 2)", () => {
    expect(control.ejecutar(["--otra"], ".").codigo).toBe(2);
    expect(control.ejecutar(["--base=a", "--base=b"], ".").codigo).toBe(2);
    expect(control.ejecutar(["--base=a", "x"], ".").lineas[0]).toContain("Uso:");
  });

  it("una base que no es una carpeta da código 2", () => {
    const raiz = repo(declaraciones(REGISTRO));
    const salida = control.ejecutar([`--base=${join(raiz, "no-existe")}`], raiz);
    expect(salida.codigo).toBe(2);
    expect(salida.lineas[0]).toContain("no es una carpeta");
  });

  it("un repositorio en regla sale 0 y uno con un SUPUESTO sin cita sale 1", () => {
    const bien = repo(declaraciones(REGISTRO));
    expect(control.ejecutar([], bien)).toEqual({
      codigo: 0,
      lineas: ["Registro de decisiones: 0 fallas, 0 avisos."],
    });
    const mal = repo({ ...declaraciones(REGISTRO), "src/a.ts": `// ${MARCA}\n` });
    const salida = control.ejecutar([], mal);
    expect(salida.codigo).toBe(1);
    expect(salida.lineas[0]).toMatch(/^FALLA src\/a\.ts:1 · /);
    expect(salida.lineas.at(-1)).toBe("Registro de decisiones: 1 fallas, 0 avisos.");
  });

  it("con --base compara: tocar dinero sin entrada nueva sale 1 y con ella sale 0", () => {
    const antes = repo({ ...declaraciones(REGISTRO), "src/primitivas/dinero/a.ts": "a" });
    const sin = repo({ ...declaraciones(REGISTRO), "src/primitivas/dinero/a.ts": "b" });
    const salida = control.ejecutar([`--base=${antes}`], sin);
    expect(salida.codigo).toBe(1);
    expect(salida.lineas[0]).toContain("el dinero");
    const con = repo({
      ...declaraciones([...REGISTRO, entrada({ id: "DEC-0002" })]),
      "src/primitivas/dinero/a.ts": "b",
    });
    expect(control.ejecutar([`--base=${antes}`], con).codigo).toBe(0);
  });

  it("el aviso de la primera incorporación sale como AVISO y no falla", () => {
    const antes = repo({ "x.txt": "a" });
    const pr = repo(declaraciones(REGISTRO));
    const salida = control.ejecutar([`--base=${antes}`], pr);
    expect(salida.codigo).toBe(0);
    expect(salida.lineas[0]).toMatch(/^AVISO arquitectura\/decisiones\/registro\.json:1 · /);
  });

  it("como programa: sale con el código del control", () => {
    const raiz = repo(declaraciones(REGISTRO));
    const corrida = spawnSync(
      process.execPath,
      [join(RAIZ_DEL_REPO, "arquitectura/decisiones/decisiones.cjs"), "--base=no-existe"],
      {
        cwd: raiz,
        encoding: "utf8",
      },
    );
    // El script se corre desde el repo real: la raíz es la del propio script, no el cwd.
    expect(corrida.status).toBe(2);
    expect(corrida.stdout).toContain("no es una carpeta");
  });
});
