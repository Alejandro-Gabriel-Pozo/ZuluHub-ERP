import { describe, expect, it } from "vitest";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";
import { USOS_DE_DEPOSITO } from "../../src/modulos/stock/publico";
import {
  armarLaListaDeDepositos,
  CLAVE_DE_TEXTO_DEL_USO,
  opcionesDeUso,
  textoDelUsoDeUnDeposito,
  USO_DE_VENTA,
  RUTAS_DE_DEPOSITOS,
} from "../../apps/web/ui/plantillas/stock/depositos/modelo-de-depositos";
import { pestanasDeStock } from "../../apps/web/ui/plantillas/stock/pestanas-de-stock";
import {
  PESTANAS_CONSTRUIDAS,
  RUTAS_DE_STOCK,
} from "../../apps/web/ui/plantillas/stock/rutas-de-stock";

const textoDe = (clave: Parameters<typeof texto>[1]) => texto({}, clave);
const deposito = (extra: Record<string, unknown> = {}) => ({
  id: "d1",
  nombre: "Cocina",
  uso: "NORMAL",
  deVenta: false,
  activo: true,
  version: 1,
  ...extra,
});

describe("el modelo de «Depósitos» de stock", () => {
  it("cada tarjeta muestra el nombre, el uso con su texto aprobado y si es de venta", () => {
    expect(
      armarLaListaDeDepositos(
        [deposito({ deVenta: true }), deposito({ id: "d2", nombre: "Cámara", uso: "CUARENTENA" })],
        textoDe,
      ),
    ).toEqual([
      { id: "d1", titulo: "Cocina", uso: "Normal", deVenta: true, activo: true },
      { id: "d2", titulo: "Cámara", uso: "Cuarentena", deVenta: false, activo: true },
    ]);
  });

  it("un depósito desactivado se muestra con su estado, para poder reactivarlo (maqueta de gestión, 25/11/2026)", () => {
    expect(armarLaListaDeDepositos([deposito({ activo: false })], textoDe)).toEqual([
      { id: "d1", titulo: "Cocina", uso: "Normal", deVenta: false, activo: false },
    ]);
  });

  it("la tarjeta no lleva la versión: es del formulario de edición, no de la lista", () => {
    const [fila] = armarLaListaDeDepositos([deposito({ version: 7 })], textoDe);
    expect(fila).not.toHaveProperty("version");
  });

  it("un uso sin texto aprobado no se muestra: ante la duda el sistema cierra", () => {
    expect(armarLaListaDeDepositos([deposito({ uso: "OTRO" })], textoDe)).toEqual([]);
    for (const uso of ["constructor", "toString", "__proto__"]) {
      expect(armarLaListaDeDepositos([deposito({ uso })], textoDe)).toEqual([]);
    }
  });

  it("sin depósitos, la lista está vacía (sin texto de «vacío»: no está aprobado)", () => {
    expect(armarLaListaDeDepositos([], textoDe)).toEqual([]);
  });

  it("los usos que la pantalla sabe nombrar son EXACTAMENTE los del servidor y la base", () => {
    expect(Object.keys(CLAVE_DE_TEXTO_DEL_USO).sort()).toEqual([...USOS_DE_DEPOSITO].sort());
  });
});

describe("el texto del uso de un depósito", () => {
  it("es el aprobado de cada uso, y un uso sin texto no se muestra", () => {
    expect(textoDelUsoDeUnDeposito("NORMAL", textoDe)).toBe("Normal");
    expect(textoDelUsoDeUnDeposito("CUARENTENA", textoDe)).toBe("Cuarentena");
    expect(textoDelUsoDeUnDeposito("RECHAZO", textoDe)).toBe("Rechazo");
    for (const uso of ["OTRO", "constructor", "__proto__"]) {
      expect(textoDelUsoDeUnDeposito(uso, textoDe)).toBeNull();
    }
  });
});

describe("las opciones del uso", () => {
  it("se ofrecen en el orden del servidor, cada una con su texto aprobado", () => {
    expect(opcionesDeUso(USOS_DE_DEPOSITO, textoDe)).toEqual([
      { valor: "NORMAL", etiqueta: "Normal" },
      { valor: "CUARENTENA", etiqueta: "Cuarentena" },
      { valor: "RECHAZO", etiqueta: "Rechazo" },
    ]);
  });

  it("un uso sin texto aprobado no se ofrece", () => {
    expect(opcionesDeUso(["NORMAL", "OTRO", "constructor"], textoDe)).toEqual([
      { valor: "NORMAL", etiqueta: "Normal" },
    ]);
  });

  it("«De venta» le corresponde solo al uso Normal", () => {
    expect(USO_DE_VENTA).toBe("NORMAL");
  });
});

describe("las rutas y las pestañas de Stock", () => {
  it("solo se ofrecen las pestañas de pantallas construidas, y la actual lleva la marca", () => {
    expect(pestanasDeStock("depositos").map((p) => [p.texto, p.href, p.actual])).toEqual([
      ["Existencias", "/stock/existencias", false],
      ["Movimientos", "/stock/movimientos", false],
      ["Conteo", "/stock/conteo", false],
      ["Depósitos", "/stock/depositos", true],
      ["Lotes", "/stock/lotes", false],
    ]);
    expect(PESTANAS_CONSTRUIDAS).toEqual([
      "existencias",
      "movimientos",
      "conteo",
      "depositos",
      "lotes",
    ]);
  });

  it("la marca de «actual» sigue a la pantalla en la que se está", () => {
    expect(pestanasDeStock("conteo").map((p) => [p.texto, p.actual])).toEqual([
      ["Existencias", false],
      ["Movimientos", false],
      ["Conteo", true],
      ["Depósitos", false],
      ["Lotes", false],
    ]);
  });

  it("ninguna pestaña apunta a una ruta fuera de las construidas", () => {
    const permitidas = PESTANAS_CONSTRUIDAS.map((clave) => RUTAS_DE_STOCK[clave]);
    for (const actual of ["existencias", "movimientos", "conteo", "depositos", "lotes"] as const) {
      for (const pestana of pestanasDeStock(actual)) expect(permitidas).toContain(pestana.href);
    }
  });

  it("las cuatro rutas de la maqueta siguen declaradas para las próximas pantallas", () => {
    expect([
      RUTAS_DE_STOCK.existencias,
      RUTAS_DE_STOCK.movimientos,
      RUTAS_DE_STOCK.conteo,
      RUTAS_DE_STOCK.depositos,
    ]).toEqual(["/stock/existencias", "/stock/movimientos", "/stock/conteo", "/stock/depositos"]);
  });

  it("el alta y la edición de un depósito cuelgan de la lista, y el menú entra por una pantalla que existe", () => {
    expect(RUTAS_DE_DEPOSITOS.lista).toBe(RUTAS_DE_STOCK.depositos);
    expect(RUTAS_DE_DEPOSITOS.nuevo).toBe("/stock/depositos/nuevo");
    expect(RUTAS_DE_DEPOSITOS.editar("0b0b0b0b-1111-4222-8333-444444444444")).toBe(
      "/stock/depositos/0b0b0b0b-1111-4222-8333-444444444444/editar",
    );
    expect(RUTAS_DE_STOCK.entrada).toBe(RUTAS_DE_STOCK.existencias);
  });
});
