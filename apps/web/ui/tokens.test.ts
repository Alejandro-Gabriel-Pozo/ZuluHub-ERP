import { describe, expect, it } from "vitest";
import css from "./tokens.css?raw";
import { contraste } from "./pruebas/contraste";

/**
 * Los tokens son el único lugar con valores de color, tamaño, capa y duración. Se prueban sobre el texto de
 * `tokens.css`:
 *  - los de estado (peligro, éxito, aviso, info) nunca toman un valor de marca ([01] §4.1);
 *  - los cuatro puentes `--brand-*` son los únicos hacia la marca y sus valores por defecto son legibles;
 *  - los componentes no escriben colores, radios, capas ni duraciones sueltas, y no hay píldoras: las esquinas
 *    tienen tope de 20 px (decisión del dueño);
 *  - un token sin ningún consumidor se elimina (o se justifica acá, por escrito);
 *  - todos los pares de color que usan los componentes pasan el contraste mínimo (4,5:1 para texto, 3:1 para lo
 *    que no es texto) con CADA superficie del aspecto de la marca (neutra, cálida y fría), además de lo que mide
 *    axe sobre cada componente renderizado;
 *  - el objetivo táctil de operación es de 48 px y hay respeto de `prefers-reduced-motion`.
 */

function declaracionesDe(bloque: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const m of bloque.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    const nombre = m[1];
    const valor = m[2];
    if (nombre !== undefined && valor !== undefined)
      mapa.set(nombre, valor.trim().replace(/\s+/g, " "));
  }
  return mapa;
}

/** Solo el primer `:root { … }`: los demás bloques (superficies, movimiento reducido) no son los valores base. */
const tokens = declaracionesDe(/^:root\s*\{([\s\S]*?)\n\}/m.exec(css)?.[1] ?? "");

const SUPERFICIES = ["neutra", "calida", "fria"] as const;
type Superficie = (typeof SUPERFICIES)[number];

/** Los tokens tal como valen con esa superficie: la neutra es la base; las otras pisan solo fondo y superficie. */
function tokensConSuperficie(superficie: Superficie): Map<string, string> {
  if (superficie === "neutra") return tokens;
  const bloque = new RegExp(`:root\\[data-superficie="${superficie}"\\]\\s*\\{([^}]*)\\}`).exec(
    css,
  );
  expect(bloque, `falta el bloque de la superficie ${superficie}`).not.toBeNull();
  return new Map([...tokens, ...declaracionesDe(bloque?.[1] ?? "")]);
}

function valorDe(nombre: string, mapa: Map<string, string> = tokens): string {
  const valor = mapa.get(nombre);
  if (valor === undefined) throw new Error(`falta el token ${nombre}`);
  return valor;
}

/** Resuelve `var(--x)` hasta llegar a un `#rrggbb`. */
function colorDe(nombre: string, mapa: Map<string, string> = tokens): string {
  let valor = valorDe(nombre, mapa);
  for (let i = 0; i < 5; i++) {
    const referencia = /^var\((--[a-z0-9-]+)\)$/.exec(valor);
    if (referencia?.[1] === undefined) break;
    valor = valorDe(referencia[1], mapa);
  }
  expect(valor, nombre).toMatch(/^#[0-9a-f]{6}$/);
  return valor;
}

const ESTADOS = ["peligro", "exito", "aviso", "info"] as const;
/** Solo los estados con un fondo SÓLIDO tienen un «sobre-» (texto encima): hoy, peligro (el botón «Anular»). */
const ESTADOS_CON_FONDO_SOLIDO = ["peligro"] as const;

const fuentesCss = import.meta.glob<string>("./**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
});
const cssDeComponentes = Object.entries(fuentesCss).filter(
  ([archivo]) => archivo !== "./tokens.css",
);

// ---------------------------------------------------------------------------------------------------------
// Las reglas, como funciones puras: cada una se prueba abajo con una violación inyectada (si no muerde, no vale).

const declaracionesCss = (
  texto: string,
  propiedad: RegExp,
): { propiedad: string; valor: string }[] =>
  [...texto.matchAll(new RegExp(`(?:^|[;{\\s])(${propiedad.source})\\s*:\\s*([^;}]+)`, "g"))].map(
    (m) => ({ propiedad: m[1] ?? "", valor: (m[2] ?? "").trim() }),
  );

