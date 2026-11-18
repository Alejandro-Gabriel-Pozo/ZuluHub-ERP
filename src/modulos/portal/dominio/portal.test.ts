import { describe, expect, it } from "vitest";
import {
  TOPE_DE_BYTES_DE_LA_IMAGEN_DEL_PORTAL,
  centesimasDesdeTexto,
  imagenEntraEnElPortal,
  textoDesdeCentesimas,
  validarPortal,
} from "./portal";

const S = "11111111-1111-4111-8111-111111111111";
const base = { variante: "A", logoVisible: true } as const;
const error = (e: Parameters<typeof validarPortal>[0]) => {
  const r = validarPortal(e);
  return r.ok ? "OK" : r.error;
};

describe("porcentajes de la imagen en centésimas (sin decimales flotantes)", () => {
  it("lee hasta dos decimales y hasta 100; lo demás se rechaza", () => {
    expect(centesimasDesdeTexto("12.5")).toBe(1250);
    expect(centesimasDesdeTexto("0")).toBe(0);
    expect(centesimasDesdeTexto("100")).toBe(10000);
    expect(centesimasDesdeTexto("100.00")).toBe(10000);
    for (const malo of ["100.01", "101", "1.234", "-1", "1e2", " 1", "", ".5", "1.", "0x10"])
      expect(centesimasDesdeTexto(malo)).toBeNull();
  });
  it("ida y vuelta", () => {
    for (const t of ["0.00", "12.50", "99.99", "100.00"])
      expect(textoDesdeCentesimas(centesimasDesdeTexto(t) as number)).toBe(t);
  });
});

describe("tope de la imagen: 3 MB", () => {
  it("borde en las dos puntas", () => {
    expect(imagenEntraEnElPortal(TOPE_DE_BYTES_DE_LA_IMAGEN_DEL_PORTAL)).toBe(true);
    expect(imagenEntraEnElPortal(TOPE_DE_BYTES_DE_LA_IMAGEN_DEL_PORTAL + 1)).toBe(false);
    expect(imagenEntraEnElPortal(0)).toBe(false);
    expect(imagenEntraEnElPortal(-1)).toBe(false);
    expect(imagenEntraEnElPortal(1.5)).toBe(false);
    expect(imagenEntraEnElPortal(Number.NaN)).toBe(false);
  });
});

describe("validarPortal: lista de permitidos", () => {
  it("lo mínimo es válido y lo vacío es «sin valor»", () => {
    const r = validarPortal({ ...base, lineaSuperior: "  ", titulo: "", colorPagina: "" });
    expect(r.ok && r.valor.datos).toMatchObject({
      lineaSuperior: null,
      titulo: null,
      colorPagina: null,
      imagen: null,
    });
  });
  it("variante, colores y largos", () => {
    expect(error({ ...base, variante: "a" })).toBe("VARIANTE_INVALIDA");
    expect(error({ ...base, colorEncabezado: "#FFFFFF" })).toBe("COLOR_INVALIDO");
    expect(error({ ...base, colorEncabezado: "#fff" })).toBe("COLOR_INVALIDO");
    expect(error({ ...base, colorEncabezado: "#ffffff" })).toBe("OK");
    expect(error({ ...base, lineaSuperior: "a".repeat(40) })).toBe("OK");
    expect(error({ ...base, lineaSuperior: "a".repeat(41) })).toBe("LINEA_DEL_PORTAL_INVALIDA");
    expect(error({ ...base, titulo: "a".repeat(60) })).toBe("OK");
    expect(error({ ...base, titulo: "a".repeat(61) })).toBe("TITULO_DEL_PORTAL_INVALIDO");
    expect(error({ ...base, titulo: "<b>x</b>" })).toBe("TITULO_DEL_PORTAL_INVALIDO");
  });
  it("tarjetas: sucursal con forma de uuid, sin repetir, orden entero ≥ 0", () => {
    expect(error({ ...base, tarjetas: [{ sucursalId: "x", orden: 0, visible: true }] })).toBe(
      "SUCURSAL_NO_ENCONTRADA",
    );
    expect(error({ ...base, tarjetas: [{ sucursalId: S, orden: 0.5, visible: true }] })).toBe(
      "ORDEN_INVALIDO",
    );
    expect(
      error({
        ...base,
        tarjetas: [
          { sucursalId: S, orden: 0, visible: true },
          { sucursalId: S, orden: 1, visible: true },
        ],
      }),
    ).toBe("TARJETA_REPETIDA");
    expect(
      error({
        ...base,
        tarjetas: [{ sucursalId: S, orden: 0, visible: true, nombre: "a".repeat(81) }],
      }),
    ).toBe("NOMBRE_DE_TARJETA_INVALIDO");
  });
  it("zonas: dentro de la imagen, ancho y alto positivos, una por sucursal", () => {
    const z = (cambio: object) => ({
      id: S,
      sucursalId: S,
      x: "0",
      y: "0",
      ancho: "100",
      alto: "100",
      visible: true,
      ...cambio,
    });
    expect(error({ ...base, zonas: [z({})] })).toBe("OK");
    expect(error({ ...base, zonas: [z({ x: "0.01" })] })).toBe("ZONA_INVALIDA");
    expect(error({ ...base, zonas: [z({ alto: "0.00" })] })).toBe("ZONA_INVALIDA");
    expect(error({ ...base, zonas: [z({ id: "no" })] })).toBe("IDENTIFICADOR_INVALIDO");
    const otro = "22222222-2222-4222-8222-222222222222";
    expect(
      error({
        ...base,
        zonas: [z({ ancho: "10", alto: "10" }), z({ id: otro, ancho: "10", alto: "10" })],
      }),
    ).toBe("ZONA_REPETIDA");
  });
});
