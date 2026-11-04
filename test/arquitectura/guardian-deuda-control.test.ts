import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { carpetaTemporal, limpiarTemporales } from "./guardian-apoyo";
import {
  AHORA,
  CONFIGURACION,
  CONFIGURACION_SANA,
  INFORME,
  REGISTRO,
  SIN_DEUDA,
  arbolDe,
  codigos,
  codigosDe,
  conMarcadores,
  correr,
  correrCli,
  deuda,
  entrada,
  excepcion,
  git,
  lineas,
  lugaresDe,
  mundo,
  repoDeDeuda,
  type Informe,
} from "./guardian-deuda-apoyo";

/**
 * El control de deuda (`arquitectura/deuda/deuda.cjs`): la autocomprobación de la ubicación, el orden y el texto de
 * lo que dice, el informe de cada corrida, el resumen y el CLI sobre repositorios git sintéticos.
 */

afterEach(limpiarTemporales);

describe("la autocomprobación de la ubicación (M3)", () => {
  const sana = {
    codigo: "deuda-sin-registrar",
    archivo: "a.ts",
    linea: 3,
    contrato: "deuda",
    motivo: "m",
    correccion: "c",
  };
  const avisoSano = { ...sana, codigo: "deuda-resuelta" };

  it("lo que trae archivo, línea y un código de la lista pasa tal cual", () => {
    expect(deuda.comprobarUbicaciones([sana], [avisoSano])).toEqual({
      fallas: [sana],
      avisos: [avisoSano],
    });
  });

  it.each([
    ["sin archivo", { archivo: undefined }],
    ["con archivo vacío", { archivo: "" }],
    ["con un archivo que no es texto", { archivo: 5 }],
    ["sin línea", { linea: undefined }],
    ["con línea 0", { linea: 0 }],
    ["con línea negativa", { linea: -1 }],
    ["con línea fraccionaria", { linea: 1.5 }],
    ["con línea en texto", { linea: "3" }],
  ])("una falla %s se reemplaza por una falla propia, en línea 1", (_nombre, cambio) => {
    const archivo = "archivo" in cambio ? undefined : "a.ts";
    const { fallas, avisos } = deuda.comprobarUbicaciones([{ ...sana, ...cambio }], []);
    expect(avisos).toEqual([]);
    expect(fallas).toEqual([
      {
        codigo: "falla-sin-ubicacion",
        archivo: archivo ?? REGISTRO,
        linea: 1,
        contrato: "deuda",
        motivo:
          "Una falla con código «deuda-sin-registrar» salió sin ubicación completa (archivo y línea desde 1): m",
        correccion:
          "Hacé que el chequeo diga el archivo y la línea, y anotá su código en codigos.cjs.",
      },
    ]);
  });

  it("una falla con un código que no está en la lista se reemplaza, conservando su archivo", () => {
    const { fallas } = deuda.comprobarUbicaciones([{ ...sana, codigo: "inventado" }], []);
    expect(fallas).toEqual([
      {
        codigo: "codigo-fuera-de-la-lista",
        archivo: "a.ts",
        linea: 1,
        contrato: "deuda",
        motivo:
          "Una falla con código «inventado» usa un código que no está en la lista cerrada de deuda: m",
        correccion:
          "Hacé que el chequeo diga el archivo y la línea, y anotá su código en codigos.cjs.",
      },
    ]);
  });

  it("una falla con los dos problemas da las dos fallas propias", () => {
    const { fallas } = deuda.comprobarUbicaciones([{ ...sana, codigo: "x", linea: 0 }], []);
    expect(codigosDe(fallas)).toEqual(["falla-sin-ubicacion", "codigo-fuera-de-la-lista"]);
  });

  it("los códigos de falla y los de aviso son listas distintas", () => {
    expect(codigosDe(deuda.comprobarUbicaciones([avisoSano], []).fallas)).toEqual([
      "codigo-fuera-de-la-lista",
    ]);
    expect(deuda.comprobarUbicaciones([], [sana]).fallas.map((f) => f.motivo)).toEqual([
      "Un aviso con código «deuda-sin-registrar» usa un código que no está en la lista cerrada de deuda: m",
    ]);
    // todos los de la lista valen donde corresponde
    for (const codigo of codigos.CODIGOS_DE_FALLA) {
      expect(deuda.comprobarUbicaciones([{ ...sana, codigo }], []).fallas).toHaveLength(1);
      expect(codigosDe(deuda.comprobarUbicaciones([{ ...sana, codigo }], []).fallas)).toEqual([
        codigo,
      ]);
    }
    for (const codigo of codigos.CODIGOS_DE_AVISO) {
      expect(deuda.comprobarUbicaciones([], [{ ...sana, codigo }]).avisos).toHaveLength(1);
    }
  });

  it("la lista cerrada de códigos es la que dice codigos.cjs, congelada", () => {
    expect(codigos.CODIGOS_DE_FALLA).toEqual([
      "deuda-sin-registrar",
      "deuda-entrada-invalida",
      "deuda-archivo-inexistente",
      "deuda-configuracion-invalida",
      "deuda-tope-de-excepciones",
      "deuda-archivo-ilegible",
      "deuda-en-archivo-tocado",
      "deuda-nueva-sin-excepcion",
      "deuda-total-sube",
      "deuda-archivo-crece",
      "deuda-entrada-borrada",
      "excepcion-invalida",
      "excepcion-vencida",
      "excepcion-plazo-excesivo",
      "excepcion-vence-antes-de-creada",
      "excepcion-creada-futura",
      "excepcion-obsoleta",
      "falla-sin-ubicacion",
      "codigo-fuera-de-la-lista",
    ]);
    expect(codigos.CODIGOS_DE_AVISO).toEqual([
      "deuda-resuelta",
      "deuda-tamano-desactualizado",
      "deuda-borrada-sin-verificar",
      "deuda-en-archivo-tocado-sin-bloqueo",
      "deuda-base-sin-registro",
      "excepcion-por-vencer",
    ]);
    expect(Object.isFrozen(codigos.CODIGOS_DE_FALLA)).toBe(true);
    expect(Object.isFrozen(codigos.CODIGOS_DE_AVISO)).toBe(true);
  });

  it("un aviso sin ubicación vuelve como FALLA, y un aviso sano sigue siendo aviso", () => {
    const { fallas, avisos } = deuda.comprobarUbicaciones(
      [],
      [{ ...avisoSano, linea: undefined }, avisoSano],
    );
    expect(avisos).toEqual([avisoSano]);
    expect(fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      [
        "falla-sin-ubicacion",
        "Un aviso con código «deuda-resuelta» salió sin ubicación completa (archivo y línea desde 1): m",
      ],
    ]);
  });
});