/** Esquinas sueltas: todo valor de `border-*-radius` tiene que ser `0` o un `var(--radio-*)` (nada de `999px`, `50%`, `24px`). */
function radiosSueltos(texto: string): string[] {
  return declaracionesCss(texto, /border(?:-[a-z]+)*-radius/)
    .filter(({ valor }) =>
      valor.split(/\s+/).some((parte) => !/^(?:0|var\(--radio-[a-z-]+\))$/.test(parte)),
    )
    .map(({ propiedad, valor }) => `${propiedad}: ${valor}`);
}

/** Capas sueltas: todo `z-index` tiene que ser un `var(--capa-*)`. */
function capasSueltas(texto: string): string[] {
  return declaracionesCss(texto, /z-index/)
    .filter(({ valor }) => !/^var\(--capa-[a-z-]+\)$/.test(valor))
    .map(({ propiedad, valor }) => `${propiedad}: ${valor}`);
}

/** Duraciones sueltas: ningún tiempo escrito a mano (`120ms`, `0.2s`) en transiciones ni animaciones. */
function duracionesSueltas(texto: string): string[] {
  return declaracionesCss(texto, /(?:transition|animation)(?:-duration|-delay)?/)
    .filter(({ valor }) => /(?<![\w.-])\d*\.?\d+m?s\b/.test(valor))
    .map(({ propiedad, valor }) => `${propiedad}: ${valor}`);
}

describe("reglas del sistema de UI: cada una muerde (violación inyectada)", () => {
  it("esquinas: rechaza la píldora y cualquier radio suelto; acepta 0 y los tokens", () => {
    expect(radiosSueltos(".a { border-radius: 999px; }")).toEqual(["border-radius: 999px"]);
    expect(radiosSueltos(".a { border-radius: 9999px }")).toHaveLength(1);
    expect(radiosSueltos(".a{border-radius:50%}")).toHaveLength(1);
    expect(radiosSueltos(".a { border-radius: 24px; }")).toHaveLength(1);
    expect(radiosSueltos(".a { border-top-left-radius: 1rem; }")).toHaveLength(1);
    expect(radiosSueltos(".a { border-radius: var(--radio-base) 4px 0 0; }")).toHaveLength(1);
    expect(radiosSueltos(".a { border-radius: 0; }")).toEqual([]);
    expect(radiosSueltos(".a { border-radius: var(--radio-grande); }")).toEqual([]);
    expect(
      radiosSueltos(".a { border-radius: var(--radio-grande) var(--radio-grande) 0 0; }"),
    ).toEqual([]);
  });

  it("capas: rechaza un z-index suelto; acepta la escala", () => {
    expect(capasSueltas(".a { z-index: 30; }")).toEqual(["z-index: 30"]);
    expect(capasSueltas(".a { position: sticky; z-index:1 }")).toEqual(["z-index: 1"]);
    expect(capasSueltas(".a { z-index: var(--capa-franja-de-aviso); }")).toEqual([]);
  });

  it("duraciones: rechaza un tiempo escrito a mano; acepta los tokens", () => {
    expect(duracionesSueltas(".a { transition: opacity 120ms ease; }")).toHaveLength(1);
    expect(duracionesSueltas(".a { animation: girar 1s linear; }")).toHaveLength(1);
    expect(duracionesSueltas(".a { transition-duration: 0.2s; }")).toHaveLength(1);
    expect(duracionesSueltas(".a { transition: opacity var(--duracion-corta) ease; }")).toEqual([]);
    expect(duracionesSueltas(".a { animation: none; }")).toEqual([]);
  });
});

