import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../../vocabulario/catalogo";
import { textosDeVidriera } from "./textos";

describe("textosDeVidriera", () => {
  const porDefecto = textosDeVidriera({});

  it("sin vocabulario de marca usa los textos por defecto del catálogo", () => {
    expect(porDefecto.letraEtiqueta).toBe("Letra");
    expect(porDefecto.agotado).toBe("Agotado");
    expect(porDefecto.volver).toBe("Volver a la carta");
    expect(porDefecto.enlaceCopiado).toBe("Enlace copiado");
    expect(porDefecto.buscarUnResultado).toBe("1 resultado");
  });

  it("los marcadores quedan a la vista para que la pantalla ponga el dato", () => {
    expect(porDefecto.buscarResultados).toContain("{cantidad}");
    expect(porDefecto.buscarSinResultados).toContain("{texto}");
  });

  it("el vocabulario de la marca reemplaza la redacción", () => {
    const propio = textosDeVidriera({ "vidriera.producto.agotado": "Sin stock" });
    expect(propio.agotado).toBe("Sin stock");
    expect(propio.volver).toBe("Volver a la carta");
  });

  it("cada clave de la carta del catálogo se usa en algún texto: ninguna queda huérfana", () => {
    const usadas = new Set(Object.values(porDefecto));
    const deLaVidriera = Object.entries(CATALOGO_DE_TEXTOS).filter(([c]) =>
      c.startsWith("vidriera."),
    );
    expect(deLaVidriera.length).toBe(Object.keys(porDefecto).length);
    for (const [clave, definicion] of deLaVidriera) {
      expect(usadas.has(definicion.porDefecto), clave).toBe(true);
    }
  });
});