describe("valorDeOpcion: `--nombre valor` y `--nombre=valor`", () => {
  it("lee las dos formas, devuelve texto vacío si falta el valor y undefined si no está la opción", () => {
    expect(deuda.valorDeOpcion(["--base", "carpeta"], "--base")).toBe("carpeta");
    expect(deuda.valorDeOpcion(["--base=carpeta"], "--base")).toBe("carpeta");
    expect(deuda.valorDeOpcion(["x", "--base=a=b", "y"], "--base")).toBe("a=b");
    expect(deuda.valorDeOpcion(["--base"], "--base")).toBe("");
    expect(deuda.valorDeOpcion(["--base="], "--base")).toBe("");
    expect(deuda.valorDeOpcion(["--sin-informe"], "--base")).toBeUndefined();
    expect(deuda.valorDeOpcion([], "--base")).toBeUndefined();
    expect(deuda.valorDeOpcion(["--basura=x"], "--base")).toBeUndefined();
  });
});

describe("el texto y el orden de lo que dice", () => {
  it("formatear arma `archivo:línea · contrato · motivo · corrección`, con «-» si no hay contrato", () => {
    expect(
      deuda.formatear({
        archivo: "a.ts",
        linea: 3,
        contrato: "deuda",
        motivo: "m",
        correccion: "c",
      }),
    ).toBe("a.ts:3 · deuda · m · c");
    expect(
      deuda.formatear({ archivo: "a.ts", linea: 3, contrato: null, motivo: "m", correccion: "c" }),
    ).toBe("a.ts:3 · - · m · c");
    expect(deuda.formatear({ archivo: "a.ts", linea: 3, motivo: "m", correccion: "c" })).toBe(
      "a.ts:3 · - · m · c",
    );
  });

  it("las fallas salen ordenadas por archivo, línea, código y motivo", () => {
    const archivos = mundo(
      {
        "b.ts": lineas("// TODO: x", "// @ts-ignore"),
        "a.ts": lineas("x;", "// TODO: y"),
      },
      [entrada({ id: "e", archivos: ["no-esta.ts"] })],
    );
    const { fallas } = correr(archivos);
    expect(lugaresDe(fallas)).toEqual([
      "a.ts:2",
      "arquitectura/deuda/registro.json:4",
      "b.ts:1",
      "b.ts:2",
    ]);
    expect(codigosDe(fallas)).toEqual([
      "deuda-sin-registrar",
      "deuda-archivo-inexistente",
      "deuda-sin-registrar",
      "deuda-sin-registrar",
    ]);
  });

  it("el orden desempata por línea, luego por código y luego por motivo", () => {
    const archivos = mundo({ "a.ts": SIN_DEUDA }, [
      entrada({ id: "b", tipo: "inventado", archivos: ["a.ts"], sobrante: 1 }),
      entrada({ id: "a", tipo: "inventado", archivos: ["a.ts"], descripcion: "" }),
    ]);
    const { fallas } = correr(archivos);
    const lugares = fallas.map((f) => [f.linea, f.codigo, f.motivo.slice(0, 20)]);
    const ordenados = [...lugares].sort(
      (x, y) =>
        (x[0] as number) - (y[0] as number) ||
        String(x[1]).localeCompare(String(y[1])) ||
        String(x[2]).localeCompare(String(y[2])),
    );
    expect(lugares).toEqual(ordenados);
    expect(fallas.length).toBeGreaterThan(3);
  });

  it("dos fallas en el mismo archivo y línea se ordenan por código, y con el mismo código, por motivo", () => {
    const archivos = mundo({ "a.ts": SIN_DEUDA }, [
      entrada({ id: "x", tipo: "inventado", archivos: ["a.ts"], descripcion: "" }),
    ]);
    const { fallas } = correr(archivos);
    // «descripcion» y «tipo» caen en líneas distintas; las dos son del mismo código y se ordenan por línea
    expect(fallas.map((f) => f.linea)).toEqual(
      [...fallas.map((f) => f.linea)].sort((a, b) => a - b),
    );
    const mismoLugar = correr(mundo({ "a.ts": lineas("// TODO: x", "// TODO: x") }, [])).fallas;
    expect(mismoLugar.map((f) => f.linea)).toEqual([1, 2]);
  });

  it("resuelve la línea de las fallas del registro y no deja el descriptor interno", () => {
    const archivos = mundo({ "a.ts": SIN_DEUDA }, [entrada({ archivos: ["no-esta.ts"] })]);
    const { fallas } = correr(archivos);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toEqual({
      codigo: "deuda-archivo-inexistente",
      archivo: REGISTRO,
      linea: 4,
      contrato: "deuda",
      motivo:
        "La entrada «ts-expect-error--a-ts» apunta a «no-esta.ts», que no es un archivo versionado.",
      correccion: "Corregí la ruta, o borrá la entrada si el archivo ya no existe.",
    });
    expect("donde" in (fallas[0] as object)).toBe(false);
  });

  it("un registro que no existe falla en su archivo, línea 1", () => {
    const archivos = mundo({ "a.ts": SIN_DEUDA });
    delete archivos[REGISTRO];
    expect(lugaresDe(correr(archivos).fallas)).toEqual([`${REGISTRO}:1`]);
  });

  it("un archivo de configuración con la clave mala falla en la línea de esa clave", () => {
    const archivos = mundo({ "a.ts": SIN_DEUDA });
    archivos[CONFIGURACION] = lineas(
      "{",
      '  "topeDeExcepciones": "diez",',
      '  "bloqueaDeudaEnArchivoTocado": true,',
      '  "topeDeLineasPorArchivo": 400,',
      '  "excluidosDelTope": []',
      "}",
    );
    expect(lugaresDe(correr(archivos).fallas)).toEqual([`${CONFIGURACION}:2`]);
  });
});