describe("tokens: marca y estado", () => {
  it("lee los tokens del archivo", () => {
    expect(tokens.size).toBeGreaterThan(40);
  });

  it.each(ESTADOS)("los tokens de %s nunca toman un valor de marca", (estado) => {
    const nombres = [`--color-${estado}`, `--color-${estado}-suave`];
    if ((ESTADOS_CON_FONDO_SOLIDO as readonly string[]).includes(estado))
      nombres.push(`--color-sobre-${estado}`);
    for (const nombre of nombres) {
      expect(valorDe(nombre), nombre).not.toContain("brand");
      expect(valorDe(nombre), nombre).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("los puentes hacia la marca son exactamente cuatro", () => {
    const puentes = [...tokens.keys()].filter((n) => n.startsWith("--brand-")).sort();
    expect(puentes).toEqual([
      "--brand-accent",
      "--brand-on-primary",
      "--brand-primary",
      "--brand-secondary",
    ]);
  });

  it("solo la acción primaria, el acento y el secundario leen de la marca", () => {
    const leen = [...tokens.entries()]
      .filter(([nombre, valor]) => !nombre.startsWith("--brand-") && valor.includes("--brand-"))
      .map(([nombre]) => nombre)
      .sort();
    expect(leen).toEqual([
      "--accion-primaria-fondo",
      "--accion-primaria-texto",
      "--acento",
      "--secundario",
    ]);
  });

  it("las superficies solo pisan el fondo y la superficie: nada más cambia de color", () => {
    for (const superficie of SUPERFICIES) {
      const mapa = tokensConSuperficie(superficie);
      const cambiados = [...mapa.entries()].filter(([n, v]) => tokens.get(n) !== v).map(([n]) => n);
      expect(cambiados.sort(), superficie).toEqual(
        superficie === "neutra" ? [] : ["--color-fondo", "--color-superficie"],
      );
    }
  });
});

describe("tokens: los componentes solo usan tokens", () => {
  it("el CSS de los componentes no escribe un color suelto", () => {
    expect(cssDeComponentes.length).toBeGreaterThan(10);
    for (const [archivo, texto] of cssDeComponentes) {
      expect(texto, archivo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(texto, archivo).not.toMatch(/\brgba?\(/);
      expect(texto, archivo).not.toMatch(/--brand-/);
    }
  });

  it("ni una esquina suelta (ninguna píldora), ni una capa suelta, ni una duración suelta", () => {
    for (const [archivo, texto] of cssDeComponentes) {
      expect(radiosSueltos(texto), `${archivo}: esquinas`).toEqual([]);
      expect(capasSueltas(texto), `${archivo}: capas`).toEqual([]);
      expect(duracionesSueltas(texto), `${archivo}: duraciones`).toEqual([]);
    }
  });

  it("las esquinas tienen tope de 20 px: ningún radio del sistema lo pasa", () => {
    const radios = [...tokens.entries()].filter(([nombre]) => nombre.startsWith("--radio-"));
    expect(radios.length).toBeGreaterThanOrEqual(3);
    for (const [nombre, valor] of radios) {
      expect(valor, nombre).toMatch(/^[0-9.]+rem$/);
      expect(parseFloat(valor) * 16, nombre).toBeLessThanOrEqual(20);
    }
  });

  it("las capas son una escala corta de enteros distintos", () => {
    const capas = [...tokens.entries()].filter(([nombre]) => nombre.startsWith("--capa-"));
    expect(capas.length).toBeGreaterThanOrEqual(2);
    expect(capas.length).toBeLessThanOrEqual(5);
    const numeros = capas.map(([, valor]) => Number(valor));
    for (const numero of numeros) expect(Number.isInteger(numero) && numero >= 1).toBe(true);
    expect(new Set(numeros).size).toBe(numeros.length);
  });
});

describe("tokens: ninguno sin consumidor", () => {
  /**
   * Los que se dejan sin consumidor A PROPÓSITO, con el motivo. Cada uno tiene que seguir sin usos (si alguien
   * lo empieza a usar, se saca de acá) y existir. Agregar uno requiere una razón de contrato, no de comodidad.
   */
  const JUSTIFICADOS: Readonly<Record<string, string>> = {
    "--secundario":
      "puente reservado: hoy sin consumidores; borrarlo cambiaría el contrato de los cuatro puentes de la marca",
  };

  const fuentes = import.meta.glob<string>(
    ["../**/*.{css,ts,tsx}", "!../.next/**", "!../**/*.test.{ts,tsx}"],
    { query: "?raw", import: "default", eager: true },
  );

  const usos = (nombre: string): number =>
    Object.values(fuentes).reduce(
      (suma, texto) =>
        suma + [...texto.matchAll(new RegExp(`var\\(\\s*${nombre}(?![a-z0-9-])`, "g"))].length,
      0,
    );

  it("lee los fuentes de la web", () => {
    expect(Object.keys(fuentes).length).toBeGreaterThan(50);
    expect(Object.keys(fuentes).some((a) => a.endsWith("/tokens.css"))).toBe(true);
  });

  it("todo token declarado se usa al menos una vez, o está justificado", () => {
    const sinUso = [...tokens.keys()].filter(
      (nombre) => usos(nombre) === 0 && !(nombre in JUSTIFICADOS),
    );
    expect(sinUso).toEqual([]);
  });

  it("la lista de justificados no se pudre: existen y siguen sin usos", () => {
    for (const nombre of Object.keys(JUSTIFICADOS)) {
      expect(tokens.has(nombre), nombre).toBe(true);
      expect(usos(nombre), nombre).toBe(0);
    }
  });
});

describe("tokens: contraste de cada combinación (cada superficie del aspecto)", () => {
  const FONDOS_DE_TEXTO = ["--color-fondo", "--color-superficie", "--color-superficie-elevada"];

  const textoSobre: [string, string][] = [
    ...["--color-texto", "--color-texto-suave"].flatMap((t): [string, string][] =>
      FONDOS_DE_TEXTO.map((f) => [t, f]),
    ),
    ["--color-sobre-deshabilitado", "--color-deshabilitado"],
    ["--accion-primaria-texto", "--accion-primaria-fondo"],
    ["--brand-on-primary", "--brand-primary"],
    ["--brand-secondary", "--color-fondo"],
    ["--brand-secondary", "--color-superficie"],
    ...ESTADOS_CON_FONDO_SOLIDO.map((e): [string, string] => [
      `--color-sobre-${e}`,
      `--color-${e}`,
    ]),
    ...ESTADOS.flatMap((e): [string, string][] => [
      [`--color-${e}`, "--color-fondo"],
      [`--color-${e}`, "--color-superficie"],
      [`--color-${e}`, `--color-${e}-suave`],
      ["--color-texto", `--color-${e}-suave`],
      ["--color-texto-suave", `--color-${e}-suave`],
    ]),
  ];

  const noTextoSobre: [string, string][] = [
    ["--color-borde", "--color-fondo"],
    ["--color-borde", "--color-superficie"],
    ["--color-foco", "--color-fondo"],
    ["--color-foco", "--color-superficie"],
    ["--brand-primary", "--color-fondo"],
    ["--brand-primary", "--color-superficie"],
    ["--brand-accent", "--color-fondo"],
    ["--brand-accent", "--color-superficie"],
  ];

  describe.each(SUPERFICIES)("superficie %s", (superficie) => {
    const mapa = tokensConSuperficie(superficie);

    it.each(textoSobre)("%s sobre %s llega a 4,5:1", (texto, fondo) => {
      expect(contraste(colorDe(texto, mapa), colorDe(fondo, mapa))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(noTextoSobre)("lo que no es texto, %s sobre %s, llega a 3:1", (objeto, fondo) => {
      expect(contraste(colorDe(objeto, mapa), colorDe(fondo, mapa))).toBeGreaterThanOrEqual(3);
    });
  });

  it("la prueba muerde: un par que no llega se detecta", () => {
    expect(contraste("#777777", "#808080")).toBeLessThan(4.5);
    expect(contraste("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});

describe("tokens: toque, foco y movimiento", () => {
  const px = (nombre: string) => parseFloat(valorDe(nombre)) * 16;

  it("el objetivo mínimo de operación es de 48 px y el de administración no baja de 44", () => {
    expect(px("--objetivo-minimo-operacion")).toBeGreaterThanOrEqual(48);
    expect(px("--objetivo-minimo-administracion")).toBeGreaterThanOrEqual(44);
    expect(px("--objetivo-minimo-administracion")).toBeLessThan(px("--objetivo-minimo-operacion"));
    expect(valorDe("--objetivo-minimo")).toBe("var(--objetivo-minimo-operacion)");
  });

  it("respeta prefers-reduced-motion: las duraciones pasan a cero", () => {
    const bloque =
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(bloque).toMatch(/--duracion-corta:\s*0ms/);
    expect(bloque).toMatch(/--duracion-media:\s*0ms/);
  });

  it("el foco visible tiene doble contorno", () => {
    const regla = /:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(regla).toMatch(/outline:\s*3px solid var\(--color-foco\)/);
    expect(regla).toMatch(/box-shadow:\s*0 0 0 2px var\(--color-fondo\)/);
  });

  it("la fuente es la del sistema: no se descarga ninguna", () => {
    expect(css).not.toMatch(/@font-face|@import|url\(/);
    expect(valorDe("--tipo-familia-cuerpo")).toContain("system-ui");
  });
});
