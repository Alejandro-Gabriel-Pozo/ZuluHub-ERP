import { describe, expect, it } from "vitest";
import css from "./tokens.css?raw";

/**
 * Los tokens son el único lugar con valores de color y tamaño. Se prueban sobre el texto de `tokens.css`:
 *  - los de estado (peligro, éxito, aviso, info) nunca toman un valor de marca ([01] §4.1);
 *  - los cuatro puentes `--brand-*` son los únicos hacia la marca y sus valores por defecto son legibles;
 *  - todos los pares de color que usan los componentes pasan el contraste mínimo (4,5:1 para texto,
 *    3:1 para lo que no es texto), además de lo que mide axe sobre cada componente renderizado;
 *  - el objetivo táctil de operación es de 48 px y hay respeto de `prefers-reduced-motion`.
 */

function declaraciones(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    const nombre = m[1];
    const valor = m[2];
    if (nombre !== undefined && valor !== undefined)
      mapa.set(nombre, valor.trim().replace(/\s+/g, " "));
  }
  return mapa;
}

const tokens = declaraciones();

function valorDe(nombre: string): string {
  const valor = tokens.get(nombre);
  if (valor === undefined) throw new Error(`falta el token ${nombre}`);
  return valor;
}

/** Resuelve `var(--x)` hasta llegar a un `#rrggbb`. */
function colorDe(nombre: string): string {
  let valor = valorDe(nombre);
  for (let i = 0; i < 5; i++) {
    const referencia = /^var\((--[a-z0-9-]+)\)$/.exec(valor);
    if (referencia?.[1] === undefined) break;
    valor = valorDe(referencia[1]);
  }
  expect(valor, nombre).toMatch(/^#[0-9a-f]{6}$/);
  return valor;
}

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return ((claro ?? 0) + 0.05) / ((oscuro ?? 0) + 0.05);
}

const ESTADOS = ["peligro", "exito", "aviso", "info"] as const;

describe("tokens: marca y estado", () => {
  it("lee los tokens del archivo", () => {
    expect(tokens.size).toBeGreaterThan(40);
  });

  it.each(ESTADOS)("los tokens de %s nunca toman un valor de marca", (estado) => {
    for (const nombre of [
      `--color-${estado}`,
      `--color-sobre-${estado}`,
      `--color-${estado}-suave`,
    ]) {
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

  it("el CSS de los componentes no escribe un color suelto: solo usa tokens", () => {
    const fuentes = import.meta.glob("./**/*.module.css", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    expect(Object.keys(fuentes).length).toBeGreaterThan(10);
    for (const [archivo, texto] of Object.entries(fuentes)) {
      expect(texto as string, archivo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(texto as string, archivo).not.toMatch(/\brgba?\(/);
      expect(texto as string, archivo).not.toMatch(/--brand-/);
    }
  });

  it("los valores por defecto de la marca son legibles", () => {
    expect(
      contraste(colorDe("--brand-on-primary"), colorDe("--brand-primary")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contraste(colorDe("--brand-primary"), colorDe("--color-fondo"))).toBeGreaterThanOrEqual(
      3,
    );
    expect(contraste(colorDe("--brand-accent"), colorDe("--color-fondo"))).toBeGreaterThanOrEqual(
      3,
    );
    expect(
      contraste(colorDe("--brand-secondary"), colorDe("--color-fondo")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("tokens: contraste de los pares que usan los componentes", () => {
  const textoSobre: [string, string][] = [
    ["--color-texto", "--color-fondo"],
    ["--color-texto", "--color-superficie"],
    ["--color-texto", "--color-superficie-elevada"],
    ["--color-texto-suave", "--color-fondo"],
    ["--color-texto-suave", "--color-superficie"],
    ["--color-texto-suave", "--color-superficie-elevada"],
    ["--color-sobre-deshabilitado", "--color-deshabilitado"],
    ["--accion-primaria-texto", "--accion-primaria-fondo"],
    ...ESTADOS.flatMap((e): [string, string][] => [
      [`--color-sobre-${e}`, `--color-${e}`],
      [`--color-${e}`, `--color-fondo`],
      [`--color-${e}`, `--color-${e}-suave`],
      ["--color-texto", `--color-${e}-suave`],
      ["--color-texto-suave", `--color-${e}-suave`],
    ]),
  ];

  it.each(textoSobre)("%s sobre %s llega a 4,5:1", (texto, fondo) => {
    expect(contraste(colorDe(texto), colorDe(fondo))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["--color-borde", "--color-fondo"],
    ["--color-borde", "--color-superficie"],
    ["--color-foco", "--color-fondo"],
  ])("lo que no es texto, %s sobre %s, llega a 3:1", (objeto, fondo) => {
    expect(contraste(colorDe(objeto), colorDe(fondo))).toBeGreaterThanOrEqual(3);
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