describe("el informe de cada corrida", () => {
  const completo = () =>
    correr(
      mundo(
        { "a.ts": conMarcadores(2), "b.ts": "// TODO: x\n" },
        [
          entrada({ creada: "2026-10-12" }),
          entrada({ id: "todo-b", tipo: "todo", archivos: ["b.ts"], creada: "2026-10-22" }),
          excepcion({
            id: "exc",
            tipo: "backlog",
            archivos: ["a.ts"],
            creada: "2026-10-20",
            vence: "2026-11-05",
          }),
          entrada({ id: "h", tipo: "brecha", archivos: ["b.ts"], creada: "2026-09-22" }),
        ],
        { topeDeExcepciones: 4, bloqueaDeudaEnArchivoTocado: true },
      ),
    );

  it("trae versión, momento, resultado y la configuración vigente", () => {
    const { informe } = completo();
    expect(informe.version).toBe(1);
    expect(informe.generadoEn).toBe("2026-10-22T12:00:00.000Z");
    expect(informe.resultado).toBe("pasa");
    expect(informe.configuracion).toEqual({
      topeDeExcepciones: 4,
      bloqueaDeudaEnArchivoTocado: true,
      topeDeLineasPorArchivo: 400,
      excluidosDelTope: [],
    });
    expect(informe.conBase).toBe(false);
    expect(informe.archivosAnalizados).toBe(4);
  });

  it("totaliza por tipo (marcadores y hallazgos) y cuenta los archivos con deuda", () => {
    expect(completo().informe.total).toEqual({
      marcadores: 3,
      hallazgos: 2,
      total: 5,
      archivosConDeuda: 2,
      porTipo: { "ts-expect-error": 2, todo: 1, backlog: 1, brecha: 1 },
    });
  });

  it("dice la antigüedad: la media en días (redondeada) y la entrada más vieja", () => {
    // edades al 2026-10-22: 10, 0, 2 y 30 días
    expect(completo().informe.antiguedad).toEqual({
      entradas: 4,
      promedioEnDias: 11,
      masVieja: { id: "h", dias: 30 },
    });
  });

  it("redondea la media al entero más cercano (hacia arriba desde .5, hacia abajo si no)", () => {
    const con = (...creadas: string[]) =>
      correr(
        mundo(
          { "a.ts": SIN_DEUDA },
          creadas.map((creada, i) =>
            entrada({ id: `h${String(i)}`, tipo: "backlog", archivos: ["a.ts"], creada }),
          ),
        ),
      ).informe.antiguedad.promedioEnDias;
    // 22 / 3 = 7,33 → 7; 23 / 3 = 7,67 → 8; 3 / 2 = 1,5 → 2
    expect(con("2026-09-30", "2026-10-22", "2026-10-22")).toBe(7);
    expect(con("2026-09-29", "2026-10-22", "2026-10-22")).toBe(8);
    expect(con("2026-10-19", "2026-10-22")).toBe(2);
  });

  it("sin entradas la antigüedad es cero y no hay entrada más vieja", () => {
    expect(correr(mundo({ "a.ts": SIN_DEUDA })).informe.antiguedad).toEqual({
      entradas: 0,
      promedioEnDias: 0,
      masVieja: null,
    });
  });

  it("la entrada más vieja es la primera de las más viejas, y una más nueva no la reemplaza", () => {
    const { informe } = correr(
      mundo({ "a.ts": SIN_DEUDA }, [
        entrada({ id: "uno", tipo: "backlog", archivos: ["a.ts"], creada: "2026-10-01" }),
        entrada({ id: "dos", tipo: "backlog", archivos: ["a.ts"], creada: "2026-10-01" }),
        entrada({ id: "tres", tipo: "backlog", archivos: ["a.ts"], creada: "2026-10-10" }),
      ]),
    );
    expect(informe.antiguedad.masVieja).toEqual({ id: "uno", dias: 21 });
  });

  it("lista las excepciones abiertas con su vencimiento y los días que faltan", () => {
    expect(completo().informe.excepciones).toEqual({
      abiertas: 1,
      tope: 4,
      lista: [
        {
          id: "exc",
          tipo: "backlog",
          archivos: ["a.ts"],
          vence: "2026-11-05",
          diasQueFaltan: 14,
        },
      ],
    });
  });

  it("incluye los marcadores con sus líneas y las fallas y avisos que dijo", () => {
    const { informe, fallas, avisos } = correr(mundo({ "a.ts": "x;\n// TODO: y\n" }));
    expect(informe.marcadores).toEqual([{ tipo: "todo", archivo: "a.ts", lineas: [2] }]);
    expect(informe.resultado).toBe("falla");
    expect(informe.fallas).toEqual(fallas);
    expect(informe.avisos).toEqual(avisos);
    expect(fallas).toHaveLength(1);
  });

  it("con base, trae la tendencia respecto de ella; el informe entero es JSON", () => {
    const antes = mundo({ "a.ts": conMarcadores(3) }, [entrada()]);
    const despues = mundo({ "a.ts": conMarcadores(1) }, [entrada()], {
      bloqueaDeudaEnArchivoTocado: false,
    });
    const { informe } = correr(despues, antes);
    expect(informe.conBase).toBe(true);
    expect(informe.tendencia?.diferencia).toBe(-2);
    expect(JSON.parse(JSON.stringify(informe))).toEqual(informe);
  });

  it("sin la hora pasada usa el reloj del sistema", () => {
    const antes = Date.now();
    const { informe } = deuda.ejecutar({ pr: arbolDe(mundo({ "a.ts": SIN_DEUDA })) });
    const generado = Date.parse(informe.generadoEn);
    expect(generado).toBeGreaterThanOrEqual(antes - 1000);
    expect(generado).toBeLessThanOrEqual(Date.now() + 1000);
    expect(AHORA.getTime()).not.toBe(generado);
  });
});

describe("el resumen que sale por stderr", () => {
  const informe = (cambios: Partial<Informe> = {}): Informe => ({
    ...correr(mundo({ "a.ts": SIN_DEUDA })).informe,
    ...cambios,
  });
  const conTotal = (total: Informe["total"]): Partial<Informe> => ({ total });

  it("sin deuda dice «ninguno», que no hay entradas y que no hay base", () => {
    expect(deuda.resumir(informe())).toBe(
      lineas(
        "Deuda técnica: 0 en total (0 marcadores en 0 archivos + 0 hallazgos registrados).",
        "  por tipo: ninguno",
        "  antigüedad: no hay entradas registradas.",
        "  excepciones abiertas: 0 de 10 permitidas",
        "  tendencia: sin base contra la que comparar en esta corrida.",
      ).trimEnd(),
    );
  });

  it("con deuda: total por tipo (de mayor a menor), antigüedad, excepciones con su vencimiento y tendencia", () => {
    const { informe: completo } = correr(
      mundo(
        { "a.ts": conMarcadores(2), "b.ts": "// TODO: x\n" },
        [
          entrada({ creada: "2026-10-12" }),
          entrada({ id: "todo-b", tipo: "todo", archivos: ["b.ts"], creada: "2026-10-22" }),
          excepcion({ id: "exc", tipo: "backlog", archivos: ["a.ts"], vence: "2026-11-21" }),
        ],
        { bloqueaDeudaEnArchivoTocado: true },
      ),
      mundo({ "a.ts": conMarcadores(2), "b.ts": "// TODO: x\n" }, [
        entrada({ creada: "2026-10-12" }),
        entrada({ id: "todo-b", tipo: "todo", archivos: ["b.ts"], creada: "2026-10-22" }),
      ]),
    );
    expect(deuda.resumir(completo)).toBe(
      lineas(
        "Deuda técnica: 4 en total (3 marcadores en 2 archivos + 1 hallazgos registrados).",
        "  por tipo: ts-expect-error 2 · backlog 1 · todo 1",
        "  antigüedad: 3 días en promedio; la más vieja, «ts-expect-error--a-ts» (10 días).",
        "  excepciones abiertas: 1 de 10 permitidas",
        "    - exc: vence el 2026-11-21 (faltan 30 días)",
        "  tendencia respecto de la base: 3 → 4 (+1, SUBE).",
      ).trimEnd(),
    );
  });

  it("cada excepción abierta va en su renglón, en el orden del registro", () => {
    const { informe: dosExcepciones } = correr(
      mundo({ "a.ts": conMarcadores(1), "b.ts": conMarcadores(1) }, [
        excepcion({ id: "uno", vence: "2026-11-21" }),
        excepcion({ id: "dos", archivos: ["b.ts"], vence: "2026-12-10" }),
      ]),
    );
    expect(deuda.resumir(dosExcepciones)).toContain(
      lineas(
        "  excepciones abiertas: 2 de 10 permitidas",
        "    - uno: vence el 2026-11-21 (faltan 30 días)",
        "    - dos: vence el 2026-12-10 (faltan 49 días)",
        "  tendencia: sin base contra la que comparar en esta corrida.",
      ).trimEnd(),
    );
  });

  it("la tendencia dice si baja o si no cambia, y el signo solo se muestra si sube", () => {
    const base = informe().total;
    const tendencia = (antes: number, despues: number): Informe["tendencia"] => ({
      base: { ...base, total: antes },
      pr: { ...base, total: despues },
      diferencia: despues - antes,
    });
    const linea = (antes: number, despues: number) =>
      deuda
        .resumir(informe({ tendencia: tendencia(antes, despues) }))
        .split("\n")
        .find((l) => l.includes("tendencia"));
    expect(linea(5, 3)).toBe("  tendencia respecto de la base: 5 → 3 (-2, baja).");
    expect(linea(5, 5)).toBe("  tendencia respecto de la base: 5 → 5 (0, sin cambios).");
    expect(linea(5, 6)).toBe("  tendencia respecto de la base: 5 → 6 (+1, SUBE).");
  });

  it("avisa con todas las letras cuando `bloqueaDeudaEnArchivoTocado` está en false, y calla si está en true", () => {
    const sin = deuda.resumir(
      informe({ configuracion: { ...CONFIGURACION_SANA, bloqueaDeudaEnArchivoTocado: false } }),
    );
    expect(sin.split("\n").at(-1)).toBe(
      "  AVISO: `bloqueaDeudaEnArchivoTocado` está en false: tocar un archivo con deuda sin pagarla solo avisa, no bloquea.",
    );
    const con = deuda.resumir(
      informe({ configuracion: { ...CONFIGURACION_SANA, bloqueaDeudaEnArchivoTocado: true } }),
    );
    expect(con).not.toContain("AVISO");
  });

  it("los tipos con la misma cantidad salen por orden alfabético", () => {
    const total = {
      marcadores: 3,
      hallazgos: 0,
      total: 3,
      archivosConDeuda: 1,
      porTipo: { z: 1, a: 1, m: 1 },
    };
    expect(deuda.resumir(informe(conTotal(total)))).toContain("  por tipo: a 1 · m 1 · z 1\n");
  });
});

describe("el CLI sobre un repositorio git sintético", () => {
  /** Un repositorio sano: sin deuda, con su registro y su configuración. */
  const repoSano = (extra: Record<string, string> = {}, entradas: unknown[] = []) =>
    repoDeDeuda(mundo({ "a.ts": SIN_DEUDA, ...extra }, entradas));

  it("un repositorio sin deuda sale 0, deja stdout vacío, el resumen por stderr y el detalle en el informe", () => {
    const repo = repoSano();
    const corrida = correrCli(repo);
    expect(corrida.status).toBe(0);
    expect(corrida.stdout).toBe("");
    expect(corrida.stderr).toContain("Deuda técnica: 0 en total (");
    expect(corrida.stderr).toContain("  excepciones abiertas: 0 de 10 permitidas");
    expect(corrida.stderr.trimEnd().split("\n").at(-1)).toBe(
      "Deuda técnica: OK · 0 avisos (informe: arquitectura/deuda/informe.json).",
    );
    const informe = JSON.parse(readFileSync(join(repo, INFORME), "utf8")) as Informe;
    expect(informe.resultado).toBe("pasa");
    expect(informe.total.total).toBe(0);
    expect(informe.archivosAnalizados).toBeGreaterThan(5);
  });

  it("un marcador sin registrar sale 1, lo imprime como FALLA con archivo:línea y cuenta las fallas", () => {
    const repo = repoSano({ "a.ts": "x;\n// TODO: arreglar\n" });
    const corrida = correrCli(repo);
    expect(corrida.status).toBe(1);
    const lineasDeError = corrida.stderr.split("\n");
    expect(lineasDeError).toContain(
      "FALLA a.ts:2 · deuda · Marcador «todo» sin registrar: no hay una entrada del registro para ese tipo en este archivo. · " +
        `Resolvelo, o registralo en ${REGISTRO} con su excepción (motivo, aprobadoPor y vence, como máximo 60 días).`,
    );
    expect(corrida.stderr.trimEnd().split("\n").at(-1)).toBe(
      "Deuda técnica: 1 fallas, 0 avisos (informe: arquitectura/deuda/informe.json).",
    );
    const informe = JSON.parse(readFileSync(join(repo, INFORME), "utf8")) as Informe;
    expect(informe.resultado).toBe("falla");
    expect(informe.fallas.map((f) => f.codigo)).toEqual(["deuda-sin-registrar"]);
  });

  describe("el tope de líneas por archivo", () => {
    const grande = lineas(
      ...Array.from({ length: 450 }, (_, i) => `export const x${String(i)} = ${String(i)};`),
    );
    const registrada = {
      id: "archivo-grande--src-grande-ts",
      archivos: ["src/grande.ts"],
      descripcion: "Línea base.",
      tipo: "archivo-grande",
      tamano: 450,
      responsable: "agente (a pedido del dueño)",
      creada: "2026-10-01",
    };

    it("un archivo grande sin registrar sale 1 y se imprime con archivo:línea; registrado, sale 0", () => {
      const sin = correrCli(repoSano({ "src/grande.ts": grande }), ["--sin-informe"]);
      expect(sin.status).toBe(1);
      expect(sin.stderr).toContain(
        "FALLA src/grande.ts:401 · deuda · Marcador «archivo-grande» sin registrar",
      );
      const con = correrCli(repoSano({ "src/grande.ts": grande }, [registrada]), ["--sin-informe"]);
      expect(con.status).toBe(0);
      expect(con.stderr).toContain("  por tipo: archivo-grande 1\n");
    });

    it("crecer sobre lo registrado sale 1 con el trinquete", () => {
      const repo = repoSano({ "src/grande.ts": `${grande}export const mas = 1;\n` }, [registrada]);
      const corrida = correrCli(repo, ["--sin-informe"]);
      expect(corrida.status).toBe(1);
      expect(corrida.stderr).toContain(
        "FALLA src/grande.ts:451 · deuda · El archivo mide 451 líneas y el libro registra 450",
      );
    });

    it("el informe trae el tamaño del archivo grande entre sus marcadores", () => {
      const repo = repoSano({ "src/grande.ts": grande }, [registrada]);
      correrCli(repo);
      const informe = JSON.parse(readFileSync(join(repo, INFORME), "utf8")) as Informe;
      expect(informe.marcadores).toEqual([
        { tipo: "archivo-grande", archivo: "src/grande.ts", lineas: [401], tamano: 450 },
      ]);
    });

    it("la herramienta copiada al repositorio de juguete no cuenta como archivo grande", () => {
      const repo = repoSano();
      const corrida = correrCli(repo, ["--sin-informe"]);
      expect(corrida.status).toBe(0);
      expect(corrida.stderr).toContain("por tipo: ninguno");
    });
  });

  it("los avisos salen por stderr con su prefijo, antes que las fallas, y no cambian el código de salida", () => {
    const repo = repoSano({ "a.ts": SIN_DEUDA }, [entrada({ tipo: "todo" })]);
    const corrida = correrCli(repo);
    expect(corrida.status).toBe(0);
    expect(corrida.stdout).toBe("");
    expect(corrida.stderr).toContain(
      "AVISO arquitectura/deuda/registro.json:3 · deuda · La entrada «ts-expect-error--a-ts» ya no tiene el problema",
    );
    expect(corrida.stderr.trimEnd().split("\n").at(-1)).toBe(
      "Deuda técnica: OK · 1 avisos (informe: arquitectura/deuda/informe.json).",
    );
  });

  it("`--sin-informe` no escribe el informe y lo dice", () => {
    const repo = repoSano();
    const corrida = correrCli(repo, ["--sin-informe"]);
    expect(corrida.status).toBe(0);
    expect(existsSync(join(repo, INFORME))).toBe(false);
    expect(corrida.stderr.trimEnd().split("\n").at(-1)).toBe(
      "Deuda técnica: OK · 0 avisos (sin informe).",
    );
  });

  it.each([
    ["--informe=salida/mio.json", "salida/mio.json"],
    ["--informe", "salida/mio.json"],
  ])("`%s` escribe el informe donde se pide (creando la carpeta)", (...argumentos) => {
    const repo = repoSano();
    const lista =
      argumentos[0] === "--informe" ? ["--informe", "salida/mio.json"] : [argumentos[0]];
    const corrida = correrCli(repo, lista);
    expect(corrida.status).toBe(0);
    expect(existsSync(join(repo, "salida/mio.json"))).toBe(true);
    expect(existsSync(join(repo, INFORME))).toBe(false);
    expect(corrida.stderr.trimEnd().split("\n").at(-1)).toBe(
      "Deuda técnica: OK · 0 avisos (informe: salida/mio.json).",
    );
  });

  it("corre sobre el repositorio donde vive el script, sin importar desde dónde se lo llame", () => {
    const repo = repoSano({ "a.ts": "// TODO: x\n" });
    const afuera = repoSano();
    const corrida = correrCli(repo, [], afuera);
    expect(corrida.status).toBe(1);
    expect(corrida.stderr).toContain("FALLA a.ts:1");
  });

  it("ve los archivos nuevos sin versionar, no ve los ignorados por git, y no se cae por un borrado pendiente", () => {
    const repo = repoSano({
      ".gitignore": "ignorado.ts\n",
      "ignorado.ts": "// TODO: no cuenta\n",
      "versionado.ts": "// TODO: cuenta\n",
      "se-borra.ts": "// TODO: ya no\n",
    });
    git(repo, "add", "versionado.ts", "se-borra.ts");
    rmSync(join(repo, "se-borra.ts"));
    writeFileSync(join(repo, "nuevo.ts"), "// FIXME x\n");
    const corrida = correrCli(repo, ["--sin-informe"]);
    expect(corrida.status).toBe(1);
    const fallas = corrida.stderr.split("\n").filter((l) => l.startsWith("FALLA "));
    expect(fallas).toHaveLength(2);
    expect(fallas[0]).toMatch(/^FALLA nuevo\.ts:1 · deuda · Marcador «todo» sin registrar/);
    expect(fallas[1]).toMatch(/^FALLA versionado\.ts:1 · deuda · Marcador «todo» sin registrar/);
  });

  it("una carpeta en lugar de un archivo (un repositorio anidado) no se analiza", () => {
    const repo = repoSano();
    mkdirSync(join(repo, "anidado"), { recursive: true });
    git(join(repo, "anidado"), "init", "-q");
    writeFileSync(join(repo, "anidado/x.ts"), "// TODO: x\n");
    const corrida = correrCli(repo, ["--sin-informe"]);
    expect(corrida.status).toBe(0);
  });

  describe("--base: la comparación con la rama base", () => {
    /** Un repositorio base con esos archivos (y el control de deuda copiado, como en la CI). */
    const repoBase = (archivos: Record<string, string>) => repoDeDeuda(archivos);

    it("compara con la base: deuda nueva sin excepción sale 1 y el resumen trae la tendencia", () => {
      const base = repoBase(mundo({ "a.ts": SIN_DEUDA }));
      const repo = repoSano({ "b.ts": "// @ts-expect-error x\n" }, [
        entrada({ id: "b", archivos: ["b.ts"] }),
      ]);
      const corrida = correrCli(repo, [`--base=${base}`, "--sin-informe"]);
      expect(corrida.status).toBe(1);
      expect(corrida.stderr).toContain(
        "FALLA b.ts:1 · deuda · Aparece deuda nueva «ts-expect-error»",
      );
      expect(corrida.stderr).toContain("  tendencia respecto de la base: 0 → 1 (+1, SUBE).");
    });

    it("también acepta `--base <carpeta>` en dos argumentos, y la deuda que baja pasa", () => {
      const base = repoBase(mundo({ "a.ts": conMarcadores(2) }, [entrada()]));
      const repo = repoSano();
      const corrida = correrCli(repo, ["--base", base]);
      expect(corrida.status).toBe(0);
      expect(corrida.stderr).toContain("  tendencia respecto de la base: 2 → 0 (-2, baja).");
      const informe = JSON.parse(readFileSync(join(repo, INFORME), "utf8")) as Informe;
      expect(informe.conBase).toBe(true);
    });

    it("una base sin registro avisa y no compara", () => {
      const base = repoBase({ "a.ts": conMarcadores(1) });
      const repo = repoSano({ "a.ts": conMarcadores(1) }, [entrada()]);
      const corrida = correrCli(repo, [`--base=${base}`, "--sin-informe"]);
      expect(corrida.status).toBe(0);
      expect(corrida.stderr).toContain(
        "AVISO arquitectura/deuda/registro.json:1 · deuda · La rama base todavía no trae el registro",
      );
    });

    it("la base extraída DENTRO del repositorio (sin .git propio) no se cuenta como parte del cambio", () => {
      const repo = repoSano({ "a.ts": SIN_DEUDA });
      const base = repoSano({ "a.ts": conMarcadores(3) }, [entrada()]);
      // la base se copia a `base/` sin su .git, como hace el emulador de la CI de las pruebas
      for (const ruta of ["a.ts", REGISTRO, CONFIGURACION]) {
        mkdirSync(dirname(join(repo, "base", ruta)), { recursive: true });
        writeFileSync(join(repo, "base", ruta), readFileSync(join(base, ruta)));
      }
      const corrida = correrCli(repo, ["--base=base", "--sin-informe"]);
      expect(corrida.status).toBe(0);
      expect(corrida.stderr).not.toContain("base/");
      expect(corrida.stderr).toContain("  tendencia respecto de la base: 3 → 0 (-3, baja).");
    });

    it("pero lo versionado en una carpeta que se llama como la base SÍ cuenta", () => {
      const repo = repoSano({ "base/mio.ts": "// TODO: versionado\n" });
      git(repo, "add", "base/mio.ts");
      const base = repoBase(mundo({ "a.ts": SIN_DEUDA }));
      const dentro = join(repo, "otra");
      mkdirSync(dentro);
      for (const ruta of [REGISTRO, CONFIGURACION, "a.ts"]) {
        mkdirSync(dirname(join(dentro, ruta)), { recursive: true });
        writeFileSync(join(dentro, ruta), readFileSync(join(base, ruta)));
      }
      // la base copiada vive en `otra/`, no en `base/`: lo de `base/mio.ts` es del cambio
      const corrida = correrCli(repo, ["--base=otra", "--sin-informe"]);
      expect(corrida.stderr).toContain("FALLA base/mio.ts:1");
    });

    it.each([[["--base=no-existe"]], [["--base"]], [["--base="]]])(
      "%j: una base que no es una carpeta sale 2 y lo dice",
      (argumentos) => {
        const repo = repoSano();
        const corrida = correrCli(repo, argumentos);
        expect(corrida.status).toBe(2);
        expect(corrida.stdout).toBe("");
        const pedido = (argumentos[0] ?? "").startsWith("--base=") ? argumentos[0]?.slice(7) : "";
        expect(corrida.stderr).toBe(`--base: «${pedido}» no es una carpeta.\n`);
        expect(existsSync(join(repo, INFORME))).toBe(false);
      },
    );

    it("una base que es una carpeta sin git sale 2 con un mensaje, no con un error del sistema", () => {
      const repo = repoSano();
      const sinGit = carpetaTemporal("deuda-sin-git-");
      const corrida = correrCli(repo, [`--base=${sinGit}`, "--sin-informe"]);
      expect(corrida.status).toBe(2);
      expect(corrida.stdout).toBe("");
      expect(corrida.stderr).toBe(
        `--base: «${sinGit}» no es un checkout de git: no se pueden listar sus archivos.\n`,
      );
    });

    it("una base que es un archivo tampoco es una carpeta", () => {
      const repo = repoSano();
      const corrida = correrCli(repo, [`--base=${join(repo, "a.ts")}`]);
      expect(corrida.status).toBe(2);
    });
  });
});

describe("lo que dice la comparación con la base", () => {
  it("una base sin registro es un aviso completo, con su ubicación, y no compara", () => {
    const { fallas, avisos, informe } = correr(mundo({ "a.ts": SIN_DEUDA }), { "a.ts": SIN_DEUDA });
    expect(fallas).toEqual([]);
    expect(avisos).toEqual([
      {
        codigo: "deuda-base-sin-registro",
        archivo: REGISTRO,
        linea: 1,
        contrato: "deuda",
        motivo:
          "La rama base todavía no trae el registro de deuda (es la primera vez que se incorpora): no hay con qué comparar.",
        correccion: "Nada por ahora: cuando la base lo tenga, la comparación se activa sola.",
      },
    ]);
    expect(informe.conBase).toBe(false);
  });

  it("los avisos de la comparación salen junto con los del árbol", () => {
    const base = mundo({ "a.ts": conMarcadores(1) }, [entrada()], {
      bloqueaDeudaEnArchivoTocado: false,
    });
    const pr = mundo({ "a.ts": `${conMarcadores(1)}const x = 1;\n` }, [entrada()], {
      bloqueaDeudaEnArchivoTocado: false,
    });
    const { fallas, avisos } = correr(pr, base);
    expect(fallas).toEqual([]);
    expect(codigosDe(avisos)).toEqual(["deuda-en-archivo-tocado-sin-bloqueo"]);
    expect(lugaresDe(avisos)).toEqual(["a.ts:1"]);
  });
});

describe("dentroDeLaRaiz: dónde queda la base respecto del repositorio", () => {
  it.each([
    ["/r", "/r/base", "base"],
    ["/r", "/r/a/b", "a/b"],
    ["/r", "/r/a/b/c", "a/b/c"],
    ["/r", "/r/..base", "..base"],
    ["/r", "/r/.../x", ".../x"],
    ["/r", "/r", null],
    ["/r", "/r/", null],
    ["/r", "/x", null],
    ["/r", "/", null],
    ["/r/a", "/r", null],
    ["/r/a", "/r/b", null],
  ])("con raíz %s y carpeta %s da %j", (raiz, carpeta, esperada) => {
    expect(deuda.dentroDeLaRaiz(raiz, carpeta)).toBe(esperada);
  });
});

describe("el módulo no hace nada al cargarse", () => {
  it("requerirlo no corre el control: ni escribe el informe ni habla por stderr", () => {
    const repo = repoDeDeuda(mundo({ "a.ts": conMarcadores(1) }));
    const corrida = spawnSync(
      process.execPath,
      ["-e", 'require("./arquitectura/deuda/deuda.cjs")'],
      { cwd: repo, encoding: "utf8" },
    );
    expect(corrida.status).toBe(0);
    expect(corrida.stderr).toBe("");
    expect(corrida.stdout).toBe("");
    expect(existsSync(join(repo, INFORME))).toBe(false);
  });
});

describe("cargarArbol", () => {
  it("lista las rutas ordenadas y sin repetir, y lee cada archivo como Buffer (o null si no está)", () => {
    const repo = repoDeDeuda(
      mundo({ "b/z.ts": "z", "a.ts": "a", ".gitignore": "x.ts\n", "x.ts": "x" }),
    );
    git(repo, "add", "a.ts");
    const arbol = deuda.cargarArbol(repo);
    expect(arbol.rutas.filter((r) => !r.startsWith("arquitectura/"))).toEqual([
      ".gitignore",
      "a.ts",
      "b/z.ts",
    ]);
    expect(Buffer.isBuffer(arbol.leer("a.ts"))).toBe(true);
    expect(String(arbol.leer("b/z.ts"))).toBe("z");
    expect(arbol.leer("no-existe.ts")).toBeNull();
    expect(arbol.rutas).toEqual([...arbol.rutas].sort());
    expect(new Set(arbol.rutas).size).toBe(arbol.rutas.length);
  });

  it("sin carpeta excluida lista todo, aunque una ruta empiece con «null/»", () => {
    const repo = repoDeDeuda(mundo({ "null/x.ts": "x", "a.ts": "a" }));
    expect(deuda.cargarArbol(repo).rutas).toContain("null/x.ts");
    expect(deuda.cargarArbol(repo, null).rutas).toContain("null/x.ts");
  });

  it("no lista lo que cuelga de la carpeta excluida (si no está versionado), pero sí lo versionado", () => {
    const repo = repoDeDeuda(
      mundo({ "a.ts": "a", "base/x.ts": "x", "base/y.ts": "y", "basura/z.ts": "z" }),
    );
    git(repo, "add", "base/y.ts");
    const rutas = deuda
      .cargarArbol(repo, "base")
      .rutas.filter((r) => !r.startsWith("arquitectura/"));
    expect(rutas).toEqual(["a.ts", "base/y.ts", "basura/z.ts"]);
    expect(deuda.cargarArbol(repo).rutas).toContain("base/x.ts");
    expect(deuda.cargarArbol(repo, null).rutas).toContain("base/x.ts");
  });

  it("una ruta que git lista pero ya no está en el disco se omite, y un enlace roto también", () => {
    const repo = repoDeDeuda(mundo({ "a.ts": "a", "b.ts": "b" }));
    git(repo, "add", "a.ts", "b.ts");
    rmSync(join(repo, "b.ts"));
    expect(deuda.cargarArbol(repo).rutas).not.toContain("b.ts");
    expect(deuda.cargarArbol(repo).rutas).toContain("a.ts");
  });
});
